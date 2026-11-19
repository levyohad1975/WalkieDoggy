-- Permanent routine change requests (owner request 2026-11-10).
--
-- The weekly routine grid ("ניהול שגרה") is edited by the family admin. A
-- family member can now ASK for a permanent change to it:
--   swap        my cell (day+time) <-> another member's cell
--   give        my cell -> another member
--   take        another member's cell -> me
--   change_time my cell moves to another time on the same day
-- A cell is one day at one time, owned by a single-person schedule rule.
--
-- Approval: swap/give/take go to the other member first ('pending_target'),
-- then to the family admin ('pending_admin'); change_time goes straight to
-- the admin. The admin's device applies the change to the schedule rules
-- through the ordinary rule operations (which also regenerate future walks)
-- and only then marks the request approved, so a retry is idempotent.
--
-- Security model: the table has no client write privileges; family members
-- read their own family's requests (RLS). Every transition is an RPC that
-- re-checks who the caller is: the requester creates/cancels, the target
-- answers, a real family admin (not QA impersonation, not a System Admin
-- observer) decides. The routine-request-notify Edge Function claims each
-- status once (notified_status) to send one push per step.

create table if not exists public.routine_change_requests (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families(id) on delete cascade,
  dog_id uuid not null references public.dogs(id) on delete cascade,
  requester_user_id uuid not null references public.users(id) on delete cascade,
  target_user_id uuid references public.users(id) on delete cascade,
  kind text not null check (kind in ('swap', 'give', 'take', 'change_time')),
  my_day smallint check (my_day between 0 and 6),
  my_time text check (my_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  their_day smallint check (their_day between 0 and 6),
  their_time text check (their_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  new_time text check (new_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  note text check (char_length(note) <= 200),
  status text not null check (status in ('pending_target', 'pending_admin', 'approved', 'rejected', 'cancelled')),
  target_responded_at timestamptz,
  decided_by_user_id uuid references public.users(id) on delete set null,
  decided_at timestamptz,
  notified_status text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (
    (kind = 'swap' and target_user_id is not null and my_day is not null and my_time is not null and their_day is not null and their_time is not null and new_time is null)
    or (kind = 'give' and target_user_id is not null and my_day is not null and my_time is not null and their_day is null and their_time is null and new_time is null)
    or (kind = 'take' and target_user_id is not null and my_day is null and my_time is null and their_day is not null and their_time is not null and new_time is null)
    or (kind = 'change_time' and target_user_id is null and my_day is not null and my_time is not null and their_day is null and their_time is null and new_time is not null)
  )
);
create index if not exists routine_change_requests_family_idx on public.routine_change_requests(family_id, created_at desc);
create index if not exists routine_change_requests_requester_idx on public.routine_change_requests(requester_user_id, created_at desc);

alter table public.routine_change_requests enable row level security;
revoke all on public.routine_change_requests from public, anon, authenticated;
grant select on public.routine_change_requests to authenticated;
drop policy if exists "read routine change requests in own family" on public.routine_change_requests;
create policy "read routine change requests in own family" on public.routine_change_requests
  for select to authenticated using (family_id = public.current_family_id());

drop trigger if exists system_activity_audit_trigger on public.routine_change_requests;
create trigger system_activity_audit_trigger after insert or update or delete on public.routine_change_requests
  for each row execute function public.capture_user_state_change();

-- Who walks the dog at this time on this day: the single member of an active
-- single-person rule, or null (empty cell, or a multi-person rotation).
create or replace function public.routine_cell_owner(p_dog_id uuid, p_day integer, p_time text)
returns uuid language sql stable security definer set search_path = '' as $$
  select case when cardinality(r.rotation_user_ids) = 1 then r.rotation_user_ids[1] end
  from public.schedule_rules r
  where r.dog_id = p_dog_id and r.active and r.time = p_time and p_day = any(r.days_of_week)
  order by r.created_at
  limit 1;
$$;
revoke all on function public.routine_cell_owner(uuid, integer, text) from public, anon, authenticated;

create or replace function public.routine_cell_is_empty(p_dog_id uuid, p_day integer, p_time text)
returns boolean language sql stable security definer set search_path = '' as $$
  select not exists (
    select 1 from public.schedule_rules r
    where r.dog_id = p_dog_id and r.active and r.time = p_time and p_day = any(r.days_of_week)
  );
$$;
revoke all on function public.routine_cell_is_empty(uuid, integer, text) from public, anon, authenticated;

-- ---------- Requester ----------
create or replace function public.create_routine_change_request(
  p_dog_id uuid,
  p_kind text,
  p_my_day integer default null,
  p_my_time text default null,
  p_target_user_id uuid default null,
  p_their_day integer default null,
  p_their_time text default null,
  p_new_time text default null,
  p_note text default null
) returns uuid language plpgsql volatile security definer set search_path = '' as $$
declare
  v_me uuid := public.current_profile_id();
  v_family uuid := public.current_family_id();
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_id uuid;
begin
  if v_me is null or v_family is null or public.active_system_admin_observer_family() is not null then
    raise exception 'no active profile claimed on this family' using errcode = '42501';
  end if;
  if not exists (select 1 from public.dogs d where d.id = p_dog_id and d.family_id = v_family) then
    raise exception 'dog not found in this family' using errcode = 'P0002';
  end if;
  if p_kind not in ('swap', 'give', 'take', 'change_time') then
    raise exception 'unknown request kind' using errcode = '22023';
  end if;
  if v_note is not null and char_length(v_note) > 200 then
    raise exception 'note is too long' using errcode = '22023';
  end if;

  if p_kind in ('swap', 'give', 'take') then
    if p_target_user_id is null or p_target_user_id = v_me
       or not exists (select 1 from public.users u where u.id = p_target_user_id and u.family_id = v_family and u.removed_at is null) then
      raise exception 'choose another family member' using errcode = '22023';
    end if;
  end if;
  if p_kind in ('swap', 'give', 'change_time')
     and public.routine_cell_owner(p_dog_id, p_my_day, p_my_time) is distinct from v_me then
    raise exception 'this routine slot is not yours' using errcode = '22023';
  end if;
  if p_kind in ('swap', 'take')
     and public.routine_cell_owner(p_dog_id, p_their_day, p_their_time) is distinct from p_target_user_id then
    raise exception 'that routine slot changed, refresh and try again' using errcode = '22023';
  end if;
  if p_kind = 'change_time' then
    if p_new_time is null or p_new_time !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' or p_new_time = p_my_time then
      raise exception 'choose a different time' using errcode = '22023';
    end if;
    if not public.routine_cell_is_empty(p_dog_id, p_my_day, p_new_time) then
      raise exception 'there is already a walk at that time' using errcode = '22023';
    end if;
  end if;

  -- The same open request again returns the existing one.
  select r.id into v_id from public.routine_change_requests r
  where r.requester_user_id = v_me and r.dog_id = p_dog_id and r.kind = p_kind
    and r.status in ('pending_target', 'pending_admin')
    and r.my_day is not distinct from (case when p_kind = 'take' then null else p_my_day end)
    and r.my_time is not distinct from (case when p_kind = 'take' then null else p_my_time end)
    and r.their_day is not distinct from (case when p_kind in ('swap', 'take') then p_their_day end)
    and r.their_time is not distinct from (case when p_kind in ('swap', 'take') then p_their_time end)
    and r.target_user_id is not distinct from (case when p_kind = 'change_time' then null else p_target_user_id end)
    and r.new_time is not distinct from (case when p_kind = 'change_time' then p_new_time end)
  limit 1;
  if v_id is not null then
    return v_id;
  end if;
  if (select count(*) from public.routine_change_requests r
      where r.requester_user_id = v_me and r.created_at > now() - interval '1 day') >= 20 then
    raise exception 'too many requests, try again later' using errcode = '54000';
  end if;

  insert into public.routine_change_requests(
    family_id, dog_id, requester_user_id, target_user_id, kind,
    my_day, my_time, their_day, their_time, new_time, note, status)
  values (
    v_family, p_dog_id, v_me,
    case when p_kind = 'change_time' then null else p_target_user_id end,
    p_kind,
    case when p_kind = 'take' then null else p_my_day end,
    case when p_kind = 'take' then null else p_my_time end,
    case when p_kind in ('swap', 'take') then p_their_day end,
    case when p_kind in ('swap', 'take') then p_their_time end,
    case when p_kind = 'change_time' then p_new_time end,
    v_note,
    case when p_kind = 'change_time' then 'pending_admin' else 'pending_target' end)
  returning id into v_id;
  return v_id;
end $$;
revoke all on function public.create_routine_change_request(uuid, text, integer, text, uuid, integer, text, text, text) from public, anon;
grant execute on function public.create_routine_change_request(uuid, text, integer, text, uuid, integer, text, text, text) to authenticated;

create or replace function public.cancel_routine_change_request(p_id uuid)
returns void language plpgsql volatile security definer set search_path = '' as $$
declare
  v_me uuid := public.current_profile_id();
begin
  if public.active_system_admin_observer_family() is not null then
    raise exception 'read-only' using errcode = '42501';
  end if;
  update public.routine_change_requests r
     set status = 'cancelled', decided_at = now(), updated_at = now()
   where r.id = p_id and r.requester_user_id = v_me and r.family_id = public.current_family_id()
     and r.status in ('pending_target', 'pending_admin');
  if not found then
    raise exception 'request is no longer open' using errcode = '22023';
  end if;
end $$;
revoke all on function public.cancel_routine_change_request(uuid) from public, anon;
grant execute on function public.cancel_routine_change_request(uuid) to authenticated;

-- ---------- The other family member ----------
create or replace function public.respond_routine_change_request(p_id uuid, p_accept boolean)
returns text language plpgsql volatile security definer set search_path = '' as $$
declare
  v_me uuid := public.current_profile_id();
  v_status text;
begin
  if public.active_system_admin_observer_family() is not null then
    raise exception 'read-only' using errcode = '42501';
  end if;
  update public.routine_change_requests r
     set status = case when p_accept then 'pending_admin' else 'rejected' end,
         target_responded_at = now(),
         decided_at = case when p_accept then null else now() end,
         updated_at = now()
   where r.id = p_id and r.target_user_id = v_me and r.family_id = public.current_family_id()
     and r.status = 'pending_target'
  returning r.status into v_status;
  if v_status is null then
    raise exception 'request is no longer open' using errcode = '22023';
  end if;
  return v_status;
end $$;
revoke all on function public.respond_routine_change_request(uuid, boolean) from public, anon;
grant execute on function public.respond_routine_change_request(uuid, boolean) to authenticated;

-- ---------- Family admin ----------
-- Approve AFTER the admin's device applied the change to the routine; reject
-- any open request.
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
  if p_approve and r.status <> 'pending_admin' then
    raise exception 'request is not waiting for the admin' using errcode = '22023';
  end if;
  if not p_approve and r.status not in ('pending_target', 'pending_admin') then
    raise exception 'request is no longer open' using errcode = '22023';
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

-- ---------- Push (routine-request-notify Edge Function, as the caller) ----------
-- Returns what one push needs, once per status of a request, to a caller of
-- the same family.
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
      'their_day', r.their_day, 'their_time', r.their_time, 'new_time', r.new_time)
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

comment on table public.routine_change_requests is 'Family members asking for a permanent change to the weekly routine; applied by the family admin. Writes via RPCs only.';
