-- Walk Lifecycle v1.1 — Staging PREFLIGHT (READ-ONLY).
--
-- Target: Staging project czbxhsoxyawprqehkfit ONLY. Never run on Production.
-- Run in the Supabase SQL editor of that project. The whole script executes
-- inside a READ ONLY transaction and ends with ROLLBACK: any accidental write
-- is rejected by Postgres (25006 read_only_sql_transaction).
--
-- It changes nothing, resolves nothing, and returns no GPS coordinates.
-- Output sections:
--   A. ledger            — which of v12 / v1.1 / capability migrations are recorded
--   B. lifecycle RPCs    — exact signatures, SECURITY DEFINER, EXECUTE grants
--   C. schema objects    — v1.1 tables/columns/index present or absent (drift check)
--   D. walks triggers    — guards on public.walks
--   E. duplicate gate    — the exact query the v1.1 migration runs first
--   F. duplicate audit   — every unresolved active walk of each conflicting dog
--   G. related evidence  — schedule entry, GPS session summary, audit_log rows
--   H. other active-walk anomalies the gate does not cover

begin transaction read only;

-- A. migration ledger -------------------------------------------------------
select 'A.ledger' as section, version, name
from supabase_migrations.schema_migrations
where version >= '20261010000000'
order by version;

select 'A.expected' as section, expected.version, expected.label,
       exists (select 1 from supabase_migrations.schema_migrations m where m.version = expected.version) as recorded
from (values
  ('20261013164442', 'walk_duplicate_resolution_v12 (expected: recorded)'),
  ('20261015100000', 'system_admin_duplicate_walk_repair_v12 (expected: recorded before the System Admin repair)'),
  ('20261015100100', 'walk_lifecycle_gps_v11 (expected: NOT recorded until the duplicate gate is clear)'),
  ('20261015100200', 'walk_lifecycle_capabilities_v11 (expected: recorded only after v1.1)')
) as expected(version, label)
order by expected.version;

-- A2. Ledger <-> repository reconciliation. Generated from the repository's
-- supabase/migrations at the commit that contains this file. Any row here
-- other than the three expected pending v1.1-path versions is drift that must
-- be explained before anything is applied.
with repo(version, file) as (values
    ('0001','0001_family_management_and_walk_details'),
    ('0002','0002_invite_codes_and_family_membership'),
    ('0003','0003_family_admin_roles'),
    ('0004','0004_admin_permissions_and_member_deletion'),
    ('0005','0005_requests_audit_presence'),
    ('0006','0006_qa_impersonation'),
    ('0007','0007_multi_admin_roles'),
    ('0008','0008_family_invites'),
    ('0009','0009_family_invites_pgcrypto_fix'),
    ('0010','0010_walk_not_done_status'),
    ('0011','0011_unplanned_walk_edit_delete'),
    ('0012','0012_walk_resolve_own_only'),
    ('0013','0013_push_tokens'),
    ('0014','0014_request_push_events'),
    ('0015','0015_scheduled_walk_occurrence_delete'),
    ('0016','0016_profile_pin_reclaim_and_qa_sandbox'),
    ('0017','0017_realtime_publication'),
    ('0018','0018_mutual_walk_swap_requests'),
    ('0019','0019_request_result_read_state'),
    ('0019','0019_request_result_seen_state'),
    ('0020','0020_multi_device_profile_sessions'),
    ('0021','0021_web_push_subscriptions'),
    ('0022','0022_family_timezone_and_dog_sex'),
    ('0023','0023_member_permission_overrides'),
    ('0024','0024_system_admin_foundation'),
    ('0025','0025_walk_reminder_scheduler'),
    ('0026','0026_admin_reschedule_walk'),
    ('0027','0027_history_statistics_server_enforcement'),
    ('0028','0028_family_invite_detail_preview'),
    ('0029','0029_system_admin_v1_readonly'),
    ('0030','0030_system_admin_verified_identity_only'),
    ('0031','0031_admin_mutual_walk_swap'),
    ('0032','0032_verified_family_onboarding'),
    ('0033','0033_verified_family_onboarding_cutover'),
    ('0034','0034_email_delivery_log'),
    ('0035','0035_system_admin_family_approval_status'),
    ('0036','0036_create_verified_family_timezone'),
    ('0037','0037_deactivate_push_on_member_removal'),
    ('0038','0038_restore_persona_authorization_with_active_family_gate'),
    ('0039','0039_clear_family_auth_membership_on_member_removal'),
    ('0040','0040_prevent_cross_family_membership_overwrite'),
    ('0041','0041_fail_closed_member_removal_completeness_check'),
    ('0042','0042_dogs_no_client_delete'),
    ('0043','0043_system_admin_global_audit'),
    ('0044','0044_system_admin_hidden_observer'),
    ('0045','0045_system_admin_observer_all_family_statuses'),
    ('0046','0046_system_admin_data_hotfix'),
    ('0047','0047_system_admin_global_audit_email_type_hotfix'),
    ('0048','0048_walk_lifecycle'),
    ('0049','0049_health_grooming_foundation'),
    ('0050','0050_health_task_recurrence'),
    ('0051','0051_walk_gps_sessions'),
    ('0052','0052_gamification_achievements'),
    ('0053','0053_walk_gps_route_points'),
    ('0054','0054_spontaneous_live_walk'),
    ('0055','0055_admin_remove_unused_dog'),
    ('0056','0056_admin_only_walk_delete'),
    ('0057','0057_dog_home_scene'),
    ('0058','0058_settings_permission'),
    ('0090','0090_gps_retention_and_family_activity_reset'),
    ('0091','0091_enable_gps_retention_cron'),
    ('0092','0092_fix_destructive_family_operations'),
    ('0093','0093_add_dog_home_visual_fields'),
    ('0094','0094_republish_family_activity_reset_rpc'),
    ('0096','0096_fix_delete_schedule_rule_admin_check'),
    ('0097','0097_delete_open_health_tasks'),
    ('0098','0098_preserve_schedule_entries_on_activity_reset'),
    ('0099','0099_prevent_duplicate_active_schedule_rules'),
    ('0100','0100_reset_generated_schedule_entries'),
    ('0101','0101_fix_redeem_invite_profile_session'),
    ('0102','0102_request_push_events_no_destination_status'),
    ('0103','0103_mark_results_seen_no_raise'),
    ('0103','0103_web_push_verified_admin_identity'),
    ('0104','0104_preserve_schedule_entries_on_activity_reset'),
    ('0105','0105_register_walk_reminder_cron'),
    ('0106','0106_schedule_entry_time_override_flag'),
    ('0107','0107_prevent_overlapping_schedule_rules'),
    ('0108','0108_family_chat'),
    ('0109','0109_private_chat_and_images'),
    ('0110','0110_remote_gps_commands'),
    ('20261010123756','20261010123756_chat_deletion_controls'),
    ('20261010160000','20261010160000_chat_admin_clear_direct'),
    ('20261010170000','20261010170000_remote_gps_activation'),
    ('20261010173000','20261010173000_remote_gps_heartbeat'),
    ('20261010174500','20261010174500_remote_gps_device_picker'),
    ('20261010180000','20261010180000_remote_gps_push_device_binding'),
    ('20261011104342','20261011104342_system_admin_test_families'),
    ('20261011104913','20261011104913_system_admin_test_family_storage_cleanup'),
    ('20261011180000','20261011180000_fix_system_admin_test_family_exit_ambiguous_id'),
    ('20261012053936','20261012053936_idempotent_schedule_entry_delete'),
    ('20261012061512','20261012061512_idempotent_schedule_rule_delete'),
    ('20261012154059','20261012154059_prevent_walk_cascade_on_schedule_entry_delete'),
    ('20261013164442','20261013164442_walk_duplicate_resolution_v12'),
    ('20261015100000','20261015100000_system_admin_duplicate_walk_repair_v12'),
    ('20261015100100','20261015100100_walk_lifecycle_gps_v11'),
    ('20261015100200','20261015100200_walk_lifecycle_capabilities_v11')
),
ledger as (select version, name from supabase_migrations.schema_migrations)
select 'A2.repo_not_in_ledger' as section, r.version, r.file as detail
from repo r where not exists (select 1 from ledger l where l.version = r.version)
union all
select 'A2.ledger_not_in_repo', l.version, l.name
from ledger l where not exists (select 1 from repo r where r.version = l.version)
order by 1, 2;

-- B. lifecycle RPC inventory ------------------------------------------------
select 'B.rpc' as section,
       p.oid::regprocedure::text as signature,
       p.prosecdef as security_definer,
       has_function_privilege('authenticated', p.oid, 'execute') as authenticated_can_execute,
       has_function_privilege('anon', p.oid, 'execute') as anon_can_execute
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and (p.proname in ('start_walk', 'finish_walk', 'resolve_duplicate_active_walks_v12', 'walk_lifecycle_server_capabilities')
       or p.proname like '%\_v11' escape '\')
order by p.proname;

-- C. v1.1 schema objects (absent = expected before activation; partial = drift)
select 'C.objects' as section, item, present from (
  select 'table public.walk_lifecycle_operations' as item, to_regclass('public.walk_lifecycle_operations') is not null as present
  union all select 'table public.walk_lifecycle_events', to_regclass('public.walk_lifecycle_events') is not null
  union all select 'table public.walk_gps_ownership', to_regclass('public.walk_gps_ownership') is not null
  union all select 'table public.walk_gps_route_samples_v11', to_regclass('public.walk_gps_route_samples_v11') is not null
  union all select 'table public.walk_lifecycle_notifications', to_regclass('public.walk_lifecycle_notifications') is not null
  union all select 'table public.walk_duplicate_resolution_groups (v12)', to_regclass('public.walk_duplicate_resolution_groups') is not null
  union all select 'table public.walk_duplicate_resolution_items (v12)', to_regclass('public.walk_duplicate_resolution_items') is not null
  union all select 'index public.walks_one_active_per_dog_uidx', to_regclass('public.walks_one_active_per_dog_uidx') is not null
  union all select 'column walks.actual_walker_user_id', exists (select 1 from information_schema.columns where table_schema='public' and table_name='walks' and column_name='actual_walker_user_id')
  union all select 'column walks.duplicate_resolution_group_id (v12)', exists (select 1 from information_schema.columns where table_schema='public' and table_name='walks' and column_name='duplicate_resolution_group_id')
  union all select 'column families.spontaneous_association_window_minutes', exists (select 1 from information_schema.columns where table_schema='public' and table_name='families' and column_name='spontaneous_association_window_minutes')
  union all select 'v1.1 dependency function public.real_current_profile_id()', to_regprocedure('public.real_current_profile_id()') is not null
  union all select 'v1.1 dependency function public.current_family_id()', to_regprocedure('public.current_family_id()') is not null
  union all select 'v1.1 dependency function public.is_family_admin(uuid)', to_regprocedure('public.is_family_admin(uuid)') is not null
  union all select 'v1.1 dependency column users.removed_at', exists (select 1 from information_schema.columns where table_schema='public' and table_name='users' and column_name='removed_at')
  union all select 'v1.1 dependency column walks.swap_original_user_id', exists (select 1 from information_schema.columns where table_schema='public' and table_name='walks' and column_name='swap_original_user_id')
  union all select 'v1.1 dependency column walks.ended_by_user_id', exists (select 1 from information_schema.columns where table_schema='public' and table_name='walks' and column_name='ended_by_user_id')
  union all select 'v1.1 dependency unique walk_gps_sessions(walk_id)', exists (
    select 1 from pg_index i join pg_attribute a on a.attrelid = i.indrelid and a.attnum = any(i.indkey)
    where i.indrelid = 'public.walk_gps_sessions'::regclass and i.indisunique and i.indnatts = 1 and a.attname = 'walk_id')
  union all select 'repair dependency function public.is_system_admin()', to_regprocedure('public.is_system_admin()') is not null
  union all select 'repair dependency function public.active_system_admin_observer_family()', to_regprocedure('public.active_system_admin_observer_family()') is not null
  union all select 'repair dependency function public.active_impersonation_target()', to_regprocedure('public.active_impersonation_target()') is not null
  union all select 'repair dependency table public.system_audit_log (actor_auth_user_id, action, target_type, target_id, metadata)', (
    select count(*) = 5 from information_schema.columns where table_schema='public' and table_name='system_audit_log'
      and column_name in ('actor_auth_user_id','action','target_type','target_id','metadata'))
  union all select 'repair dependency column auth.users.is_anonymous', exists (select 1 from information_schema.columns where table_schema='auth' and table_name='users' and column_name='is_anonymous')
  union all select 'repair dependency: walk write trigger honors app.trusted_write', coalesce((select prosrc like '%app.trusted_write%' from pg_proc where oid = to_regprocedure('public.enforce_walk_write_authorization()')), false)
  union all select 'repair dependency: v1.2 marker guard trigger present', exists (select 1 from pg_trigger where tgrelid = 'public.walks'::regclass and tgname = 'walks_duplicate_resolution_marker_guard')
  union all select 'pg_cron extension (for v1.1 route-sample pruning)', exists (select 1 from pg_extension where extname = 'pg_cron')
) objects order by item;

-- D. triggers on public.walks -----------------------------------------------
select 'D.trigger' as section, t.tgname, pg_get_triggerdef(t.oid) as definition, t.tgenabled
from pg_trigger t
where t.tgrelid = 'public.walks'::regclass and not t.tgisinternal
order by t.tgname;

-- E. the v1.1 migration's own fail-closed duplicate gate --------------------
select 'E.gate' as section, dog_id, count(*) as unresolved_active_walks
from public.walks
where status = 'in_progress' and duplicate_resolution_group_id is null
group by dog_id
having count(*) > 1
order by dog_id;

-- F. duplicate audit: every unresolved active walk of a conflicting dog -----
with conflicting as (
  select dog_id from public.walks
  where status = 'in_progress' and duplicate_resolution_group_id is null
  group by dog_id having count(*) > 1
)
select 'F.walk' as section,
       w.id as walk_id, w.family_id, f.name as family_name, f.is_qa as family_is_qa,
       w.dog_id, d.name as dog_name,
       w.schedule_entry_id, w.is_unplanned, w.date, w.scheduled_time, w.status,
       w.created_at, w.updated_at, w.started_at,
       w.started_by_user_id, starter.name as started_by_name,
       w.responsible_user_id, responsible.name as responsible_name,
       w.swap_original_user_id, w.swap_new_user_id, w.swap_swapped_at,
       w.completed_at, w.completed_by_user_id, w.ended_by_user_id,
       now() - w.started_at as active_for,
       row_number() over (partition by w.dog_id order by w.started_at nulls last, w.created_at, w.id) as start_order
from public.walks w
join conflicting c on c.dog_id = w.dog_id
join public.families f on f.id = w.family_id
join public.dogs d on d.id = w.dog_id
left join public.users starter on starter.id = w.started_by_user_id
left join public.users responsible on responsible.id = w.responsible_user_id
where w.status = 'in_progress' and w.duplicate_resolution_group_id is null
order by w.dog_id, start_order;

-- G1. schedule entry each active duplicate points to (does it still exist?) -
with conflicting as (
  select dog_id from public.walks
  where status = 'in_progress' and duplicate_resolution_group_id is null
  group by dog_id having count(*) > 1
)
select 'G1.schedule_entry' as section, w.id as walk_id, w.schedule_entry_id,
       se.id is not null as schedule_entry_exists, se.date as entry_date, se.time as entry_time,
       se.responsible_user_id as entry_responsible_user_id
from public.walks w
join conflicting c on c.dog_id = w.dog_id
left join public.schedule_entries se on se.id = w.schedule_entry_id
where w.status = 'in_progress' and w.duplicate_resolution_group_id is null
order by w.dog_id, w.started_at;

-- G2. GPS session summary per active duplicate (NO coordinates) -------------
with conflicting as (
  select dog_id from public.walks
  where status = 'in_progress' and duplicate_resolution_group_id is null
  group by dog_id having count(*) > 1
)
select 'G2.gps' as section, w.id as walk_id, s.id as gps_session_id, s.source,
       s.point_count, s.distance_meters, s.corrected_distance_meters,
       case when jsonb_typeof(s.route_points) = 'array' then jsonb_array_length(s.route_points) end as stored_route_point_count,
       s.started_at, s.ended_at, s.created_by_user_id, u.name as created_by_name, s.created_at, s.updated_at
from public.walks w
join conflicting c on c.dog_id = w.dog_id
left join public.walk_gps_sessions s on s.walk_id = w.id
left join public.users u on u.id = s.created_by_user_id
where w.status = 'in_progress' and w.duplicate_resolution_group_id is null
order by w.dog_id, w.started_at;

-- G3. audit_log rows targeting the active duplicates ------------------------
with conflicting as (
  select dog_id from public.walks
  where status = 'in_progress' and duplicate_resolution_group_id is null
  group by dog_id having count(*) > 1
)
select 'G3.audit' as section, a.target_id as walk_id, a.created_at, a.action,
       a.actor_user_id, u.name as actor_name, a.metadata
from public.audit_log a
join public.walks w on w.id = a.target_id and a.target_type = 'walk'
join conflicting c on c.dog_id = w.dog_id
left join public.users u on u.id = a.actor_user_id
where w.status = 'in_progress' and w.duplicate_resolution_group_id is null
order by a.target_id, a.created_at;

-- G4. any earlier audited resolution group for these dogs (v12) -------------
select 'G4.prior_resolution' as section, g.id, g.family_id, g.dog_id, g.canonical_walk_id,
       g.created_by_user_id, g.created_at, g.rationale, g.request_walk_ids
from public.walk_duplicate_resolution_groups g
where g.dog_id in (
  select dog_id from public.walks
  where status = 'in_progress' and duplicate_resolution_group_id is null
  group by dog_id having count(*) > 1
)
order by g.created_at;

-- H. other active-walk anomalies the uniqueness gate does not cover ----------
select 'H.anomaly' as section, w.id as walk_id, w.dog_id, w.status, w.started_at,
       case
         when w.status = 'in_progress' and w.started_at is null then 'in_progress without started_at'
         when w.status = 'in_progress' and w.started_at < now() - interval '24 hours' then 'in_progress for more than 24h'
         when w.status = 'in_progress' and w.duplicate_resolution_group_id is not null then 'already marked as resolved duplicate'
       end as anomaly
from public.walks w
where w.status = 'in_progress'
  and (w.started_at is null or w.started_at < now() - interval '24 hours' or w.duplicate_resolution_group_id is not null)
order by w.started_at nulls first;

-- I. System Admin maintenance authorizations (only after 20261015100000)
do $maintenance$
declare r record;
begin
  if to_regclass('public.system_maintenance_duplicate_walk_authorizations') is null then
    raise notice 'I.maintenance: table absent (20261015100000 not applied yet)';
    return;
  end if;
  for r in execute $q$
    select a.id, a.family_id, a.dog_id, a.walk_ids, a.expires_at, a.consumed_at, a.consumed_group_id,
      (select count(*) from public.walks w where w.id = any(a.walk_ids) and w.family_id = a.family_id
         and w.dog_id = a.dog_id and w.status = 'in_progress' and w.duplicate_resolution_group_id is null) as unresolved
    from public.system_maintenance_duplicate_walk_authorizations a order by a.created_at
  $q$ loop
    raise notice 'I.maintenance: id=% family=% dog=% walks=% unresolved=% expires=% consumed=% group=%',
      r.id, r.family_id, r.dog_id, r.walk_ids, r.unresolved, r.expires_at, r.consumed_at, r.consumed_group_id;
  end loop;
end;
$maintenance$;

rollback;
