-- Keep physical family-photo cleanup on the Supabase Storage API. Database
-- rows in storage.objects are metadata only and must not be deleted directly.

create or replace function public.is_verified_system_admin()
returns boolean language sql stable security definer set search_path = public, auth
as $$
  select exists (
    select 1 from auth.users u
    where u.id = auth.uid() and not coalesce(u.is_anonymous, true)
      and u.email is not null and u.email_confirmed_at is not null
  ) and public.is_system_admin();
$$;
revoke all on function public.is_verified_system_admin() from public, anon;
grant execute on function public.is_verified_system_admin() to authenticated;

create or replace function public.system_admin_list_test_family_photo_paths(p_family_id uuid)
returns table (object_path text)
language plpgsql stable security definer set search_path = public, auth, storage
as $$
begin
  if not public.is_verified_system_admin() then raise exception 'verified system admin required'; end if;
  if not exists (
    select 1 from public.families f
    where f.id = p_family_id and f.is_qa
      and not exists (select 1 from public.family_auth_members m where m.auth_user_id = auth.uid() and m.family_id = f.id)
  ) then raise exception 'test family not found or currently active'; end if;
  return query select o.name
  from storage.objects o
  where o.bucket_id = 'family-photos' and o.name like p_family_id::text || '/%'
  order by o.name;
end;
$$;
revoke all on function public.system_admin_list_test_family_photo_paths(uuid) from public, anon;
grant execute on function public.system_admin_list_test_family_photo_paths(uuid) to authenticated;

drop policy if exists "System Admin delete inactive QA family photos" on storage.objects;
create policy "System Admin delete inactive QA family photos"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'family-photos'
    and public.is_verified_system_admin()
    and public.active_system_admin_observer_family() is null
    and exists (
      select 1 from public.families f
      where f.is_qa and f.id::text = (storage.foldername(name))[1]
        and not exists (select 1 from public.family_auth_members m where m.auth_user_id = auth.uid() and m.family_id = f.id)
    )
  );

create or replace function public.system_admin_delete_test_family(p_family_id uuid, p_confirm text)
returns void language plpgsql volatile security definer set search_path = public, auth
as $$
declare
  v_is_qa boolean;
begin
  if not public.is_verified_system_admin() then raise exception 'verified system admin required'; end if;
  if p_confirm is distinct from 'DELETE TEST FAMILY' then raise exception 'explicit confirmation required'; end if;
  select f.is_qa into v_is_qa from public.families f where f.id = p_family_id for update;
  if v_is_qa is null then raise exception 'test family not found'; end if;
  if not v_is_qa then raise exception 'refusing to delete a non-test family'; end if;
  if exists (select 1 from public.family_auth_members m where m.auth_user_id = auth.uid() and m.family_id = p_family_id) then
    raise exception 'return to the original family before deleting this test family';
  end if;

  -- Clear user-restricting children before removing family profiles; all
  -- remaining family-owned rows are removed by their tenant foreign keys.
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
    jsonb_build_object('cleanup', 'QA family rows; tenant-scoped photos removed through Storage API')
  );
end;
$$;
revoke all on function public.system_admin_delete_test_family(uuid, text) from public, anon;
grant execute on function public.system_admin_delete_test_family(uuid, text) to authenticated;
