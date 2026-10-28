-- Security contract for the clean Walkie Doggy schema.
--
-- SECURITY DEFINER routines run with elevated database privileges.  The
-- Postgres default EXECUTE grant to PUBLIC would make each one callable by
-- Supabase's anon role unless the defining migration explicitly revokes it.
-- Anonymous Auth is intentionally enabled for the app, but anonymous database
-- RPC access is not part of onboarding: the client first obtains a session and
-- then invokes the authenticated, actor-scoped RPCs below.

begin;

do $$
declare
  unsafe_functions text;
begin
  select string_agg(p.oid::regprocedure::text, ', ' order by p.oid::regprocedure::text)
    into unsafe_functions
  from pg_proc as p
  join pg_namespace as n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.prosecdef
    and has_function_privilege('anon', p.oid, 'EXECUTE');

  if unsafe_functions is not null then
    raise exception
      'SECURITY DEFINER functions must not be executable by anon: %',
      unsafe_functions;
  end if;
end;
$$;

-- Keep the authenticated post-session paths available.  The integration
-- rehearsals exercise their authorization behaviour with fixtures; this check
-- protects the privilege boundary itself from a later broad REVOKE.
do $$
declare
  required_function regprocedure;
begin
  foreach required_function in array array[
    'public.claim_family_profile(uuid)'::regprocedure,
    'public.claim_family_profile_with_pin(uuid,text)'::regprocedure,
    'public.get_my_family_onboarding_status()'::regprocedure,
    'public.start_walk_v11(uuid,uuid,uuid,uuid,boolean,boolean)'::regprocedure,
    'public.chat_open_family_conversation()'::regprocedure,
    'public.chat_send_message(uuid,uuid,text)'::regprocedure,
    'public.set_remote_gps_consent(boolean)'::regprocedure,
    'public.list_remote_gps_targets(uuid)'::regprocedure
  ]
  loop
    if not has_function_privilege('authenticated', required_function, 'EXECUTE') then
      raise exception
        'authenticated lost EXECUTE on required application RPC: %',
        required_function;
    end if;
  end loop;
end;
$$;

rollback;
