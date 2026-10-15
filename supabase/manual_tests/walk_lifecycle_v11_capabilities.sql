-- Isolated CI rehearsal only. Runs after 20261015100100_walk_lifecycle_gps_v11.sql
-- and 20261015100200_walk_lifecycle_capabilities_v11.sql. Everything below is
-- rolled back.
--
-- Covers the client's Walk Lifecycle v1.1 server version gate:
-- (1) a fully activated server reports lifecycle_version 1.1 with nothing missing,
--     evaluated for the API role `authenticated` (SECURITY INVOKER),
-- (2) `anon` cannot call the probe,
-- (3) a revoked EXECUTE grant on a lifecycle RPC is reported, not hidden,
-- (4) a missing lifecycle RPC (exact signature) is reported,
-- (5) a missing one-active-walk-per-dog index is reported,
-- (6) the probe itself is read-only: it is STABLE and changes no rows.
do $guard$
begin
  if current_database() <> 'postgres'
     or current_setting('app.walk_duplicate_fixture', true) is distinct from 'local' then
    raise exception 'Lifecycle capability check requires the isolated CI session flag';
  end if;
end;
$guard$;

begin;

do $shape$
declare fn regprocedure := to_regprocedure('public.walk_lifecycle_server_capabilities()');
begin
  if fn is null then raise exception 'capability probe is missing'; end if;
  if (select provolatile from pg_proc where oid = fn) <> 's' then raise exception 'capability probe must be STABLE'; end if;
  if (select prosecdef from pg_proc where oid = fn) then raise exception 'capability probe must be SECURITY INVOKER'; end if;
  if has_function_privilege('anon', fn, 'execute') then raise exception 'anon must not execute the capability probe'; end if;
  if not has_function_privilege('authenticated', fn, 'execute') then raise exception 'authenticated must execute the capability probe'; end if;
end;
$shape$;

-- (1) fully activated, as the API role
set local role authenticated;
do $supported$
declare result jsonb := public.walk_lifecycle_server_capabilities();
begin
  if result->>'lifecycle_version' is distinct from '1.1' then raise exception 'unexpected version: %', result; end if;
  if jsonb_array_length(result->'missing') <> 0 then raise exception 'fully activated server reported missing items: %', result->'missing'; end if;
end;
$supported$;
reset role;

-- (2) anon is refused
set local role anon;
do $anon$
begin
  perform public.walk_lifecycle_server_capabilities();
  raise exception 'anon unexpectedly executed the capability probe';
exception when insufficient_privilege then
  null;
end;
$anon$;
reset role;

-- (3) revoked execute grant is reported for the calling role
savepoint revoked_grant;
revoke execute on function public.start_walk_v11(uuid,uuid,uuid,uuid,boolean,boolean) from authenticated;
set local role authenticated;
do $revoked$
declare result jsonb := public.walk_lifecycle_server_capabilities();
begin
  if not (result->'missing') ? 'execute:public.start_walk_v11(uuid,uuid,uuid,uuid,boolean,boolean)' then
    raise exception 'revoked execute grant was not reported: %', result->'missing';
  end if;
end;
$revoked$;
reset role;
rollback to savepoint revoked_grant;

-- (4) a lifecycle RPC with the expected signature is absent
savepoint missing_rpc;
alter function public.finish_walk_v11(uuid,uuid,uuid,uuid,boolean,boolean,text,timestamptz,boolean)
  rename to finish_walk_v11_hidden_for_capability_test;
set local role authenticated;
do $missing$
declare result jsonb := public.walk_lifecycle_server_capabilities();
begin
  if not (result->'missing') ? 'function:public.finish_walk_v11(uuid,uuid,uuid,uuid,boolean,boolean,text,timestamptz,boolean)' then
    raise exception 'missing finish_walk_v11 was not reported: %', result->'missing';
  end if;
end;
$missing$;
reset role;
rollback to savepoint missing_rpc;

-- (5) the uniqueness prerequisite is absent
savepoint missing_index;
drop index public.walks_one_active_per_dog_uidx;
set local role authenticated;
do $missing_index$
declare result jsonb := public.walk_lifecycle_server_capabilities();
begin
  if not (result->'missing') ? 'index:public.walks_one_active_per_dog_uidx' then
    raise exception 'missing uniqueness index was not reported: %', result->'missing';
  end if;
end;
$missing_index$;
reset role;
rollback to savepoint missing_index;

-- (6) read-only: no row in any lifecycle table changes across probes
do $readonly$
declare
  before_counts bigint[];
  after_counts bigint[];
begin
  select array[
    (select count(*) from public.walks),
    (select count(*) from public.walk_lifecycle_operations),
    (select count(*) from public.walk_lifecycle_events),
    (select count(*) from public.walk_gps_ownership),
    (select count(*) from public.walk_lifecycle_notifications)
  ] into before_counts;
  perform public.walk_lifecycle_server_capabilities();
  perform public.walk_lifecycle_server_capabilities();
  select array[
    (select count(*) from public.walks),
    (select count(*) from public.walk_lifecycle_operations),
    (select count(*) from public.walk_lifecycle_events),
    (select count(*) from public.walk_gps_ownership),
    (select count(*) from public.walk_lifecycle_notifications)
  ] into after_counts;
  if before_counts is distinct from after_counts then
    raise exception 'capability probe changed data: % -> %', before_counts, after_counts;
  end if;
end;
$readonly$;

-- Final state after every savepoint rollback: still fully supported.
set local role authenticated;
do $restored$
begin
  if jsonb_array_length(public.walk_lifecycle_server_capabilities()->'missing') <> 0 then
    raise exception 'savepoint rollbacks did not restore the activated state';
  end if;
end;
$restored$;
reset role;

rollback;

select 'walk lifecycle v1.1 capability probe rehearsal passed' as result;
