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

-- A2. Ledger <-> repository reconciliation (read-only inventory snapshot).
-- Staging has a tool-stamped baseline and historical versions that do not
-- equal the filenames of this repository's original migrations. Comparing
-- filename prefixes directly produced false drift. This inventory was read
-- from czbxhsoxyawprqehkfit on 2026-10-15 and records the exact version,
-- name, and SQL fingerprint currently deployed. No ledger rows are changed.
-- source_status is one of: exact, source_diverged, baseline_in_schema,
-- ledger_only, activation_pending. The three pending activation entries may
-- be absent before their step or present later, but their fingerprint must
-- match whenever recorded.
-- Historical source_diverged / ledger_only entries are retained as deployed;
-- the activation chain is checked separately below and must match exactly.
with expected_ledger(version, name, sql_md5, repository_source, source_status) as (values
    ('0000','base_schema','95fa66bfa43038082f5e7367690348f1','supabase/schema.sql','baseline_in_schema'),
    ('0032','verified_family_onboarding','2cc1700bb325387fe2ee54b608c87d68','supabase/migrations/0032_verified_family_onboarding.sql','source_diverged'),
    ('0034','email_delivery_log','642e620926b7677b2763bff9810556aa','supabase/migrations/0034_email_delivery_log.sql','source_diverged'),
    ('20260916112657','system_admin_family_approval_status','d67ab47e19cbfbba586e8111db42518e','supabase/migrations/0035_system_admin_family_approval_status.sql','exact'),
    ('20260916122849','repair_system_admin_foundation_for_verified_family','ae1545db10dcf7cd2d140a83fe18c493',null,'ledger_only'),
    ('20260916122907','lock_down_repaired_system_admin_foundation','1dff09e2437f7f73efe36d43d4219332',null,'ledger_only'),
    ('20260916122926','verified_family_onboarding_cutover','87cbbc6aea11cea2644f697299eac2be','supabase/migrations/0033_verified_family_onboarding_cutover.sql','source_diverged'),
    ('20260920130423','fix_system_admin_family_list_admin_names','80963e0ec073f94a0e655e94fcc5c101',null,'ledger_only'),
    ('20260921180357','restore_family_timezone_and_dog_sex_for_rc','896d33f38b0c822744b10a2a52a88065','supabase/migrations/0022_family_timezone_and_dog_sex.sql','exact'),
    ('20260921180402','restore_member_permission_overrides_for_rc','d58cc83a0332ff2ce4693eef0eb7785f','supabase/migrations/0023_member_permission_overrides.sql','exact'),
    ('20260921180408','restore_history_statistics_server_enforcement_for_rc','07f99012333ac3ccfc915190417422c3','supabase/migrations/0027_history_statistics_server_enforcement.sql','exact'),
    ('20260921181344','system_admin_global_audit_and_verified_email','803e647d512efbcb5525c96cb59c9ea8',null,'ledger_only'),
    ('20260921182548','system_admin_hidden_observer','ae8bd01c5334288e5b5e60bf52a6fde3','supabase/migrations/0044_system_admin_hidden_observer.sql','source_diverged'),
    ('20260921182718','system_admin_observer_all_family_statuses','8bbb5b89989862498f2443e3204de3fb','supabase/migrations/0045_system_admin_observer_all_family_statuses.sql','exact'),
    ('20260921185643','system_admin_data_hotfix','d493a8cb3cd102cefc1552dd34ef18ee','supabase/migrations/0046_system_admin_data_hotfix.sql','source_diverged'),
    ('20260921185709','system_admin_data_hotfix_requested_at','f582a8db53bbeea03136aa4f63b5b80c',null,'ledger_only'),
    ('20260921185814','system_admin_global_audit_email_type_hotfix','6c9f8061a06d6d89ddfc9c974f8c767f','supabase/migrations/0047_system_admin_global_audit_email_type_hotfix.sql','source_diverged'),
    ('20260921191545','system_admin_audit_detail_filter','922ef8d82a85b045cf6722efcb0a9731',null,'ledger_only'),
    ('20260923093724','walk_lifecycle','1313034ed7c1515a9f9243b9cff4360b','supabase/migrations/0048_walk_lifecycle.sql','exact'),
    ('20260923105926','disable_system_admin_cross_family_observer','a602b526da90ea3327a094ef1327d92b',null,'ledger_only'),
    ('20260923110507','restore_hidden_system_admin_observer','1c5816a47c2f91d6ca6b661788e76f1c',null,'ledger_only'),
    ('20260924113017','admin_remove_unused_dog','2f54e61b092e65889f262641222e1165','supabase/migrations/0055_admin_remove_unused_dog.sql','source_diverged'),
    ('20260924115710','family_invites_staging','9f0a81f7de1d29536911de39c1fee51e','supabase/migrations/0008_family_invites.sql','exact'),
    ('20260924121757','admin_only_walk_delete','68997327efb8a5b2b5eaeb42e9e8739b','supabase/migrations/0056_admin_only_walk_delete.sql','exact'),
    ('20260924143025','family_invite_detail_preview_staging','5699dfd2d20af0fd109a0c2aded71d84',null,'ledger_only'),
    ('20260926164435','settings_permission','d3336b276c94d870ab91cee566f6c693','supabase/migrations/0058_settings_permission.sql','exact'),
    ('20260927105555','walk_gps_sessions','824a98d1a11884f58d142541edf6b7c8','supabase/migrations/0051_walk_gps_sessions.sql','exact'),
    ('20260927105558','walk_gps_route_points','55958ed4a71f103d019add07137c852f','supabase/migrations/0053_walk_gps_route_points.sql','exact'),
    ('20260927123543','gps_retention_and_family_activity_reset','182f66222e7f15ae2a04a5aecfebf9b0','supabase/migrations/0090_gps_retention_and_family_activity_reset.sql','exact'),
    ('20260927123605','enable_gps_retention_cron','1cba13a2e68dfd1129ad114c102a59d1','supabase/migrations/0091_enable_gps_retention_cron.sql','exact'),
    ('20260927200602','fix_destructive_family_operations','f19b0be1889bd775645ad8305ca624c5','supabase/migrations/0092_fix_destructive_family_operations.sql','source_diverged'),
    ('20260927205436','add_dog_home_visual_fields','fa5b5a3e5424fc629e7f1d132eecdc70','supabase/migrations/0093_add_dog_home_visual_fields.sql','source_diverged'),
    ('20260929183854','republish_family_activity_reset_rpc','3b4c60dd4423fcb92a2dd1836b767843','supabase/migrations/0094_republish_family_activity_reset_rpc.sql','source_diverged'),
    ('20260929185646','fix_family_activity_reset_admin_check','1b55f729ed5b9a2f1e3dc9135121cec6',null,'ledger_only'),
    ('20260929193622','fix_delete_schedule_rule_admin_check','cf63e3d2b84f98c64b895cbb3697a697','supabase/migrations/0096_fix_delete_schedule_rule_admin_check.sql','source_diverged'),
    ('20261001133858','admin_mutual_walk_swap','d26b2596b704966dbe5f8d6cf3f8cc5c','supabase/migrations/0031_admin_mutual_walk_swap.sql','source_diverged'),
    ('20261001191054','preserve_schedule_entries_on_activity_reset','030bdc35ef75e013e40c86e4e1652793','supabase/migrations/0098_preserve_schedule_entries_on_activity_reset.sql','source_diverged'),
    ('20261002041925','prevent_duplicate_active_schedule_rules','d32c8b5a29e8b5eed272ab4ac5d35c45','supabase/migrations/0099_prevent_duplicate_active_schedule_rules.sql','source_diverged'),
    ('20261002044236','reset_generated_schedule_entries','c01507798a539a466c30ad32f7228c87','supabase/migrations/0100_reset_generated_schedule_entries.sql','source_diverged'),
    ('20261002135909','push_tokens','5e6c8e06edbe4d50942f040f9a48b7e8','supabase/migrations/0013_push_tokens.sql','source_diverged'),
    ('20261002135919','request_push_events','18339b41f3943e1b8052b3e0748fe698','supabase/migrations/0014_request_push_events.sql','source_diverged'),
    ('20261002135928','web_push_subscriptions','4677d96e2e1cdacd81a4fe66ff001b98','supabase/migrations/0021_web_push_subscriptions.sql','source_diverged'),
    ('20261002135952','walk_reminder_scheduler_core','613c17cd14deaf58695743882399a9fd',null,'ledger_only'),
    ('20261002140007','enable_pg_net_for_walk_reminders','b575d941e06b05a77f5f50d32b2a5c31',null,'ledger_only'),
    ('20261003205451','request_push_events_no_destination_status','34492e5300f3b49efb8639831d3ed975','supabase/migrations/0102_request_push_events_no_destination_status.sql','source_diverged'),
    ('20261004083638','mark_results_seen_no_raise','0665b2d166f790611e5b4091807e0262','supabase/migrations/0103_mark_results_seen_no_raise.sql','source_diverged'),
    ('20261004144351','admin_reschedule_walk','e18897f6a7984346936ed46592dd9f00','supabase/migrations/0026_admin_reschedule_walk.sql','exact'),
    ('20261004151530','preserve_schedule_entries_on_activity_reset','3dd389b63ba93a357f555f4009dd7a63','supabase/migrations/0098_preserve_schedule_entries_on_activity_reset.sql','source_diverged'),
    ('20261008104501','register_walk_reminder_cron','d156b76d635b21d501652a956603e280','supabase/migrations/0105_register_walk_reminder_cron.sql','source_diverged'),
    ('20261008120157','schedule_entry_time_override_flag','cec2e1d700257f737c82d1ac174edcf3','supabase/migrations/0106_schedule_entry_time_override_flag.sql','exact'),
    ('20261009103516','web_push_verified_admin_identity','2ab7222b19c4948a1fdfecef1cb07434','supabase/migrations/0103_web_push_verified_admin_identity.sql','source_diverged'),
    ('20261009190057','family_chat','9afd715f34806cb0ecbffd06be1a0836','supabase/migrations/0108_family_chat.sql','exact'),
    ('20261010053602','private_chat_and_images','3e73ba504a8e3aaf7a544ae9ff11ac75','supabase/migrations/0109_private_chat_and_images.sql','exact'),
    ('20261010123756','chat_deletion_controls','297c51ffd62c432747cc33d48c92477b','supabase/migrations/20261010123756_chat_deletion_controls.sql','exact'),
    ('20261010125813','chat_admin_clear_direct','08e8692bc59d1132f9310295da3f5c86','supabase/migrations/20261010160000_chat_admin_clear_direct.sql','exact'),
    ('20261010133346','remote_gps_commands','f97a329643ae94538845907c4b17be92','supabase/migrations/0110_remote_gps_commands.sql','exact'),
    ('20261010133709','remote_gps_activation','f60b7ab27fbe2c40494d5118e9d58d5f','supabase/migrations/20261010170000_remote_gps_activation.sql','exact'),
    ('20261010133947','remote_gps_heartbeat','b506bffa0190eac578ed29a4418be8e4','supabase/migrations/20261010173000_remote_gps_heartbeat.sql','exact'),
    ('20261010134939','remote_gps_device_picker','e8f58566e8e35e6a6c5025145902233d','supabase/migrations/20261010174500_remote_gps_device_picker.sql','exact'),
    ('20261010134944','remote_gps_push_device_binding','62c134ddbbcf756b3e9d5f46e81f00d4','supabase/migrations/20261010180000_remote_gps_push_device_binding.sql','exact'),
    ('20261010135017','remote_gps_push_device_binding','62c134ddbbcf756b3e9d5f46e81f00d4','supabase/migrations/20261010180000_remote_gps_push_device_binding.sql','exact'),
    ('20261011104342','system_admin_test_families','161f81e25e868d467ccb4cc034d0e8f8','supabase/migrations/20261011104342_system_admin_test_families.sql','source_diverged'),
    ('20261011104913','system_admin_test_family_storage_cleanup','633df793644b6c2006f2203d81a63113','supabase/migrations/20261011104913_system_admin_test_family_storage_cleanup.sql','exact'),
    ('20261011134427','fix_system_admin_test_family_exit_ambiguous_id','41b56c8dcfc4138d7a4dd7c030199408','supabase/migrations/20261011180000_fix_system_admin_test_family_exit_ambiguous_id.sql','exact'),
    ('20261012035407','0052_gamification_achievements','ca9faab91b81358e4b9f90d2460e0850','supabase/migrations/0052_gamification_achievements.sql','exact'),
    ('20261012053936','idempotent_schedule_entry_delete','f5879311b87bae46725e37a727e4790e','supabase/migrations/20261012053936_idempotent_schedule_entry_delete.sql','exact'),
    ('20261012061512','idempotent_schedule_rule_delete','6497752b038985caa43b8dae14931789','supabase/migrations/20261012061512_idempotent_schedule_rule_delete.sql','exact'),
    ('20261012154059','prevent_walk_cascade_on_schedule_entry_delete','930453423ed0c4a58c798b83731f4d5f','supabase/migrations/20261012154059_prevent_walk_cascade_on_schedule_entry_delete.sql','source_diverged'),
    ('20261013164442','walk_duplicate_resolution_v12','8318a215a8380446e2529949603f908a','supabase/migrations/20261013164442_walk_duplicate_resolution_v12.sql','exact'),
    ('20261015100000','system_admin_duplicate_walk_repair_v12','b113e071ac3caa3ae202963ed78b4629','supabase/migrations/20261015100000_system_admin_duplicate_walk_repair_v12.sql','activation_pending'),
    ('20261015100100','walk_lifecycle_gps_v11','53efca93204beec27e6dbcba3056bf45','supabase/migrations/20261015100100_walk_lifecycle_gps_v11.sql','activation_pending'),
    ('20261015100200','walk_lifecycle_capabilities_v11','2b1b0ae6a0467b6797a0b6345401962c','supabase/migrations/20261015100200_walk_lifecycle_capabilities_v11.sql','activation_pending')
), live_ledger as (
  select version, name, md5(array_to_string(statements, '')) as sql_md5
  from supabase_migrations.schema_migrations
)
select 'A2.ledger_drift' as section, 'missing_or_changed' as issue,
       e.version, e.name, e.sql_md5 as expected_md5, l.sql_md5 as live_md5,
       e.repository_source, e.source_status
from expected_ledger e left join live_ledger l using (version)
where (l.version is null and e.source_status <> 'activation_pending')
   or (l.version is not null and (l.name is distinct from e.name or l.sql_md5 is distinct from e.sql_md5))
union all
select 'A2.ledger_drift', 'unexpected_live_entry',
       l.version, l.name, null, l.sql_md5, null, null
from live_ledger l left join expected_ledger e using (version)
where e.version is null
union all
select 'A2.repo_inventory', e.source_status,
       e.version, e.name, e.sql_md5, l.sql_md5, e.repository_source, e.source_status
from expected_ledger e left join live_ledger l using (version)
order by 1, 2, 3;

-- A2b. Explicit activation-chain repository/ledger state at every stage.
select 'A2.activation_chain' as section, expected.version, expected.name,
       expected.repository_file, expected.activation_order,
       exists (select 1 from supabase_migrations.schema_migrations m
         where m.version = expected.version and m.name = expected.name) as actually_recorded
from (values
  ('20261013164442','walk_duplicate_resolution_v12','supabase/migrations/20261013164442_walk_duplicate_resolution_v12.sql','1. prerequisite'),
  ('20261015100000','system_admin_duplicate_walk_repair_v12','supabase/migrations/20261015100000_system_admin_duplicate_walk_repair_v12.sql','2. before authenticated System Admin repair'),
  ('20261015100100','walk_lifecycle_gps_v11','supabase/migrations/20261015100100_walk_lifecycle_gps_v11.sql','3. after duplicate gate is clear'),
  ('20261015100200','walk_lifecycle_capabilities_v11','supabase/migrations/20261015100200_walk_lifecycle_capabilities_v11.sql','4. after lifecycle migration')
) as expected(version,name,repository_file,activation_order)
order by expected.version;

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

-- C. Objects are checked against the migration stage already recorded.
-- Missing future objects are expected; partial or out-of-order DDL is drift.
with activation as (
  select
    exists (select 1 from supabase_migrations.schema_migrations where version = '20261015100000') as repair_applied,
    exists (select 1 from supabase_migrations.schema_migrations where version = '20261015100100') as lifecycle_applied,
    exists (select 1 from supabase_migrations.schema_migrations where version = '20261015100200') as capabilities_applied
), objects(item, present, expected_present) as (
  select 'table public.walk_lifecycle_operations', to_regclass('public.walk_lifecycle_operations') is not null, lifecycle_applied from activation
  union all select 'table public.walk_lifecycle_events', to_regclass('public.walk_lifecycle_events') is not null, lifecycle_applied from activation
  union all select 'table public.walk_gps_ownership', to_regclass('public.walk_gps_ownership') is not null, lifecycle_applied from activation
  union all select 'table public.walk_gps_route_samples_v11', to_regclass('public.walk_gps_route_samples_v11') is not null, lifecycle_applied from activation
  union all select 'table public.walk_lifecycle_notifications', to_regclass('public.walk_lifecycle_notifications') is not null, lifecycle_applied from activation
  union all select 'table public.walk_duplicate_resolution_groups (v12)', to_regclass('public.walk_duplicate_resolution_groups') is not null, true
  union all select 'table public.walk_duplicate_resolution_items (v12)', to_regclass('public.walk_duplicate_resolution_items') is not null, true
  union all select 'table public.system_maintenance_duplicate_walk_authorizations', to_regclass('public.system_maintenance_duplicate_walk_authorizations') is not null, repair_applied from activation
  union all select 'index public.walks_one_active_per_dog_uidx', to_regclass('public.walks_one_active_per_dog_uidx') is not null, lifecycle_applied from activation
  union all select 'column walks.actual_walker_user_id', exists (select 1 from information_schema.columns where table_schema='public' and table_name='walks' and column_name='actual_walker_user_id'), lifecycle_applied from activation
  union all select 'column walks.duplicate_resolution_group_id (v12)', exists (select 1 from information_schema.columns where table_schema='public' and table_name='walks' and column_name='duplicate_resolution_group_id'), true
  union all select 'column families.spontaneous_association_window_minutes', exists (select 1 from information_schema.columns where table_schema='public' and table_name='families' and column_name='spontaneous_association_window_minutes'), lifecycle_applied from activation
  union all select 'function public.walk_lifecycle_server_capabilities()', to_regprocedure('public.walk_lifecycle_server_capabilities()') is not null, capabilities_applied from activation
  union all select 'function public.require_verified_system_admin_for_maintenance()', to_regprocedure('public.require_verified_system_admin_for_maintenance()') is not null, repair_applied from activation
  union all select 'function public.system_admin_list_duplicate_walk_authorizations()', to_regprocedure('public.system_admin_list_duplicate_walk_authorizations()') is not null, repair_applied from activation
  union all select 'function public.system_admin_resolve_authorized_duplicate_walks_v12(uuid,uuid)', to_regprocedure('public.system_admin_resolve_authorized_duplicate_walks_v12(uuid,uuid)') is not null, repair_applied from activation
  union all select 'v1.1 dependency function public.real_current_profile_id()', to_regprocedure('public.real_current_profile_id()') is not null, true
  union all select 'v1.1 dependency function public.current_family_id()', to_regprocedure('public.current_family_id()') is not null, true
  union all select 'v1.1 dependency function public.is_family_admin(uuid)', to_regprocedure('public.is_family_admin(uuid)') is not null, true
  union all select 'v1.1 dependency column users.removed_at', exists (select 1 from information_schema.columns where table_schema='public' and table_name='users' and column_name='removed_at'), true
  union all select 'v1.1 dependency column walks.swap_original_user_id', exists (select 1 from information_schema.columns where table_schema='public' and table_name='walks' and column_name='swap_original_user_id'), true
  union all select 'v1.1 dependency column walks.ended_by_user_id', exists (select 1 from information_schema.columns where table_schema='public' and table_name='walks' and column_name='ended_by_user_id'), true
  union all select 'v1.1 dependency unique walk_gps_sessions(walk_id)', exists (
    select 1 from pg_index i join pg_attribute a on a.attrelid = i.indrelid and a.attnum = any(i.indkey)
    where i.indrelid = 'public.walk_gps_sessions'::regclass and i.indisunique and i.indnatts = 1 and a.attname = 'walk_id'), true
  union all select 'repair dependency function public.is_system_admin()', to_regprocedure('public.is_system_admin()') is not null, true
  union all select 'repair dependency function public.active_system_admin_observer_family()', to_regprocedure('public.active_system_admin_observer_family()') is not null, true
  union all select 'repair dependency function public.active_impersonation_target()', to_regprocedure('public.active_impersonation_target()') is not null, true
  union all select 'repair dependency table public.system_audit_log (actor_auth_user_id, action, target_type, target_id, metadata)', (
    select count(*) = 5 from information_schema.columns where table_schema='public' and table_name='system_audit_log'
      and column_name in ('actor_auth_user_id','action','target_type','target_id','metadata')), true
  union all select 'repair dependency column auth.users.is_anonymous', exists (select 1 from information_schema.columns where table_schema='auth' and table_name='users' and column_name='is_anonymous'), true
  union all select 'repair dependency: deployed walks_admin_only_delete trigger uses app.trusted_write', exists (
    select 1 from pg_trigger t join pg_proc p on p.oid = t.tgfoid
    where t.tgrelid = 'public.walks'::regclass and t.tgname = 'walks_admin_only_delete'
      and not t.tgisinternal and p.proname = 'enforce_admin_only_walk_delete'
      and p.prosrc like '%app.trusted_write%'), true
  union all select 'repair dependency: deployed duplicate marker guard and function present', exists (
    select 1 from pg_trigger t join pg_proc p on p.oid = t.tgfoid
    where t.tgrelid = 'public.walks'::regclass and t.tgname = 'walks_duplicate_resolution_marker_guard'
      and not t.tgisinternal and p.proname = 'prevent_untrusted_duplicate_resolution_marker_change'
      and p.prosrc like '%duplicate resolution must use the audited administrator operation%'
      and p.prosrc like '%current_user <> ''postgres''%'), true
  union all select 'pg_cron extension (for v1.1 route-sample pruning)', exists (select 1 from pg_extension where extname = 'pg_cron'), true
)
select 'C.objects' as section, item, present, expected_present,
       present is not distinct from expected_present as matches_expected
from objects order by item;

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
