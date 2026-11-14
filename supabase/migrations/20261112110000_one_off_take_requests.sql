-- One-off "take" requests (owner request 2026-11-12).
--
-- A member wanted to take ONE walk of another member (today's 13:30) and the
-- only option offered was the permanent routine "take", which moved that
-- weekday for good. There was no one-off way to take someone's walk without
-- giving one back (one-off swaps need a walk in return).
--
-- New request kind 'take_once' in routine_change_requests, so it rides the
-- same list, bell, Home card and push function as the routine requests:
--   requester  asks for one exact pending walk of another member (walk_id);
--   the walk's member accepts -> the walk is reassigned at once ('approved');
--   the family admin may approve or reject it at any time while it is open
--   (the member may be unavailable).
-- Approval reassigns that single walk server-side, exactly like an approved
-- one-off swap (approve_swap_request): schedule entry + walk responsible,
-- swap_* markers (Home shows "↔ במקום X"), audit event. The routine rules are
-- never touched.
--
-- Security: the table keeps no client write privileges; every transition is
-- a SECURITY DEFINER RPC re-checking the caller (requester creates/cancels,
-- the walk's member answers, a real family admin decides). Applying re-checks
-- the walk under a row lock: still pending, same member, same time.

alter table public.routine_change_requests
  add column if not exists walk_id uuid references public.walks(id) on delete cascade,
  add column if not exists walk_date date;

alter table public.routine_change_requests drop constraint if exists routine_change_requests_kind_check;
alter table public.routine_change_requests add constraint routine_change_requests_kind_check
  check (kind in ('swap', 'give', 'take', 'change_time', 'take_once'));

alter table public.routine_change_requests drop constraint if exists routine_change_requests_check;
alter table public.routine_change_requests add constraint routine_change_requests_check check (
  (kind = 'swap' and target_user_id is not null and my_day is not null and my_time is not null and their_day is not null and their_time is not null and new_time is null and walk_id is null)
  or (kind = 'give' and target_user_id is not null and my_day is not null and my_time is not null and their_day is null and their_time is null and new_time is null and walk_id is null)
  or (kind = 'take' and target_user_id is not null and my_day is null and my_time is null and their_day is not null and their_time is not null and new_time is null and walk_id is null)
  or (kind = 'change_time' and target_user_id is null and my_day is not null and my_time is not null and their_day is null and their_time is null and new_time is not null and walk_id is null)
  or (kind = 'take_once' and target_user_id is not null and my_day is null and my_time is null and their_day is not null and their_time is not null and new_time is null and walk_id is not null and walk_date is not null)
);
create index if not exists routine_change_requests_walk_idx on public.routine_change_requests(walk_id) where walk_id is not null;

-- ---------- Requester ----------
create or replace function public.create_walk_take_once_request(p_walk_id uuid, p_note text default null)
returns uuid language plpgsql volatile security definer set search_path = '' as $$
declare
  v_me uuid := public.current_profile_id();
  v_family uuid := public.current_family_id();
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  w record;
  v_id uuid;
begin
  if v_me is null or v_family is null or public.active_system_admin_observer_family() is not null then
    raise exception 'no active profile claimed on this family' using errcode = '42501';
  end if;
  if v_note is not null and char_length(v_note) > 200 then
    raise exception 'note is too long' using errcode = '22023';
  end if;
  select * into w from public.walks where id = p_walk_id for update;
  if w.id is null or w.family_id is distinct from v_family then
    raise exception 'walk not found in this family' using errcode = 'P0002';
  end if;
  if w.status <> 'pending' or w.duplicate_resolution_group_id is not null then
    raise exception 'this walk can no longer be taken' using errcode = '22023';
  end if;
  if w.responsible_user_id is null or w.responsible_user_id = v_me
     or not exists (select 1 from public.users u where u.id = w.responsible_user_id and u.family_id = v_family and u.removed_at is null) then
    raise exception 'choose a walk of another family member' using errcode = '22023';
  end if;
  if exists (select 1 from public.walk_swap_requests s
             where s.status = 'pending' and (s.walk_id = w.id or s.target_walk_id = w.id)) then
    raise exception 'there is already an open request for this walk' using errcode = '22023';
  end if;

  -- The same open request again returns the existing one; one open take per walk.
  select r.id into v_id from public.routine_change_requests r
  where r.walk_id = w.id and r.kind = 'take_once' and r.status in ('pending_target', 'pending_admin')
  order by (r.requester_user_id = v_me) desc
  limit 1;
  if v_id is not null then
    if exists (select 1 from public.routine_change_requests r where r.id = v_id and r.requester_user_id = v_me) then
      return v_id;
    end if;
    raise exception 'there is already an open request for this walk' using errcode = '22023';
  end if;
  if (select count(*) from public.routine_change_requests r
      where r.requester_user_id = v_me and r.created_at > now() - interval '1 day') >= 20 then
    raise exception 'too many requests, try again later' using errcode = '54000';
  end if;

  insert into public.routine_change_requests(
    family_id, dog_id, requester_user_id, target_user_id, kind,
    their_day, their_time, walk_id, walk_date, note, status)
  values (
    v_family, w.dog_id, v_me, w.responsible_user_id, 'take_once',
    extract(dow from w.date)::smallint, w.scheduled_time, w.id, w.date, v_note, 'pending_target')
  returning id into v_id;
  return v_id;
end $$;
revoke all on function public.create_walk_take_once_request(uuid, text) from public, anon;
grant execute on function public.create_walk_take_once_request(uuid, text) to authenticated;

-- ---------- Applying an approved one-off take (internal) ----------
create or replace function public.apply_walk_take_once(p_id uuid, p_actor uuid)
returns void language plpgsql volatile security definer set search_path = '' as $$
declare
  r record;
  w record;
begin
  select * into r from public.routine_change_requests where id = p_id for update;
  if r.id is null or r.kind <> 'take_once' then
    raise exception 'request not found' using errcode = 'P0002';
  end if;
  select * into w from public.walks where id = r.walk_id for update;
  if w.id is null
     or w.family_id is distinct from r.family_id
     or w.status <> 'pending'
     or w.responsible_user_id is distinct from r.target_user_id
     or w.scheduled_time is distinct from r.their_time
     or w.date is distinct from r.walk_date then
    raise exception 'the walk has changed since this request was sent' using errcode = '22023';
  end if;
  if not exists (select 1 from public.users u where u.id = r.requester_user_id and u.family_id = r.family_id and u.removed_at is null) then
    raise exception 'the requester is no longer active in this family' using errcode = '22023';
  end if;

  perform set_config('app.trusted_write', 'on', true);
  if w.schedule_entry_id is not null then
    update public.schedule_entries
       set responsible_user_id = r.requester_user_id
     where id = w.schedule_entry_id and family_id = r.family_id;
  end if;
  update public.walks
     set responsible_user_id = r.requester_user_id,
         swap_original_user_id = coalesce(w.swap_original_user_id, w.responsible_user_id),
         swap_new_user_id = r.requester_user_id,
         swap_swapped_at = now(),
         swap_swapped_by_user_id = p_actor,
         updated_at = now()
   where id = w.id;
  perform set_config('app.trusted_write', 'off', true);

  perform public.log_audit_event(r.family_id, p_actor, 'take_once_request_approved', 'walk', w.id,
    jsonb_build_object('request_id', r.id, 'requested_by_user_id', r.requester_user_id, 'from_user_id', r.target_user_id));
end $$;
revoke all on function public.apply_walk_take_once(uuid, uuid) from public, anon, authenticated;

-- ---------- The walk's member answers ----------
-- Same as 20261110090000, plus: accepting a take_once applies it at once.
create or replace function public.respond_routine_change_request(p_id uuid, p_accept boolean)
returns text language plpgsql volatile security definer set search_path = '' as $$
declare
  v_me uuid := public.current_profile_id();
  v_kind text;
  v_status text;
begin
  if public.active_system_admin_observer_family() is not null then
    raise exception 'read-only' using errcode = '42501';
  end if;
  select r.kind into v_kind from public.routine_change_requests r
   where r.id = p_id and r.target_user_id = v_me and r.family_id = public.current_family_id()
     and r.status = 'pending_target'
   for update;
  if v_kind is null then
    raise exception 'request is no longer open' using errcode = '22023';
  end if;
  if v_kind = 'take_once' and p_accept then
    perform public.apply_walk_take_once(p_id, v_me);
  end if;
  update public.routine_change_requests r
     set status = case when not p_accept then 'rejected' when v_kind = 'take_once' then 'approved' else 'pending_admin' end,
         target_responded_at = now(),
         decided_at = case when p_accept and v_kind <> 'take_once' then null else now() end,
         decided_by_user_id = case when v_kind = 'take_once' and p_accept then v_me else r.decided_by_user_id end,
         updated_at = now()
   where r.id = p_id
  returning r.status into v_status;
  return v_status;
end $$;
revoke all on function public.respond_routine_change_request(uuid, boolean) from public, anon;
grant execute on function public.respond_routine_change_request(uuid, boolean) to authenticated;

-- ---------- Family admin ----------
-- Same as 20261112100000, plus: approving a take_once applies it here (a
-- routine request is applied by the admin's device before this call).
create or replace function public.admin_decide_routine_change_request(p_id uuid, p_approve boolean)
returns void language plpgsql volatile security definer set search_path = '' as $$
declare
  r record;
begin
  select * into r from public.routine_change_requests where id = p_id for update;
  if r.id is null then
    raise exception 'request not found' using errcode = 'P0002';
  end if;
  if auth.uid() is null
     or public.active_system_admin_observer_family() is not null
     or public.active_impersonation_target() is not null
     or public.current_family_id() is distinct from r.family_id
     or not public.is_real_family_admin(r.family_id) then
    raise exception 'family admin required' using errcode = '42501';
  end if;
  if r.status not in ('pending_target', 'pending_admin') then
    raise exception 'request is no longer open' using errcode = '22023';
  end if;
  if p_approve and r.kind = 'take_once' then
    perform public.apply_walk_take_once(p_id, public.real_current_profile_id());
  end if;
  update public.routine_change_requests
     set status = case when p_approve then 'approved' else 'rejected' end,
         decided_by_user_id = public.real_current_profile_id(),
         decided_at = now(),
         updated_at = now()
   where id = p_id;
end $$;
revoke all on function public.admin_decide_routine_change_request(uuid, boolean) from public, anon;
grant execute on function public.admin_decide_routine_change_request(uuid, boolean) to authenticated;

-- ---------- Push payload ----------
-- Same as 20261110090000, plus walk_date for a one-off take.
create or replace function public.claim_routine_request_notice(p_id uuid)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  result jsonb;
begin
  if auth.uid() is null then return null; end if;
  update public.routine_change_requests r set notified_status = r.status
   where r.id = p_id and r.family_id = public.current_family_id()
     and r.status in ('pending_target', 'pending_admin', 'approved', 'rejected')
     and r.notified_status is distinct from r.status
     and r.updated_at > now() - interval '10 minutes';
  if not found then return null; end if;
  select jsonb_build_object(
      'id', r.id, 'family_id', r.family_id, 'kind', r.kind, 'status', r.status,
      'requester_user_id', r.requester_user_id, 'requester_name', ru.name,
      'target_user_id', r.target_user_id, 'target_name', tu.name,
      'dog_name', d.name,
      'my_day', r.my_day, 'my_time', r.my_time,
      'their_day', r.their_day, 'their_time', r.their_time, 'new_time', r.new_time,
      'walk_date', r.walk_date)
    into result
  from public.routine_change_requests r
  join public.users ru on ru.id = r.requester_user_id
  left join public.users tu on tu.id = r.target_user_id
  left join public.dogs d on d.id = r.dog_id
  where r.id = p_id;
  return result;
end $$;
revoke all on function public.claim_routine_request_notice(uuid) from public, anon;
grant execute on function public.claim_routine_request_notice(uuid) to authenticated;

comment on table public.routine_change_requests is 'Family members asking for a permanent change to the weekly routine, or to take one walk of another member (take_once). Writes via RPCs only.';
