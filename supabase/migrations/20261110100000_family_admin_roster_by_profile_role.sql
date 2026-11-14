-- Admin roster by profile role (found 2026-11-10, owner approved the fix).
--
-- family_admin_profile_ids() (0025) found admins through
-- family_auth_members.role = 'admin' joined to users.auth_user_id. Profiles
-- claimed on a device (profile_auth_sessions, the current model) never set
-- users.auth_user_id, so for a real family the roster was EMPTY: the T+30
-- "walk still not done" escalation (due_walk_reminders / send-walk-reminders)
-- never reached the admin.
--
-- Admin is the profile's role: users.role = 'admin' is exactly what
-- is_real_family_admin() checks. The roster now returns those profiles, and
-- keeps the old join for any legacy family that still relies on it. Same
-- signature and security; execution stays server-only (service_role), as
-- 0025 intended.

create or replace function public.family_admin_profile_ids(p_family_id uuid)
returns setof uuid
language sql stable security definer set search_path = public as $$
  select u.id
  from users u
  where u.family_id = p_family_id
    and u.role = 'admin'
    and u.removed_at is null
  union
  select u.id
  from family_auth_members m
  join users u on u.auth_user_id = m.auth_user_id and u.family_id = m.family_id
  where m.family_id = p_family_id
    and m.role = 'admin'
    and u.removed_at is null;
$$;

comment on function public.family_admin_profile_ids(uuid) is
  'Active (non-removed) Family Admin profile ids for a family (users.role = admin), for admin push fan-out. service_role only.';

revoke all on function public.family_admin_profile_ids(uuid) from public, anon, authenticated;
grant execute on function public.family_admin_profile_ids(uuid) to service_role;
