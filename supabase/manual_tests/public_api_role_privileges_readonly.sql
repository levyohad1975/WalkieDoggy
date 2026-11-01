-- Read-only API-role access contract for the application `public` schema.
--
-- Fails if PostgREST's roles cannot reach the schema the way the shipped
-- client needs (the 2026-10-29 Production clean bootstrap left `public`
-- with a NULL ACL: every RPC answered "permission denied for schema public").
-- It also fails if pre-session (anon) callers regain onboarding RPCs.
--
-- Safe for an isolated replay, Staging or Production: it writes nothing,
-- impersonates a random non-existent Auth user, and ends with ROLLBACK.
-- Run with: psql -v ON_ERROR_STOP=1 -f public_api_role_privileges_readonly.sql

begin read only;

do $contract$
declare
  missing text[] := '{}';
  role_name text;
begin
  foreach role_name in array array['anon', 'authenticated', 'service_role'] loop
    if not has_schema_privilege(role_name, 'public', 'USAGE') then
      missing := missing || format('%s lacks USAGE on schema public', role_name);
    end if;
  end loop;

  if not has_function_privilege('authenticated', 'public.whoami()', 'EXECUTE') then
    missing := missing || 'authenticated cannot execute whoami()'::text;
  end if;
  if not has_function_privilege('authenticated', 'public.get_my_family_onboarding_status()', 'EXECUTE') then
    missing := missing || 'authenticated cannot execute get_my_family_onboarding_status()'::text;
  end if;
  if not has_function_privilege('authenticated', 'public.am_i_system_admin()', 'EXECUTE') then
    missing := missing || 'authenticated cannot execute am_i_system_admin()'::text;
  end if;
  if has_function_privilege('anon', 'public.get_my_family_onboarding_status()', 'EXECUTE') then
    missing := missing || 'anon can execute get_my_family_onboarding_status() (pre-session exposure)'::text;
  end if;
  if not has_table_privilege('authenticated', 'public.families', 'SELECT') then
    missing := missing || 'authenticated lacks SELECT on families (RLS cannot apply)'::text;
  end if;

  if cardinality(missing) > 0 then
    raise exception 'public API role contract failed: %', array_to_string(missing, '; ');
  end if;
end
$contract$;

-- Exercise the exact calls the onboarding screen makes as a signed-in
-- (anonymous-Auth) user. RLS/SECURITY DEFINER logic returns no rows for an
-- unknown user; the point is that none of these raise 42501.
select set_config(
  'request.jwt.claims',
  json_build_object('sub', gen_random_uuid()::text, 'role', 'authenticated', 'is_anonymous', true)::text,
  true
);
set local role authenticated;
select count(*) as whoami_rows from public.whoami();
select count(*) as onboarding_rows from public.get_my_family_onboarding_status();
select public.am_i_system_admin() as is_system_admin;
select count(*) as visible_families from public.families;
reset role;

rollback;
