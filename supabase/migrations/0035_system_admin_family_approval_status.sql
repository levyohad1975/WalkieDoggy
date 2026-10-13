-- ----------------------------------------------------------------------------
-- 0035_system_admin_family_approval_status.sql
--
-- BUG FIX — System Admin V1 read-only RPCs (0029) predate verified family
-- onboarding (0032/0033), which added a REAL families.approval_status
-- ('pending' | 'active' | 'rejected'). 0029's system_admin_list_families()
-- was written before that column existed and hardcoded the returned
-- `status` column to the literal 'active' for every row, with a comment
-- explaining that no lifecycle state existed yet. That is no longer true:
-- 0032 added real pending/rejected families (AUTO_APPROVE_NEW_FAMILIES),
-- and 0033 already gates every OTHER family-scoped RPC
-- (current_family_id/current_family_role/is_family_admin/
-- find_family_by_invite_code/join_family) on approval_status = 'active'.
-- system_admin_list_families()/system_admin_get_family_detail() were never
-- updated, so the one screen a system admin/owner has to review pending or
-- rejected families ("🛡️ ניהול מערכת") falsely reports every family,
-- including genuinely pending/rejected ones, as 'active'.
--
-- FIX: report the real families.approval_status column in both RPCs.
-- No signature change, no grant change, no RLS change, no client-visible
-- shape change beyond system_admin_get_family_detail()'s family object
-- gaining one new key (approvalStatus) — lib/systemAdmin.ts already passes
-- that object through verbatim, and system_admin_list_families()'s `status`
-- column was already read and surfaced by the client (lib/systemAdmin.ts /
-- SystemAdminScreen.tsx); only the value it carries changes from an always-
-- wrong constant to the real value. Purely a read-path correctness fix —
-- still v1 read-only, no mutation RPC added here.
-- ----------------------------------------------------------------------------

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
  'Batch 4 (item A) — System Admin V1 read-only family list, gated by is_system_admin(). Duplicate family names are expected and supported: invite_code is the caller-visible distinguishing identifier. Optional p_search matches family name, family code, or any active member''s name. status reflects the real families.approval_status (0035 fix — was hardcoded to ''active'' before verified family onboarding (0032) introduced pending/rejected families).';

create or replace function system_admin_get_family_detail(p_family_id uuid)
returns jsonb as $$
declare
  result jsonb;
  fam_exists boolean;
begin
  if not is_system_admin() then
    raise exception 'system admin permission required';
  end if;

  select exists(select 1 from families where id = p_family_id) into fam_exists;
  if not fam_exists then
    raise exception 'family not found';
  end if;

  -- Record the access BEFORE returning data — matches log_audit_event()'s
  -- own "record intent, then act" convention elsewhere in this schema.
  perform log_system_audit_event(
    'system_admin_view_family_detail', 'family', p_family_id, '{}'::jsonb
  );

  select jsonb_build_object(
    'family', (
      select jsonb_build_object(
        'id', f.id, 'name', f.name, 'inviteCode', f.invite_code, 'createdAt', f.created_at,
        'approvalStatus', f.approval_status
      )
      from families f where f.id = p_family_id
    ),
    'dog', (
      select jsonb_build_object(
        'id', d.id, 'name', d.name, 'photoUrl', d.photo_url, 'sex', d.sex, 'walksPerDay', d.walks_per_day
      )
      from dogs d where d.family_id = p_family_id limit 1
    ),
    'members', (
      select coalesce(jsonb_agg(
        jsonb_build_object(
          'id', u.id, 'name', u.name, 'avatar', u.avatar, 'photoUrl', u.photo_url,
          'role', u.role, 'removedAt', u.removed_at, 'claimed', u.auth_user_id is not null
        )
        order by u.removed_at nulls first, u.created_at
      ), '[]'::jsonb)
      from users u where u.family_id = p_family_id
    ),
    'walks', (
      select coalesce(jsonb_agg(
        jsonb_build_object(
          'id', w.id, 'date', w.date, 'scheduledTime', w.scheduled_time, 'status', w.status,
          'responsibleUserId', w.responsible_user_id, 'completedAt', w.completed_at, 'isUnplanned', w.is_unplanned
        )
        order by w.date desc, w.scheduled_time desc
      ), '[]'::jsonb)
      from (
        select * from walks w0 where w0.family_id = p_family_id
        order by w0.date desc, w0.scheduled_time desc
        limit 50
      ) w
    ),
    'activeRequests', (
      select coalesce(jsonb_agg(req), '[]'::jsonb) from (
        select jsonb_build_object(
          'kind', 'swap', 'id', sr.id, 'walkId', sr.walk_id,
          'requestedByUserId', sr.requested_by_user_id, 'targetUserId', sr.target_user_id,
          'status', sr.status, 'createdAt', sr.created_at
        ) as req
        from walk_swap_requests sr where sr.family_id = p_family_id and sr.status = 'pending'
        union all
        select jsonb_build_object(
          'kind', 'time_change', 'id', tr.id, 'walkId', tr.walk_id,
          'requestedByUserId', tr.requested_by_user_id, 'proposedTime', tr.proposed_time,
          'status', tr.status, 'createdAt', tr.created_at
        ) as req
        from time_change_requests tr where tr.family_id = p_family_id and tr.status = 'pending'
      ) combined
    ),
    'recentAudit', (
      select coalesce(jsonb_agg(
        jsonb_build_object(
          'id', al.id, 'action', al.action, 'targetType', al.target_type,
          'targetId', al.target_id, 'createdAt', al.created_at
        )
        order by al.created_at desc
      ), '[]'::jsonb)
      from (
        select * from audit_log al0 where al0.family_id = p_family_id
        order by al0.created_at desc
        limit 50
      ) al
    )
  ) into result;

  return result;
end;
$$ language plpgsql volatile security definer set search_path = public;

comment on function system_admin_get_family_detail(uuid) is
  'Batch 4 (item A) — System Admin V1 read-only family detail bundle, gated by is_system_admin(). Pure read (the only write is its own system_audit_log entry via log_system_audit_event()) — never touches family_auth_members/activeFamilyId, never creates membership, no impersonation. family.approvalStatus reflects the real families.approval_status (0035 fix).';
