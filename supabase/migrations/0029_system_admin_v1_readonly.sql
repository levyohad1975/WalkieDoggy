-- ============================================================================
-- 0029_system_admin_v1_readonly.sql
--
-- Batch 4, item A — completes the System Admin capability whose foundation
-- (system_admins table, is_system_admin()/am_i_system_admin(),
-- system_audit_log/log_system_audit_event()) was added in migration 0024
-- ("Batch 1 foundation") and left deliberately unused until now. Adds the
-- two read-only RPCs the "🛡️ ניהול מערכת" screen needs — nothing else.
--
-- SCOPE — v1 read-only, exactly per the brief:
--   - system_admin_list_families(p_search)  — every family, with a
--     duplicate-name-safe distinguishing identifier (invite_code, already
--     unique per families_invite_code_key), member count, admin names,
--     status. Optional search by family name / family code / member name.
--   - system_admin_get_family_detail(p_family_id) — one read-only bundle:
--     family + dog, members + roles, recent schedule/walks, active
--     (pending) swap/time-change requests, and a slice of that family's OWN
--     audit_log (0005) — plus a system_audit_log entry recording that a
--     system admin opened this family (log_system_audit_event(), 0024).
--
-- WHAT THIS MIGRATION DELIBERATELY DOES NOT DO:
--   - No mutation RPC of any kind (no membership creation, no role change,
--     no impersonation, no data edit) — v1 is read-only, full stop.
--   - No bootstrap of `system_admins` — that table is still empty after
--     this migration runs. Every RPC below is unreachable by any real
--     account until a human explicitly inserts a row (see 0024's header
--     comment and the Batch 4 report's deployment steps) — is_system_admin()
--     resolves false for every caller until then, which these RPCs enforce
--     server-side (never trusting client-side UI hiding).
--   - Does not touch family_auth_members / activeFamilyId in any way —
--     these functions are pure SELECTs (plus one system_audit_log INSERT
--     via log_system_audit_event()); nothing here can change which family a
--     device is a member of, by construction.
--
-- log_system_audit_event() (0024) was left with EXECUTE revoked from
-- PUBLIC/authenticated on purpose, "callable only from inside another
-- SECURITY DEFINER function" — system_admin_get_family_detail() below is
-- exactly that caller, invoking it as a plain SQL function call (not an
-- RPC), which runs under this function's own SECURITY DEFINER privileges
-- regardless of the caller's own grants. No grant on log_system_audit_event
-- needs to change.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. system_admin_list_families(p_search text default null)
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
    -- No soft-delete/lifecycle state exists yet (Master Specification §12 —
    -- "soft-delete planned for later, not now"). Every family reported here
    -- is 'active'; this column exists so the client/report don't need a
    -- migration later just to start showing a real status.
    'active'
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
  'Batch 4 (item A) — System Admin V1 read-only family list, gated by is_system_admin(). Duplicate family names are expected and supported: invite_code is the caller-visible distinguishing identifier. Optional p_search matches family name, family code, or any active member''s name.';

revoke all on function system_admin_list_families(text) from public;
grant execute on function system_admin_list_families(text) to authenticated;

-- ----------------------------------------------------------------------------
-- 2. system_admin_get_family_detail(p_family_id uuid)
--
-- One read-only jsonb bundle — family+dog, members+roles, recent
-- schedule/walks (bounded to the latest 50, newest first — this is an
-- inspection tool, not a bulk export), active (pending) swap/time-change
-- requests, and the family's own recent audit_log (0005) entries (also
-- bounded to 50). Logs its own use to system_audit_log.
-- ----------------------------------------------------------------------------

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
      select jsonb_build_object('id', f.id, 'name', f.name, 'inviteCode', f.invite_code, 'createdAt', f.created_at)
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
  'Batch 4 (item A) — System Admin V1 read-only family detail bundle, gated by is_system_admin(). Pure read (the only write is its own system_audit_log entry via log_system_audit_event()) — never touches family_auth_members/activeFamilyId, never creates membership, no impersonation.';

revoke all on function system_admin_get_family_detail(uuid) from public;
grant execute on function system_admin_get_family_detail(uuid) to authenticated;
