-- Tutorial video capture session — Staging PRE/POST CHECK (READ-ONLY).
--
-- Target: Staging project czbxhsoxyawprqehkfit ONLY. Never run on Production.
-- Run in the Supabase SQL editor of that project, once BEFORE the capture
-- session (go/no-go) and once AFTER it (verify the owner's real family context
-- was restored). The whole script runs inside a READ ONLY transaction and ends
-- with ROLLBACK, so any accidental write is rejected (SQLSTATE 25006).
--
-- It prints no invite codes, PINs, tokens, e-mail addresses or GPS data.
-- Companion document: docs/product/tutorial-video/CAPTURE_SESSION_AUTHORIZATION.md
--
-- Sections:
--   T1. guarded RPCs the session relies on exist and are SECURITY DEFINER
--   T2. QA schema objects (families.is_qa, family_membership_snapshots)
--   T3. snapshot rows (expected 0 before the session and 0 after it)
--   T4. existing QA families and their content counts (no invite codes)
--   T5. Walk Lifecycle v1.1 activation ledger (gates C03/C05)
--   T6. family-deletion migrations ledger (decides the final cleanup path)
--   T7. OPTIONAL owner membership check — edit the e-mail placeholder first

begin transaction read only;

-- T1. RPCs -------------------------------------------------------------------
select 'T1.rpc' as section, expected.fn as function_name,
       exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
               where n.nspname = 'public' and p.proname = expected.fn) as present,
       coalesce((select bool_and(p.prosecdef) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                 where n.nspname = 'public' and p.proname = expected.fn), false) as security_definer
from (values
  ('system_admin_enter_test_family'),
  ('system_admin_switch_test_family'),
  ('system_admin_exit_test_family'),
  ('system_admin_get_active_test_family'),
  ('system_admin_list_test_families'),
  ('system_admin_delete_test_family'),
  ('system_admin_list_test_family_photo_paths'),
  ('current_family_is_qa'),
  ('join_family'),
  ('claim_family_profile'),
  ('claim_family_profile_with_pin'),
  ('set_member_role')
) as expected(fn)
order by expected.fn;

-- T2. schema objects ---------------------------------------------------------
select 'T2.schema' as section, 'families.is_qa' as object,
       exists (select 1 from information_schema.columns
               where table_schema = 'public' and table_name = 'families' and column_name = 'is_qa') as present
union all
select 'T2.schema', 'family_membership_snapshots',
       to_regclass('public.family_membership_snapshots') is not null;

-- T3. snapshot rows (one row per System Admin currently inside a QA family) ---
select 'T3.snapshots' as section, count(*) as active_snapshots,
       min(saved_at) as oldest_saved_at, max(saved_at) as newest_saved_at
from public.family_membership_snapshots;

-- T4. QA families and content (names only; invite codes deliberately omitted) -
select 'T4.qa_families' as section, f.name, f.created_at, f.approval_status,
       (select count(*) from public.family_auth_members m where m.family_id = f.id) as auth_members,
       (select count(*) from public.users u where u.family_id = f.id and u.removed_at is null) as active_profiles,
       (select count(*) from public.dogs d where d.family_id = f.id) as dogs,
       (select count(*) from public.schedule_rules r where r.family_id = f.id) as schedule_rules,
       (select count(*) from public.walks w where w.family_id = f.id) as walks,
       (select count(*) from public.walk_swap_requests s where s.family_id = f.id) as swap_requests,
       (select count(*) from public.time_change_requests t where t.family_id = f.id) as time_change_requests,
       (select count(*) from storage.objects o
         where o.bucket_id = 'family-photos' and o.name like f.id::text || '/%') as photo_objects
from public.families f
where f.is_qa
order by f.created_at desc;

select 'T4.name_check' as section, 'משפחת דוגמה' as planned_name,
       count(*) filter (where f.is_qa) as existing_qa_families_with_this_name,
       count(*) filter (where not f.is_qa) as existing_real_families_with_this_name
from public.families f
where f.name = 'משפחת דוגמה';

-- T5. Walk Lifecycle v1.1 (C03 start walk / C05 finish walk need it active) ---
select 'T5.v11_ledger' as section, expected.version, expected.label,
       exists (select 1 from supabase_migrations.schema_migrations m where m.version = expected.version) as recorded
from (values
  ('20261015100100', 'walk_lifecycle_gps_v11'),
  ('20261015100200', 'walk_lifecycle_capabilities_v11')
) as expected(version, label)
order by expected.version;

-- T6. family deletion migrations (final cleanup path) --------------------------
select 'T6.deletion_ledger' as section, expected.version, expected.label,
       exists (select 1 from supabase_migrations.schema_migrations m where m.version = expected.version) as recorded
from (values
  ('20261011104342', 'system_admin_test_families'),
  ('20261011104913', 'system_admin_test_family_storage_cleanup'),
  ('20261011180000', 'fix_system_admin_test_family_exit_ambiguous_id'),
  ('20261016115245', 'permanent_family_deletion'),
  ('20261016153000', 'freeze_family_deletion_window'),
  ('20261016172000', 'fix_family_deletion_storage_rls')
) as expected(version, label)
order by expected.version;

-- T7. OPTIONAL — the owner's own System Admin membership.
-- Replace OWNER_EMAIL_HERE with your System Admin e-mail in YOUR editor only
-- (never commit it). Expected BEFORE and AFTER the session:
--   current_family_is_qa = false, has_snapshot = false,
--   profile_session_family_matches = true (your real profile is claimed again).
-- DURING the session (between enter and exit): is_qa = true, has_snapshot = true.
with me as (
  select u.id from auth.users u where u.email = 'OWNER_EMAIL_HERE'
)
select 'T7.owner' as section,
       f.name as current_family_name,
       f.is_qa as current_family_is_qa,
       m.role as auth_role,
       exists (select 1 from public.family_membership_snapshots s where s.auth_user_id = me.id) as has_snapshot,
       exists (select 1 from public.profile_auth_sessions p
               where p.auth_user_id = me.id and p.family_id = m.family_id) as profile_session_family_matches
from me
join public.family_auth_members m on m.auth_user_id = me.id
join public.families f on f.id = m.family_id;

rollback;
