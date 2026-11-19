-- "🟢 מי אונליין" in the System Admin console (owner request 2026-11-02).
--
-- Every family with its identifying details (family name alone is not
-- unique: invite code, family admins, verified creation email, dogs) and
-- each active member's last_seen_at from user_presence. Verified System
-- Admin only; read-only; no new table and nothing logged per heartbeat.

create or replace function public.system_admin_list_presence()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare result jsonb;
begin
  if auth.uid() is null or not public.is_verified_system_admin() then
    raise exception 'verified system admin required' using errcode = '42501';
  end if;

  select coalesce(jsonb_agg(fam order by (fam->>'last_seen_at') desc nulls last, fam->>'family_name'), '[]'::jsonb)
  into result
  from (
    select jsonb_build_object(
      'family_id', f.id,
      'family_name', f.name,
      'invite_code', f.invite_code,
      'status', f.approval_status,
      'created_at', f.created_at,
      'verified_email', (
        select r.verified_email from public.family_onboarding_requests r
        where r.family_id = f.id and r.verified_email is not null
        order by r.requested_at desc limit 1),
      'admin_names', (
        select coalesce(jsonb_agg(distinct u2.name), '[]'::jsonb) from public.users u2
        where u2.family_id = f.id and u2.removed_at is null
          and exists (
            select 1 from public.family_auth_members fam
            where fam.family_id = f.id and fam.role = 'admin'
              and (fam.auth_user_id = u2.auth_user_id
                or exists (select 1 from public.profile_auth_sessions pas
                  where pas.family_id = f.id and pas.user_id = u2.id and pas.auth_user_id = fam.auth_user_id)))),
      'dog_names', (
        select coalesce(jsonb_agg(d.name order by d.created_at), '[]'::jsonb) from public.dogs d where d.family_id = f.id),
      'last_seen_at', (select max(p.last_seen_at) from public.user_presence p where p.family_id = f.id),
      'members', (
        select coalesce(jsonb_agg(jsonb_build_object(
            'user_id', u.id,
            'name', u.name,
            'avatar', u.avatar,
            'role', u.role,
            'claimed', (u.auth_user_id is not null
              or exists (select 1 from public.profile_auth_sessions pas where pas.family_id = f.id and pas.user_id = u.id)),
            'last_seen_at', p.last_seen_at)
          order by p.last_seen_at desc nulls last, u.name), '[]'::jsonb)
        from public.users u
        left join public.user_presence p on p.user_id = u.id and p.family_id = f.id
        where u.family_id = f.id and u.removed_at is null)
    ) as fam
    from public.families f
  ) x;
  return result;
end $$;
revoke all on function public.system_admin_list_presence() from public, anon;
grant execute on function public.system_admin_list_presence() to authenticated;
