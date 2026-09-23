-- Disable cross-family system-admin observer access.
-- Any existing active observer session is ended before applying this migration.

create or replace function public.begin_system_admin_observer(p_family_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
begin
  if not is_system_admin() then
    raise exception 'system admin permission required';
  end if;

  raise exception 'cross-family system-admin observer access is disabled';
end;
$$;

revoke all on function public.begin_system_admin_observer(uuid) from public;
grant execute on function public.begin_system_admin_observer(uuid) to authenticated;
