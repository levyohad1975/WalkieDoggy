-- System Admin family onboarding QA, limited to explicitly marked QA families.
-- This Staging-required migration restores the reversible QA lifecycle that
-- exists in the repository design but is absent from the deployed Staging DB.

alter table public.families
  add column if not exists is_qa boolean not null default false;

comment on column public.families.is_qa is
  'True only for isolated QA families. It is a management marker; family_id and ordinary RLS remain the tenant boundary.';

create table if not exists public.family_membership_snapshots (
  auth_user_id uuid primary key references auth.users(id) on delete cascade,
  family_id uuid not null references public.families(id) on delete cascade,
  role text not null check (role in ('admin', 'member')),
  claimed_user_id uuid references public.users(id) on delete set null,
  saved_at timestamptz not null default now()
);

alter table public.family_membership_snapshots enable row level security;
revoke all on public.family_membership_snapshots from public, anon, authenticated;

comment on table public.family_membership_snapshots is
  'Private one-row snapshot of a System Admin device family/profile context while it is switched into a QA family. No client table access; only guarded System Admin RPCs use it.';

create or replace function public.system_admin_enter_test_family(p_family_name text)
returns table (id uuid, name text, invite_code text)
language plpgsql volatile security definer
set search_path = public, auth
as $$
declare
  v_auth auth.users%rowtype;
  v_current_family uuid;
  v_current_role text;
  v_is_qa boolean;
  v_profile_id uuid;
  v_new_family uuid;
  v_invite_code text;
  v_attempts integer := 0;
begin
  select * into v_auth from auth.users where auth.users.id = auth.uid();
  if v_auth.id is null or coalesce(v_auth.is_anonymous, true)
     or v_auth.email is null or v_auth.email_confirmed_at is null
     or not public.is_system_admin() then
    raise exception 'verified system admin required';
  end if;
  if p_family_name is null or length(trim(p_family_name)) = 0 then
    raise exception 'family_name is required';
  end if;
  if public.active_system_admin_observer_family() is not null
     or public.active_impersonation_target() is not null then
    raise exception 'exit observation or impersonation before starting a test family';
  end if;

  select m.family_id, m.role, f.is_qa
    into v_current_family, v_current_role, v_is_qa
  from public.family_auth_members m
  join public.families f on f.id = m.family_id
  where m.auth_user_id = auth.uid();

  -- A retried request after a lost response resumes the same QA family and
  -- never creates a duplicate.
  if v_current_family is not null and coalesce(v_is_qa, false) then
    return query select f.id, f.name, f.invite_code
      from public.families f where f.id = v_current_family;
    return;
  end if;
  if v_current_family is null then
    raise exception 'an existing family membership is required to preserve and restore this device';
  end if;
  if exists (select 1 from public.family_membership_snapshots s where s.auth_user_id = auth.uid()) then
    raise exception 'a family test session is already saved; return to the original family first';
  end if;

  v_profile_id := public.current_profile_id();
  insert into public.family_membership_snapshots(auth_user_id, family_id, role, claimed_user_id)
  values (auth.uid(), v_current_family, v_current_role, v_profile_id);

  loop
    v_invite_code := public.generate_invite_code();
    v_attempts := v_attempts + 1;
    begin
      insert into public.families(name, invite_code, approval_status, created_by_auth_user_id, is_qa)
      values (trim(p_family_name), v_invite_code, 'active', auth.uid(), true)
      returning families.id into v_new_family;
      exit;
    exception when unique_violation then
      if v_attempts > 20 then raise exception 'could not generate a unique invite_code'; end if;
    end;
  end loop;

  -- The family/profile switch remains a server-authorized membership update.
  -- Remove only this auth identity's old profile session and legacy claim;
  -- the snapshot restores both on exit.
  delete from public.profile_auth_sessions where auth_user_id = auth.uid();
  perform set_config('app.trusted_write', 'on', true);
  update public.users set auth_user_id = null where auth_user_id = auth.uid();
  perform set_config('app.trusted_write', 'off', true);
  update public.family_auth_members
    set family_id = v_new_family, role = 'admin'
    where auth_user_id = auth.uid();

  perform public.log_system_audit_event(
    'family.test_created', 'family', v_new_family,
    jsonb_build_object('family_name', trim(p_family_name), 'source', 'system_admin_onboarding')
  );
  return query select f.id, f.name, f.invite_code from public.families f where f.id = v_new_family;
end;
$$;

revoke all on function public.system_admin_enter_test_family(text) from public, anon;
grant execute on function public.system_admin_enter_test_family(text) to authenticated;

create or replace function public.system_admin_switch_test_family(p_family_id uuid)
returns table (id uuid, name text, invite_code text)
language plpgsql volatile security definer
set search_path = public, auth
as $$
declare
  v_auth auth.users%rowtype;
  v_current_family uuid;
  v_is_current_qa boolean;
  v_current_role text;
  v_target_is_qa boolean;
  v_profile_id uuid;
begin
  select * into v_auth from auth.users where auth.users.id = auth.uid();
  if v_auth.id is null or coalesce(v_auth.is_anonymous, true)
     or v_auth.email is null or v_auth.email_confirmed_at is null
     or not public.is_system_admin() then
    raise exception 'verified system admin required';
  end if;
  select m.family_id, m.role, f.is_qa
    into v_current_family, v_current_role, v_is_current_qa
  from public.family_auth_members m join public.families f on f.id = m.family_id
  where m.auth_user_id = auth.uid();
  if v_current_family is null or coalesce(v_is_current_qa, false) then
    raise exception 'return to your original family before switching test families';
  end if;
  select f.is_qa into v_target_is_qa from public.families f where f.id = p_family_id;
  if not coalesce(v_target_is_qa, false) then raise exception 'test family not found'; end if;
  if exists (select 1 from public.family_membership_snapshots s where s.auth_user_id = auth.uid()) then
    raise exception 'a family test session is already saved';
  end if;

  v_profile_id := public.current_profile_id();
  insert into public.family_membership_snapshots(auth_user_id, family_id, role, claimed_user_id)
  values (auth.uid(), v_current_family, v_current_role, v_profile_id);
  delete from public.profile_auth_sessions where auth_user_id = auth.uid();
  perform set_config('app.trusted_write', 'on', true);
  update public.users set auth_user_id = null where auth_user_id = auth.uid();
  perform set_config('app.trusted_write', 'off', true);
  update public.family_auth_members set family_id = p_family_id, role = 'admin' where auth_user_id = auth.uid();
  perform public.log_system_audit_event(
    'family.test_reopened', 'family', p_family_id,
    jsonb_build_object('source', 'system_admin_onboarding')
  );
  return query select f.id, f.name, f.invite_code from public.families f where f.id = p_family_id;
end;
$$;

revoke all on function public.system_admin_switch_test_family(uuid) from public, anon;
grant execute on function public.system_admin_switch_test_family(uuid) to authenticated;

create or replace function public.system_admin_exit_test_family()
returns table (id uuid, name text)
language plpgsql volatile security definer
set search_path = public, auth
as $$
declare
  v_auth auth.users%rowtype;
  v_current_family uuid;
  v_is_qa boolean;
  v_snapshot public.family_membership_snapshots%rowtype;
begin
  select * into v_auth from auth.users where auth.users.id = auth.uid();
  if v_auth.id is null or coalesce(v_auth.is_anonymous, true)
     or v_auth.email is null or v_auth.email_confirmed_at is null
     or not public.is_system_admin() then
    raise exception 'verified system admin required';
  end if;
  select m.family_id, f.is_qa into v_current_family, v_is_qa
  from public.family_auth_members m join public.families f on f.id = m.family_id
  where m.auth_user_id = auth.uid();
  if v_current_family is null or not coalesce(v_is_qa, false) then
    raise exception 'not currently in a test family';
  end if;
  select * into v_snapshot from public.family_membership_snapshots where auth_user_id = auth.uid();
  if v_snapshot.auth_user_id is null then raise exception 'no original family snapshot is available'; end if;

  delete from public.profile_auth_sessions where auth_user_id = auth.uid();
  perform set_config('app.trusted_write', 'on', true);
  update public.users set auth_user_id = null where auth_user_id = auth.uid();
  update public.family_auth_members
    set family_id = v_snapshot.family_id, role = v_snapshot.role
    where auth_user_id = auth.uid();
  if v_snapshot.claimed_user_id is not null then
    insert into public.profile_auth_sessions(auth_user_id, family_id, user_id)
    select auth.uid(), v_snapshot.family_id, u.id
    from public.users u
    where u.id = v_snapshot.claimed_user_id and u.family_id = v_snapshot.family_id and u.removed_at is null
    on conflict (auth_user_id) do update
      set family_id = excluded.family_id, user_id = excluded.user_id, updated_at = now();
    update public.users set auth_user_id = auth.uid()
      where id = v_snapshot.claimed_user_id and family_id = v_snapshot.family_id and removed_at is null;
  end if;
  perform set_config('app.trusted_write', 'off', true);
  delete from public.family_membership_snapshots where auth_user_id = auth.uid();

  perform public.log_system_audit_event(
    'family.test_exited', 'family', v_current_family,
    jsonb_build_object('returned_to_family_id', v_snapshot.family_id)
  );
  return query select f.id, f.name from public.families f where f.id = v_snapshot.family_id;
end;
$$;

revoke all on function public.system_admin_exit_test_family() from public, anon;
grant execute on function public.system_admin_exit_test_family() to authenticated;

create or replace function public.current_family_is_qa()
returns boolean language sql stable security definer set search_path = public
as $$ select coalesce((select f.is_qa from public.families f where f.id = public.current_family_id()), false); $$;
revoke all on function public.current_family_is_qa() from public, anon;
grant execute on function public.current_family_is_qa() to authenticated;

create or replace function public.system_admin_get_active_test_family()
returns table (family_id uuid, family_name text)
language plpgsql stable security definer set search_path = public, auth
as $$
begin
  if not public.is_system_admin() or not exists (
    select 1 from auth.users u where u.id = auth.uid() and not coalesce(u.is_anonymous, true)
      and u.email is not null and u.email_confirmed_at is not null
  ) then raise exception 'verified system admin required'; end if;
  return query select f.id, f.name
  from public.family_auth_members m join public.families f on f.id = m.family_id
  where m.auth_user_id = auth.uid() and f.is_qa;
end;
$$;
revoke all on function public.system_admin_get_active_test_family() from public, anon;
grant execute on function public.system_admin_get_active_test_family() to authenticated;

create or replace function public.system_admin_list_test_families()
returns table (family_id uuid, family_name text, invite_code text, created_at timestamptz, dog_name text)
language plpgsql stable security definer set search_path = public, auth
as $$
begin
  if not public.is_system_admin() or not exists (
    select 1 from auth.users u where u.id = auth.uid() and not coalesce(u.is_anonymous, true)
      and u.email is not null and u.email_confirmed_at is not null
  ) then raise exception 'verified system admin required'; end if;
  return query select f.id, f.name, f.invite_code, f.created_at,
    (select d.name from public.dogs d where d.family_id = f.id order by d.created_at desc limit 1)
  from public.families f where f.is_qa order by f.created_at desc;
end;
$$;
revoke all on function public.system_admin_list_test_families() from public, anon;
grant execute on function public.system_admin_list_test_families() to authenticated;

create or replace function public.system_admin_delete_test_family(p_family_id uuid, p_confirm text)
returns void language plpgsql volatile security definer set search_path = public, auth, storage
as $$
declare
  v_auth auth.users%rowtype;
  v_is_qa boolean;
begin
  select * into v_auth from auth.users where auth.users.id = auth.uid();
  if v_auth.id is null or coalesce(v_auth.is_anonymous, true)
     or v_auth.email is null or v_auth.email_confirmed_at is null
     or not public.is_system_admin() then raise exception 'verified system admin required'; end if;
  if p_confirm is distinct from 'DELETE TEST FAMILY' then raise exception 'explicit confirmation required'; end if;
  select f.is_qa into v_is_qa from public.families f where f.id = p_family_id for update;
  if v_is_qa is null then raise exception 'test family not found'; end if;
  if not v_is_qa then raise exception 'refusing to delete a non-test family'; end if;
  if exists (select 1 from public.family_auth_members m where m.auth_user_id = auth.uid() and m.family_id = p_family_id) then
    raise exception 'return to the original family before deleting this test family';
  end if;

  -- Clear user-restricting children before removing family profiles. The
  -- remaining dependent domain rows cascade with the family deletion.
  delete from public.walk_swap_requests where family_id = p_family_id;
  delete from public.time_change_requests where family_id = p_family_id;
  delete from public.remote_gps_commands where family_id = p_family_id;
  delete from public.remote_gps_audit where family_id = p_family_id;
  delete from public.walks where family_id = p_family_id;
  delete from public.schedule_entries where family_id = p_family_id;
  delete from public.schedule_rules where family_id = p_family_id;
  delete from public.users where family_id = p_family_id;

  delete from public.families where id = p_family_id and is_qa;
  perform public.log_system_audit_event(
    'family.test_deleted', 'family', p_family_id,
    jsonb_build_object('cleanup', 'QA family rows; tenant-scoped family photos are removed through the Storage API')
  );
end;
$$;
revoke all on function public.system_admin_delete_test_family(uuid, text) from public, anon;
grant execute on function public.system_admin_delete_test_family(uuid, text) to authenticated;
