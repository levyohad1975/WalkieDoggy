-- Production hardening: Supabase Security Advisor reports these legacy helper
-- functions with a role-mutable search_path.  Pinning pg_catalog before public
-- prevents a caller-controlled schema from shadowing built-ins or application
-- objects.  This is deliberately idempotent and only changes functions that
-- actually exist in the target database; it neither changes data nor grants.
--
-- The list covers every function reported by Staging/Production on 2026-10-23,
-- including the historical bootstrap/admin variants that exist in one of the
-- two environments but not necessarily in a clean replay at this point.
do $$
declare
  target_function regprocedure;
begin
  for target_function in
    select p.oid::regprocedure
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in (
        'set_updated_at',
        'generate_invite_code',
        'bootstrap_first_member_role',
        'is_valid_timezone',
        'admin_delete_family_member'
      )
  loop
    execute format(
      'alter function %s set search_path = pg_catalog, public',
      target_function
    );
  end loop;
end;
$$;
