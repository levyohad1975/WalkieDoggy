-- Repair System Admin return from QA family.
-- The RETURNS TABLE output column "id" is a PL/pgSQL variable; qualify users.id
-- so restoring the original profile cannot fail with SQLSTATE 42702.
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
  from public.family_auth_members m
  join public.families f on f.id = m.family_id
  where m.auth_user_id = auth.uid();

  -- A retry after a successful response was lost is harmless and idempotent:
  -- return the currently authorized non-QA membership without mutating it.
  if v_current_family is not null and not coalesce(v_is_qa, false)
     and not exists (
       select 1 from public.family_membership_snapshots s
       where s.auth_user_id = auth.uid()
     ) then
    return query
      select f.id, f.name from public.families f where f.id = v_current_family;
    return;
  end if;

  if v_current_family is null or not coalesce(v_is_qa, false) then
    raise exception 'not currently in a test family';
  end if;

  select * into v_snapshot
  from public.family_membership_snapshots s
  where s.auth_user_id = auth.uid();
  if v_snapshot.auth_user_id is null then
    raise exception 'no original family snapshot is available';
  end if;

  delete from public.profile_auth_sessions
  where auth_user_id = auth.uid();

  perform set_config('app.trusted_write', 'on', true);

  update public.users as qa_profile
  set auth_user_id = null
  where qa_profile.auth_user_id = auth.uid();

  update public.family_auth_members as membership
  set family_id = v_snapshot.family_id, role = v_snapshot.role
  where membership.auth_user_id = auth.uid();

  if v_snapshot.claimed_user_id is not null then
    insert into public.profile_auth_sessions(auth_user_id, family_id, user_id)
    select auth.uid(), v_snapshot.family_id, original_profile.id
    from public.users as original_profile
    where original_profile.id = v_snapshot.claimed_user_id
      and original_profile.family_id = v_snapshot.family_id
      and original_profile.removed_at is null
    on conflict (auth_user_id) do update
      set family_id = excluded.family_id,
          user_id = excluded.user_id,
          updated_at = now();

    update public.users as original_profile
    set auth_user_id = auth.uid()
    where original_profile.id = v_snapshot.claimed_user_id
      and original_profile.family_id = v_snapshot.family_id
      and original_profile.removed_at is null;
  end if;

  perform set_config('app.trusted_write', 'off', true);

  delete from public.family_membership_snapshots
  where auth_user_id = auth.uid();

  perform public.log_system_audit_event(
    'family.test_exited', 'family', v_current_family,
    jsonb_build_object('returned_to_family_id', v_snapshot.family_id)
  );

  return query
    select f.id, f.name
    from public.families f
    where f.id = v_snapshot.family_id;
end;
$$;

revoke all on function public.system_admin_exit_test_family() from public, anon;
grant execute on function public.system_admin_exit_test_family() to authenticated;
