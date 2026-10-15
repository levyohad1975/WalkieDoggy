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
  ('20261013070000', 'walk_duplicate_resolution_v12 (expected: recorded)'),
  ('20261013073000', 'system_admin_duplicate_walk_repair_v12 (expected: recorded before resolution)'),
  ('20261013074334', 'walk_lifecycle_gps_v11 (expected: NOT recorded until approved)'),
  ('20261015090000', 'walk_lifecycle_capabilities_v11 (expected: NOT recorded until approved)')
) as expected(version, label)
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

-- I. System Admin maintenance authorizations (only after 20261013073000)
do $maintenance$
declare r record;
begin
  if to_regclass('public.system_maintenance_duplicate_walk_authorizations') is null then
    raise notice 'I.maintenance: table absent (20261013073000 not applied yet)';
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
