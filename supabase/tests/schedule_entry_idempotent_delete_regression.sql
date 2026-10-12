-- Regression checks for 20261012053936_idempotent_schedule_entry_delete.sql.
-- Run after migrations against Staging/local Supabase; this script is read-only.
do $$
declare
  v_proc regprocedure := 'public.delete_schedule_entry_idempotent(uuid)'::regprocedure;
  v_definition text;
begin
  select pg_get_functiondef(v_proc) into v_definition;

  if not (select prosecdef from pg_proc where oid = v_proc) then
    raise exception 'delete RPC must keep its explicit server-side authorization boundary';
  end if;
  if position('set search_path to' in lower(v_definition)) = 0 then
    raise exception 'delete RPC must set a fixed search_path';
  end if;
  if position('current_family_id' in v_definition) = 0
     or position('v_target_family_id is distinct from v_family_id' in v_definition) = 0
     or position('42501' in v_definition) = 0 then
    raise exception 'delete RPC must reject missing or foreign active-family authorization';
  end if;
  if position('for update' in lower(v_definition)) = 0
     or position('already_absent' in v_definition) = 0 then
    raise exception 'delete RPC must serialize replay and recognize a confirmed absent row';
  end if;
  if has_function_privilege('anon', v_proc, 'EXECUTE') then
    raise exception 'anonymous execution must remain revoked';
  end if;
  if not has_function_privilege('authenticated', v_proc, 'EXECUTE') then
    raise exception 'authenticated execution grant is missing';
  end if;
end;
$$;
