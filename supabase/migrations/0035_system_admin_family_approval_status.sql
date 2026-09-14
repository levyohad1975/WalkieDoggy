-- ============================================================================
-- 0035_system_admin_family_approval_status.sql
--
-- Release-candidate compatibility patch for verified family onboarding.
-- Migration 0029 predates families.approval_status (added by 0032) and
-- therefore returned the literal 'active' for every family. That would make
-- pending/rejected onboarding requests look active in System Admin.
--
-- This replaces only the existing read RPC with the same signature and
-- return shape, sourcing status from families.approval_status. Approval and
-- rejection remain exclusively server-authoritative through
-- system_admin_set_family_approval() from 0032.
-- ============================================================================

create or replace function system_admin_list_families(p_search text default null)
returns table (
  family_id uuid,
  family_name text,
  invite_code text,
  created_at timestamptz,
  member_count int,
  admin_names text[],
  dog_name text,
  status text
) as $$
begin
  if not is_system_admin() then
    raise exception 'system admin permission required';
  end if;

  return query
  select
    f.id,
    f.name,
    f.invite_code,
    f.created_at,
    (select count(*)::int from users u where u.family_id = f.id and u.removed_at is null),
    (select coalesce(array_agg(u2.name order by u2.name), '{}')
       from users u2 where u2.family_id = f.id and u2.removed_at is null and u2.role = 'admin'),
    (select d.name from dogs d where d.family_id = f.id limit 1),
    f.approval_status
  from families f
  where
    p_search is null
    or length(trim(p_search)) = 0
    or f.name ilike '%' || trim(p_search) || '%'
    or f.invite_code ilike '%' || trim(p_search) || '%'
    or exists (
      select 1 from users su
      where su.family_id = f.id and su.removed_at is null and su.name ilike '%' || trim(p_search) || '%'
    )
  order by f.created_at desc;
end;
$$ language plpgsql stable security definer set search_path = public;

comment on function system_admin_list_families(text) is
  'System Admin family list, gated by is_system_admin(). Status reflects families.approval_status from verified onboarding; it is never inferred or hard-coded by the client.';

revoke all on function system_admin_list_families(text) from public;
grant execute on function system_admin_list_families(text) to authenticated;
