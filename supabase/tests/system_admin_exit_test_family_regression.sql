-- Regression assertions for migration 20261011180000_fix_system_admin_test_family_exit_ambiguous_id.sql.
-- Run against the Staging/local schema after migrations are applied.
do $$
declare
  v_proc regprocedure := 'public.system_admin_exit_test_family()'::regprocedure;
  v_definition text;
begin
  select pg_get_functiondef(v_proc) into v_definition;

  if position('original_profile.id = v_snapshot.claimed_user_id' in v_definition) = 0 then
    raise exception 'exit RPC must qualify users.id to avoid output-variable ambiguity';
  end if;
  if position('SECURITY DEFINER' in upper(v_definition)) = 0
     or position('search_path' in lower(v_definition)) = 0 then
    raise exception 'exit RPC must retain its reviewed security execution context';
  end if;
  if has_function_privilege('anon', v_proc, 'EXECUTE') then
    raise exception 'anonymous execution must remain revoked';
  end if;
  if not has_function_privilege('authenticated', v_proc, 'EXECUTE') then
    raise exception 'authenticated System Admin RPC execution grant is missing';
  end if;
end;
$$;
