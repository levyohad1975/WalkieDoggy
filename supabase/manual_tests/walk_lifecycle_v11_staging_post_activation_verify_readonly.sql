-- Walk Lifecycle v1.1 — Staging POST-ACTIVATION verification (READ-ONLY).
--
-- Target: Staging project czbxhsoxyawprqehkfit ONLY, after the separately
-- approved application of 20261013074334_walk_lifecycle_gps_v11.sql and
-- 20261015090000_walk_lifecycle_capabilities_v11.sql. Runs in a READ ONLY
-- transaction and ends with ROLLBACK. Every row must report ok = true; the
-- final row summarizes. No data is read beyond catalog metadata and counts.
-- If the capability migration was not applied, the whole query errors with
-- "function public.walk_lifecycle_server_capabilities() does not exist" —
-- that itself means activation is incomplete.

begin transaction read only;

with expected_rpc(signature, security_definer) as (
  values
    ('public.start_walk_v11(uuid,uuid,uuid,uuid,boolean,boolean)', true),
    ('public.start_spontaneous_walk_v11(uuid,uuid,uuid,date,text,uuid,uuid)', true),
    ('public.finish_walk_v11(uuid,uuid,uuid,uuid,boolean,boolean,text,timestamptz,boolean)', true),
    ('public.acquire_walk_gps_ownership_v11(uuid,boolean)', true),
    ('public.heartbeat_walk_gps_ownership_v11(uuid,bigint)', true),
    ('public.release_walk_gps_ownership_v11(uuid,bigint)', true),
    ('public.append_walk_gps_route_v11(uuid,bigint,jsonb,numeric,integer,timestamptz,timestamptz)', true),
    ('public.claim_walk_lifecycle_notifications_v11(uuid)', true),
    ('public.finish_walk_lifecycle_notification_delivery_v11(uuid[],boolean,text)', true),
    ('public.acknowledge_walk_lifecycle_notifications_v11(uuid[])', true),
    ('public.resolve_duplicate_active_walks_v12(uuid[],uuid,text,uuid)', true),
    ('public.walk_lifecycle_server_capabilities()', false)
),
rpc_checks as (
  select 'rpc ' || e.signature as check_name,
         fn is not null
           and p.prosecdef = e.security_definer
           and has_function_privilege('authenticated', fn, 'execute')
           and not has_function_privilege('anon', fn, 'execute') as ok,
         jsonb_build_object(
           'exists', fn is not null,
           'security_definer', p.prosecdef,
           'expected_security_definer', e.security_definer,
           'authenticated_execute', case when fn is null then null else has_function_privilege('authenticated', fn, 'execute') end,
           'anon_execute', case when fn is null then null else has_function_privilege('anon', fn, 'execute') end
         ) as detail
  from expected_rpc e
  cross join lateral (select to_regprocedure(e.signature) as fn) r
  left join pg_proc p on p.oid = r.fn
),
internal_checks as (
  select 'internal-only ' || sig as check_name,
         to_regprocedure(sig) is not null
           and not has_function_privilege('authenticated', to_regprocedure(sig), 'execute')
           and not has_function_privilege('anon', to_regprocedure(sig), 'execute') as ok,
         jsonb_build_object('exists', to_regprocedure(sig) is not null) as detail
  from unnest(array[
    'public.prune_walk_gps_route_samples_v11()',
    'public.prevent_untrusted_actual_walker_change()',
    'public.prevent_untrusted_duplicate_resolution_marker_change()'
  ]) as sig
),
table_checks as (
  select 'table ' || t.name as check_name,
         to_regclass(t.name) is not null
           and c.relrowsecurity
           and has_table_privilege('authenticated', to_regclass(t.name), 'select') = t.authenticated_select
           and not has_table_privilege('authenticated', to_regclass(t.name), 'insert')
           and not has_table_privilege('authenticated', to_regclass(t.name), 'update')
           and not has_table_privilege('authenticated', to_regclass(t.name), 'delete') as ok,
         -- Informational (does not fail the check): Supabase default
         -- privileges can leave anon SELECT / authenticated TRUNCATE on new
         -- tables. RLS policies are `to authenticated` only, and PostgREST
         -- exposes no TRUNCATE, so neither is reachable through the API.
         jsonb_build_object(
           'exists', to_regclass(t.name) is not null,
           'rls', c.relrowsecurity,
           'anon_select', case when to_regclass(t.name) is null then null else has_table_privilege('anon', to_regclass(t.name), 'select') end,
           'authenticated_truncate', case when to_regclass(t.name) is null then null else has_table_privilege('authenticated', to_regclass(t.name), 'truncate') end
         ) as detail
  from (values
    ('public.walk_lifecycle_operations', false),
    ('public.walk_lifecycle_events', true),
    ('public.walk_gps_ownership', true),
    ('public.walk_gps_route_samples_v11', true),
    ('public.walk_lifecycle_notifications', true),
    ('public.walk_duplicate_resolution_groups', true),
    ('public.walk_duplicate_resolution_items', true)
  ) as t(name, authenticated_select)
  left join pg_class c on c.oid = to_regclass(t.name)
),
index_checks as (
  select 'index public.walks_one_active_per_dog_uidx (unique, partial)' as check_name,
         coalesce(i.indisunique and i.indisvalid
           and pg_get_indexdef(i.indexrelid) ilike '%(dog_id)%'
           and pg_get_expr(i.indpred, i.indrelid) ilike '%in_progress%'
           and pg_get_expr(i.indpred, i.indrelid) ilike '%duplicate_resolution_group_id IS NULL%', false) as ok,
         jsonb_build_object('definition', pg_get_indexdef(i.indexrelid)) as detail
  from (select to_regclass('public.walks_one_active_per_dog_uidx') as idx) x
  left join pg_index i on i.indexrelid = x.idx
),
trigger_checks as (
  select 'trigger ' || trig_name as check_name,
         exists (select 1 from pg_trigger t where t.tgrelid = 'public.walks'::regclass and t.tgname = trig_name and t.tgenabled <> 'D') as ok,
         '{}'::jsonb as detail
  from unnest(array['walks_actual_walker_guard', 'walks_duplicate_resolution_marker_guard']) as trig_name
),
ledger_checks as (
  select 'ledger ' || v as check_name,
         exists (select 1 from supabase_migrations.schema_migrations m where m.version = v) as ok,
         '{}'::jsonb as detail
  from unnest(array['20261013070000', '20261013074334', '20261015090000']) as v
),
gate_checks as (
  select 'no unresolved duplicate active walks' as check_name,
         not exists (
           select 1 from public.walks
           where status = 'in_progress' and duplicate_resolution_group_id is null
           group by dog_id having count(*) > 1
         ) as ok,
         '{}'::jsonb as detail
),
probe_checks as (
  select 'capability probe reports nothing missing' as check_name,
         coalesce(jsonb_array_length(public.walk_lifecycle_server_capabilities()->'missing') = 0, false) as ok,
         public.walk_lifecycle_server_capabilities() as detail
),
all_checks as (
  select * from rpc_checks
  union all select * from internal_checks
  union all select * from table_checks
  union all select * from index_checks
  union all select * from trigger_checks
  union all select * from ledger_checks
  union all select * from gate_checks
  union all select * from probe_checks
)
select check_name, ok, detail from all_checks
union all
select 'SUMMARY: ' || count(*) filter (where ok) || '/' || count(*) || ' checks passed', bool_and(ok), '{}'::jsonb from all_checks
order by 2 nulls first, 1;

rollback;
