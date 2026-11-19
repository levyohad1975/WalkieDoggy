-- v1.2 duplicate-resolution — deployed-vs-repository equivalence (READ-ONLY).
--
-- Staging recorded this migration as version 20261013164442 (applied outside
-- the CLI, which stamps its own version), while the repository carried it as
-- 20261013070000. The repository file is now named
-- 20261013164442_walk_duplicate_resolution_v12.sql with byte-identical content
-- (git rename, 100% similarity). This script proves the deployed objects are
-- the repository's objects before anything is built on them.
--
-- Expected values were computed from a database built by replaying the
-- repository migrations (PostgreSQL 16). Each object is fingerprinted from
-- catalog data: function bodies (prosrc) and settings, columns/defaults,
-- constraints, RLS policies, the marker trigger, and grants. A mismatch is
-- not automatically drift (a different PostgreSQL major version can render a
-- policy or default expression differently); inspect that object's definition
-- before proceeding. Function body mismatches are real drift: stop.
--
-- Ledger cross-check (if the ledger stored the SQL): the repository file's
-- md5 is 8318a215a8380446e2529949603f908a (8360 bytes, LF line endings);
-- md5 of its whitespace-trimmed content is db0b0d469db16fec0bb0eeae377d6a6c.

begin transaction read only;

with fp(object, fingerprint) as (
  select 'function resolve_duplicate_active_walks_v12', md5(concat_ws('|', p.prosrc, p.prosecdef, p.provolatile, coalesce(array_to_string(p.proconfig, ','), ''), pg_get_function_result(p.oid)))
    from pg_proc p where p.oid = to_regprocedure('public.resolve_duplicate_active_walks_v12(uuid[],uuid,text,uuid)')
  union all
  select 'function prevent_untrusted_duplicate_resolution_marker_change', md5(concat_ws('|', p.prosrc, p.prosecdef, p.provolatile, coalesce(array_to_string(p.proconfig, ','), '')))
    from pg_proc p where p.oid = to_regprocedure('public.prevent_untrusted_duplicate_resolution_marker_change()')
  union all
  select 'columns ' || c.relname, md5(string_agg(a.attname || ':' || format_type(a.atttypid, a.atttypmod) || ':' || a.attnotnull || ':' || coalesce(pg_get_expr(d.adbin, d.adrelid), ''), ',' order by a.attname))
    from pg_class c join pg_attribute a on a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
    left join pg_attrdef d on d.adrelid = c.oid and d.adnum = a.attnum
    where c.oid in ('public.walk_duplicate_resolution_groups'::regclass, 'public.walk_duplicate_resolution_items'::regclass)
    group by c.relname
  union all
  select 'constraints ' || c.relname, md5(string_agg(pg_get_constraintdef(k.oid), ',' order by pg_get_constraintdef(k.oid)))
    from pg_constraint k join pg_class c on c.oid = k.conrelid
    where c.oid in ('public.walk_duplicate_resolution_groups'::regclass, 'public.walk_duplicate_resolution_items'::regclass)
    group by c.relname
  union all
  select 'walks.duplicate_resolution_group_id', md5(concat_ws('|', format_type(a.atttypid, a.atttypmod), a.attnotnull,
      (select string_agg(pg_get_constraintdef(k.oid), ',') from pg_constraint k where k.conrelid = 'public.walks'::regclass and k.contype = 'f' and a.attnum = any(k.conkey)),
      col_description('public.walks'::regclass, a.attnum)))
    from pg_attribute a where a.attrelid = 'public.walks'::regclass and a.attname = 'duplicate_resolution_group_id'
  union all
  select 'policies ' || tablename, md5(string_agg(concat_ws('|', policyname, cmd, permissive, array_to_string(roles, ','), qual, with_check), ',' order by policyname))
    from pg_policies where schemaname = 'public' and tablename in ('walk_duplicate_resolution_groups', 'walk_duplicate_resolution_items')
    group by tablename
  union all
  select 'trigger walks_duplicate_resolution_marker_guard', md5(pg_get_triggerdef(t.oid))
    from pg_trigger t where t.tgrelid = 'public.walks'::regclass and t.tgname = 'walks_duplicate_resolution_marker_guard'
  union all
  select 'privileges', md5(concat_ws('|',
      (select c.relrowsecurity from pg_class c where c.oid = 'public.walk_duplicate_resolution_groups'::regclass),
      (select c.relrowsecurity from pg_class c where c.oid = 'public.walk_duplicate_resolution_items'::regclass),
      has_table_privilege('authenticated', 'public.walk_duplicate_resolution_groups', 'select'),
      has_table_privilege('authenticated', 'public.walk_duplicate_resolution_groups', 'insert'),
      has_table_privilege('authenticated', 'public.walk_duplicate_resolution_groups', 'update'),
      has_table_privilege('authenticated', 'public.walk_duplicate_resolution_groups', 'delete'),
      has_table_privilege('anon', 'public.walk_duplicate_resolution_groups', 'select'),
      has_table_privilege('authenticated', 'public.walk_duplicate_resolution_items', 'select'),
      has_table_privilege('authenticated', 'public.walk_duplicate_resolution_items', 'insert'),
      has_table_privilege('authenticated', 'public.walk_duplicate_resolution_items', 'update'),
      has_table_privilege('authenticated', 'public.walk_duplicate_resolution_items', 'delete'),
      has_table_privilege('anon', 'public.walk_duplicate_resolution_items', 'select'),
      has_function_privilege('authenticated', 'public.resolve_duplicate_active_walks_v12(uuid[],uuid,text,uuid)', 'execute'),
      has_function_privilege('anon', 'public.resolve_duplicate_active_walks_v12(uuid[],uuid,text,uuid)', 'execute'),
      has_function_privilege('authenticated', 'public.prevent_untrusted_duplicate_resolution_marker_change()', 'execute')))
),
expected(object, fingerprint) as (values
  ('columns walk_duplicate_resolution_groups', 'c9f549d546f5e05ff53c40c2d5a7df2a'),
  ('columns walk_duplicate_resolution_items', 'acdfbd4479cc50b7cc15df507745ca0b'),
  ('constraints walk_duplicate_resolution_groups', 'ee0eb925d32ba84353aa37015ea5be35'),
  ('constraints walk_duplicate_resolution_items', '54fc634a75f1bb7bd20cefd038c4159a'),
  ('function prevent_untrusted_duplicate_resolution_marker_change', '270562246fd316ec8f0bcb8cc407c487'),
  ('function resolve_duplicate_active_walks_v12', 'a432b338fbb4f8a0d110545ea8f15c40'),
  ('policies walk_duplicate_resolution_groups', 'a9c667616b2f5700ce1a29a1f5a8fda3'),
  ('policies walk_duplicate_resolution_items', 'e7092d9acff82896fcd8775ae8d799ff'),
  ('privileges', '020e6f9df8c4f133a6132b148d2089e4'),
  ('trigger walks_duplicate_resolution_marker_guard', '9f7505f34201ac0755c0840af5c29d66'),
  ('walks.duplicate_resolution_group_id', '6627d050c3acad53a8913bcc6e425e46')
)
select e.object, e.fingerprint as expected, f.fingerprint as actual, f.fingerprint is not distinct from e.fingerprint as matches
from expected e left join fp f on f.object = e.object
union all
select 'SUMMARY: ' || count(*) filter (where f.fingerprint is not distinct from e.fingerprint) || '/' || count(*) || ' v1.2 objects match the repository', null, null,
  bool_and(f.fingerprint is not distinct from e.fingerprint)
from expected e left join fp f on f.object = e.object
order by 4 nulls first, 1;

select version, name, cardinality(statements) as statement_count,
       md5(array_to_string(statements, '')) as md5_concat,
       md5(btrim(array_to_string(statements, E'\n'), E' \n\t')) as md5_trimmed_joined
from supabase_migrations.schema_migrations where version = '20261013164442';

rollback;
