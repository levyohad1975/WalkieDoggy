-- Read-only security checks T8/T9 for migration
-- 20261017160000_reserve_profiles_during_system_admin_qa.sql.
-- Run only after that migration is applied to a disposable/local database.
-- This script performs catalog/table reads only; it does not impersonate users,
-- write fixtures, modify families, or inspect SyncQueue contents.

do $$
declare
  v_reservation_table oid := to_regclass('public.family_profile_reservations');
  v_users_table oid := to_regclass('public.users');
  v_sessions_table oid := to_regclass('public.profile_auth_sessions');
  v_snapshots_table oid := to_regclass('public.family_membership_snapshots');
  v_missing text[] := array[]::text[];
begin
  if v_reservation_table is null then raise exception 'T9 FAILED: reservation table is missing'; end if;
  if not (select c.relrowsecurity from pg_class c where c.oid = v_reservation_table) then
    raise exception 'T9 FAILED: reservation table RLS is disabled';
  end if;
  if has_table_privilege('authenticated', v_reservation_table, 'SELECT')
     or has_table_privilege('authenticated', v_reservation_table, 'INSERT')
     or has_table_privilege('authenticated', v_reservation_table, 'UPDATE')
     or has_table_privilege('authenticated', v_reservation_table, 'DELETE') then
    raise exception 'T9 FAILED: authenticated role can access private reservations';
  end if;

  -- T8: the generic trigger guards cover all public claim paths, including
  -- plain profile claim, PIN claim and invitation redemption, plus direct
  -- profile/session writes. They are the common DB-level enforcement point.
  if not exists (
    select 1 from pg_trigger t
    where t.tgrelid = v_users_table and not t.tgisinternal and t.tgenabled = 'O'
      and t.tgname = 'users_reserved_profile_claim_guard'
  ) then v_missing := array_append(v_missing, 'users claim guard'); end if;
  if not exists (
    select 1 from pg_trigger t
    where t.tgrelid = v_sessions_table and not t.tgisinternal and t.tgenabled = 'O'
      and t.tgname = 'profile_sessions_reserved_profile_guard'
  ) then v_missing := array_append(v_missing, 'profile session guard'); end if;
  if not exists (
    select 1 from pg_trigger t
    where t.tgrelid = v_snapshots_table and not t.tgisinternal and t.tgenabled = 'O'
      and t.tgname = 'family_membership_snapshot_reserve_profile'
  ) then v_missing := array_append(v_missing, 'reservation create trigger'); end if;
  if not exists (
    select 1 from pg_trigger t
    where t.tgrelid = v_snapshots_table and not t.tgisinternal and t.tgenabled = 'O'
      and t.tgname = 'family_membership_snapshot_release_profile'
  ) then v_missing := array_append(v_missing, 'reservation release trigger'); end if;
  if not exists (
    select 1 from pg_trigger t
    where t.tgrelid = v_snapshots_table and not t.tgisinternal and t.tgenabled = 'O'
      and t.tgname = 'family_membership_snapshot_immutable'
  ) then v_missing := array_append(v_missing, 'snapshot immutability trigger'); end if;
  if cardinality(v_missing) > 0 then
    raise exception 'T8 FAILED: required claim-path protection missing: %', array_to_string(v_missing, ', ');
  end if;

  if exists (
    select 1
    from pg_trigger t
    join pg_proc p on p.oid = t.tgfoid
    where t.tgname in (
      'users_reserved_profile_claim_guard',
      'profile_sessions_reserved_profile_guard',
      'family_membership_snapshot_reserve_profile',
      'family_membership_snapshot_release_profile',
      'family_membership_snapshot_immutable'
    )
      and (not p.prosecdef
        or p.proconfig is null
        or not exists (
          select 1 from unnest(p.proconfig) setting
          where replace(setting, ' ', '') = 'search_path=public,auth'
        )
        or has_function_privilege('authenticated', p.oid, 'EXECUTE'))
  ) then raise exception 'T8 FAILED: trigger functions lack SECURITY DEFINER/search_path hardening or are client-executable'; end if;

  -- T9: every active snapshot with a claimed profile has exactly its matching
  -- reservation; no reservation can belong to a missing/mismatched snapshot.
  if exists (
    select 1
    from public.family_membership_snapshots s
    join public.users u on u.id = s.claimed_user_id
    where s.claimed_user_id is not null
      and not exists (
        select 1 from public.family_profile_reservations r
        where r.auth_user_id = s.auth_user_id and r.profile_id = s.claimed_user_id
          and r.family_id = s.family_id and r.role = s.role
      )
  ) then raise exception 'T9 FAILED: active claimed-profile snapshot lacks its matching reservation'; end if;

  if exists (
    select 1 from public.family_profile_reservations r
    left join public.family_membership_snapshots s on s.auth_user_id = r.auth_user_id
    where s.auth_user_id is null or s.claimed_user_id is distinct from r.profile_id
      or s.family_id is distinct from r.family_id or s.role is distinct from r.role
  ) then raise exception 'T9 FAILED: orphaned or mismatched profile reservation'; end if;

  if exists (
    select 1
    from public.family_profile_reservations r
    join public.users u on u.id = r.profile_id
    where u.family_id is distinct from r.family_id
      or (u.auth_user_id is not null and u.auth_user_id is distinct from r.auth_user_id)
  ) then raise exception 'T9 FAILED: reserved profile family or auth owner changed'; end if;

  raise notice 'T8 PASSED: all claim paths are guarded by enabled database triggers.';
  raise notice 'T9 PASSED: reservations are private and match all active profile snapshots.';
end;
$$;
