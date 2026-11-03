-- New-device approval (owner request 2026-11-03).
--
-- On iPhone, a home-screen web app keeps its own storage, separate from
-- Safari and from in-app browsers (WhatsApp etc.). A family member who
-- joined in the browser and then opens the home-screen shortcut is a NEW
-- device whose profile is "already claimed by another device", which used
-- to require a profile PIN that almost nobody has. Now that device asks the
-- family admin, who approves it with one tap; the device is then signed into
-- the profile exactly as claim_family_profile() would (an additional
-- profile_auth_sessions row; no other device is displaced).
--
-- Security model:
--  * Only a device that is already a member of the family (joined with the
--    family code — family_auth_members) can ask, and only for an active
--    profile of that same family that is signed in elsewhere.
--  * Only a real family admin of that family decides: not during QA
--    impersonation, not as a System Admin observer.
--  * A request is valid for 30 minutes; at most 5 requests per device per
--    hour. Approving writes the requesting device's profile session and an
--    audit event. The table has no client privileges; RPCs only.

create table if not exists public.device_access_requests (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families(id) on delete cascade,
  target_user_id uuid not null references public.users(id) on delete cascade,
  requester_auth_user_id uuid not null,
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  context jsonb not null default '{}'::jsonb check (pg_column_size(context) <= 1024),
  decided_by_user_id uuid references public.users(id) on delete set null,
  decided_at timestamptz,
  admin_notified_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists device_access_requests_family_idx on public.device_access_requests(family_id, status, created_at desc);
create index if not exists device_access_requests_requester_idx on public.device_access_requests(requester_auth_user_id, created_at desc);
alter table public.device_access_requests enable row level security;
revoke all on public.device_access_requests from public, anon, authenticated;

drop trigger if exists system_activity_audit_trigger on public.device_access_requests;
create trigger system_activity_audit_trigger after insert or update or delete on public.device_access_requests
  for each row execute function public.capture_user_state_change();

-- ---------- Requesting device ----------

create or replace function public.request_device_access(p_target_user_id uuid, p_context jsonb default '{}'::jsonb)
returns uuid language plpgsql volatile security definer set search_path = '' as $$
declare
  v_family uuid;
  v_target_family uuid;
  v_removed timestamptz;
  v_id uuid;
begin
  if auth.uid() is null then
    raise exception 'must be authenticated' using errcode = '42501';
  end if;
  select m.family_id into v_family
  from public.family_auth_members m join public.families f on f.id = m.family_id
  where m.auth_user_id = auth.uid() and f.approval_status = 'active';
  if v_family is null then
    raise exception 'join the family first' using errcode = '42501';
  end if;
  select u.family_id, u.removed_at into v_target_family, v_removed from public.users u where u.id = p_target_user_id;
  if v_target_family is distinct from v_family or v_removed is not null then
    raise exception 'profile not found in this family' using errcode = 'P0002';
  end if;
  if exists (select 1 from public.profile_auth_sessions s where s.auth_user_id = auth.uid() and s.user_id = p_target_user_id) then
    raise exception 'already signed in to this profile' using errcode = '22023';
  end if;
  -- Re-asking for the same profile while a request is still open returns it.
  select r.id into v_id from public.device_access_requests r
  where r.requester_auth_user_id = auth.uid() and r.target_user_id = p_target_user_id
    and r.status = 'pending' and r.created_at > now() - interval '30 minutes'
  order by r.created_at desc limit 1;
  if v_id is not null then
    return v_id;
  end if;
  if (select count(*) from public.device_access_requests r
      where r.requester_auth_user_id = auth.uid() and r.created_at > now() - interval '1 hour') >= 5 then
    raise exception 'too many requests, try again later' using errcode = '54000';
  end if;
  insert into public.device_access_requests(family_id, target_user_id, requester_auth_user_id, context)
  values (v_family, p_target_user_id, auth.uid(),
          case when jsonb_typeof(p_context) = 'object' and pg_column_size(p_context) <= 1024 then p_context else '{}'::jsonb end)
  returning id into v_id;
  return v_id;
end $$;
revoke all on function public.request_device_access(uuid, jsonb) from public, anon;
grant execute on function public.request_device_access(uuid, jsonb) to authenticated;

-- The device's own request, for its waiting screen.
create or replace function public.get_my_device_access_request(p_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare result jsonb;
begin
  if auth.uid() is null then return null; end if;
  select jsonb_build_object(
      'id', r.id, 'target_user_id', r.target_user_id,
      'status', case when r.status = 'pending' and r.created_at <= now() - interval '30 minutes' then 'expired' else r.status end,
      'created_at', r.created_at, 'decided_at', r.decided_at)
  into result
  from public.device_access_requests r
  where r.id = p_id and r.requester_auth_user_id = auth.uid();
  return result;
end $$;
revoke all on function public.get_my_device_access_request(uuid) from public, anon;
grant execute on function public.get_my_device_access_request(uuid) to authenticated;

-- Called by the device-access-notify Edge Function AS THE REQUESTER: returns
-- what the admin push needs, once per request, while it is fresh.
create or replace function public.claim_device_access_admin_notice(p_id uuid)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare result jsonb;
begin
  if auth.uid() is null then return null; end if;
  update public.device_access_requests r set admin_notified_at = now()
  where r.id = p_id and r.requester_auth_user_id = auth.uid() and r.status = 'pending'
    and r.admin_notified_at is null and r.created_at > now() - interval '10 minutes';
  if not found then return null; end if;
  select jsonb_build_object('id', r.id, 'family_id', r.family_id, 'target_name', u.name)
  into result
  from public.device_access_requests r join public.users u on u.id = r.target_user_id
  where r.id = p_id;
  return result;
end $$;
revoke all on function public.claim_device_access_admin_notice(uuid) from public, anon;
grant execute on function public.claim_device_access_admin_notice(uuid) to authenticated;

-- ---------- Family admin ----------

create or replace function public.device_access_assert_family_admin(p_family_id uuid)
returns void language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is null
     or public.active_system_admin_observer_family() is not null
     or public.active_impersonation_target() is not null
     or not public.is_real_family_admin(p_family_id) then
    raise exception 'family admin required' using errcode = '42501';
  end if;
end $$;
revoke all on function public.device_access_assert_family_admin(uuid) from public, anon, authenticated;

create or replace function public.admin_list_device_access_requests()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_family uuid := public.current_family_id();
  result jsonb;
begin
  if v_family is null then return '[]'::jsonb; end if;
  perform public.device_access_assert_family_admin(v_family);
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', r.id, 'target_user_id', r.target_user_id, 'target_name', u.name, 'target_avatar', u.avatar,
      'context', r.context, 'created_at', r.created_at) order by r.created_at desc), '[]'::jsonb)
  into result
  from public.device_access_requests r join public.users u on u.id = r.target_user_id
  where r.family_id = v_family and r.status = 'pending' and r.created_at > now() - interval '30 minutes';
  return result;
end $$;
revoke all on function public.admin_list_device_access_requests() from public, anon;
grant execute on function public.admin_list_device_access_requests() to authenticated;

create or replace function public.admin_decide_device_access_request(p_id uuid, p_approve boolean)
returns void language plpgsql volatile security definer set search_path = '' as $$
declare
  r record;
begin
  select * into r from public.device_access_requests where id = p_id for update;
  if r.id is null then
    raise exception 'request not found' using errcode = 'P0002';
  end if;
  perform public.device_access_assert_family_admin(r.family_id);
  if r.status <> 'pending' or r.created_at <= now() - interval '30 minutes' then
    raise exception 'request is no longer pending' using errcode = '22023';
  end if;
  if p_approve then
    if not exists (select 1 from public.users u where u.id = r.target_user_id and u.family_id = r.family_id and u.removed_at is null) then
      raise exception 'profile not found in this family' using errcode = 'P0002';
    end if;
    -- The requesting device must still belong to this family.
    if not exists (select 1 from public.family_auth_members m where m.auth_user_id = r.requester_auth_user_id and m.family_id = r.family_id) then
      raise exception 'device is no longer in this family' using errcode = '22023';
    end if;
    insert into public.profile_auth_sessions (auth_user_id, family_id, user_id, updated_at)
    values (r.requester_auth_user_id, r.family_id, r.target_user_id, now())
    on conflict (auth_user_id) do update
      set family_id = excluded.family_id, user_id = excluded.user_id, updated_at = now();
  end if;
  update public.device_access_requests
    set status = case when p_approve then 'approved' else 'rejected' end,
        decided_by_user_id = public.real_current_profile_id(), decided_at = now()
    where id = p_id;
  perform public.log_audit_event(r.family_id, public.real_current_profile_id(),
    case when p_approve then 'device_access_approved' else 'device_access_rejected' end,
    'user', r.target_user_id, jsonb_build_object('request_id', p_id));
end $$;
revoke all on function public.admin_decide_device_access_request(uuid, boolean) from public, anon;
grant execute on function public.admin_decide_device_access_request(uuid, boolean) to authenticated;

comment on table public.device_access_requests is 'A family member''s new device asking the family admin to sign it into a profile already signed in elsewhere (iPhone home-screen web apps keep separate storage). RPCs only.';
