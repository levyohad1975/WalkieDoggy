-- Add per-member Settings visibility permission.
-- Default behavior is enforced by the app: family admins always have access;
-- ordinary members require an explicit allowed override.

alter table member_permission_overrides
  drop constraint if exists member_permission_overrides_permission_key_check;

alter table member_permission_overrides
  add constraint member_permission_overrides_permission_key_check
  check (permission_key in ('view_history', 'view_statistics', 'view_settings'));

create or replace function set_member_permission_override(
  p_user_id uuid,
  p_permission_key text,
  p_allowed boolean
)
returns void as $$
declare
  admin_profile uuid;
  target_family uuid;
  target_removed_at timestamptz;
begin
  admin_profile := current_profile_id();
  if admin_profile is null then raise exception 'no active profile claimed on this family'; end if;
  if p_permission_key not in ('view_history', 'view_statistics', 'view_settings') then raise exception 'unknown permission_key'; end if;

  select family_id, removed_at into target_family, target_removed_at from users where id = p_user_id;
  if target_family is null or target_family is distinct from current_family_id() then raise exception 'user not found'; end if;
  if not is_family_admin(target_family) then raise exception 'admin permission required'; end if;
  if target_removed_at is not null then raise exception 'cannot set a permission override for a removed member'; end if;

  insert into member_permission_overrides (family_id, user_id, permission_key, allowed, set_by_user_id, updated_at)
  values (target_family, p_user_id, p_permission_key, p_allowed, admin_profile, now())
  on conflict (user_id, permission_key) do update
    set allowed = excluded.allowed, set_by_user_id = excluded.set_by_user_id, updated_at = now();

  perform log_audit_event(target_family, admin_profile, 'member_permission_override_set', 'user', p_user_id,
    jsonb_build_object('permission_key', p_permission_key, 'allowed', p_allowed));
end;
$$ language plpgsql volatile security definer set search_path = public;

revoke all on function set_member_permission_override(uuid, text, boolean) from public;
grant execute on function set_member_permission_override(uuid, text, boolean) to authenticated;

create or replace function clear_member_permission_override(
  p_user_id uuid,
  p_permission_key text
)
returns void as $$
declare
  admin_profile uuid;
  target_family uuid;
begin
  admin_profile := current_profile_id();
  if admin_profile is null then raise exception 'no active profile claimed on this family'; end if;
  if p_permission_key not in ('view_history', 'view_statistics', 'view_settings') then raise exception 'unknown permission_key'; end if;

  select family_id into target_family from users where id = p_user_id;
  if target_family is null or target_family is distinct from current_family_id() then raise exception 'user not found'; end if;
  if not is_family_admin(target_family) then raise exception 'admin permission required'; end if;

  delete from member_permission_overrides where user_id = p_user_id and permission_key = p_permission_key;

  perform log_audit_event(target_family, admin_profile, 'member_permission_override_cleared', 'user', p_user_id,
    jsonb_build_object('permission_key', p_permission_key));
end;
$$ language plpgsql volatile security definer set search_path = public;

revoke all on function clear_member_permission_override(uuid, text) from public;
grant execute on function clear_member_permission_override(uuid, text) to authenticated;
