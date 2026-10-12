-- Regression assertions for the family-scoped schedule-rule delete RPC.
-- Run after migrations against local/Staging; this test does not mutate data.
do $$
declare
  v_proc regprocedure := 'public.delete_schedule_rule_idempotent(uuid)'::regprocedure;
  v_definition text;
begin
  select pg_get_functiondef(v_proc) into v_definition;

  if not (select prosecdef from pg_proc where oid = v_proc) then
    raise exception 'schedule-rule delete RPC must enforce its own server-side boundary';
  end if;
  if position('set search_path to' in lower(v_definition)) = 0 then
    raise exception 'schedule-rule delete RPC must use a fixed search_path';
  end if;
  if position('auth.uid() is null' in lower(v_definition)) = 0
     or position('current_family_id' in v_definition) = 0
     or position('is_family_admin' in v_definition) = 0 then
    raise exception 'schedule-rule delete RPC must require an authenticated active-family administrator';
  end if;
  if position('for update' in lower(v_definition)) = 0
     or position('already_absent' in v_definition) = 0 then
    raise exception 'schedule-rule delete RPC must serialize deletion and resolve an absent target idempotently';
  end if;
  if position('v_target_family_id is distinct from v_family_id' in v_definition) = 0
     or position('42501' in v_definition) = 0 then
    raise exception 'schedule-rule delete RPC must deny existing targets outside the active family';
  end if;
  if position('admin_delete_schedule_rule' in v_definition) = 0 then
    raise exception 'same-family rule deletion must retain established schedule/walk cleanup behavior';
  end if;
  if has_function_privilege('anon', v_proc, 'EXECUTE') then
    raise exception 'anonymous execution must remain revoked';
  end if;
  if not has_function_privilege('authenticated', v_proc, 'EXECUTE') then
    raise exception 'authenticated execution grant is missing';
  end if;
end;
$$;
