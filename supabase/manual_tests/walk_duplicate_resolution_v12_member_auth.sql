-- Run from a fresh local Postgres connection after the main duplicate fixture.
do $guard$
begin
  if current_database() <> 'postgres'
     or current_setting('app.walk_duplicate_fixture', true) is distinct from 'local' then
    raise exception 'Duplicate-walk authorization fixture requires isolated local session';
  end if;
end;
$guard$;

set role authenticated;
select set_config('request.jwt.claim.sub','d0000000-0000-4000-8000-000000000002',false);
select set_config('request.jwt.claim.role','authenticated',false);
select set_config('request.jwt.claims','{"sub":"d0000000-0000-4000-8000-000000000002","role":"authenticated"}',false);

do $unauthorized$
begin
  if auth.uid() is distinct from 'd0000000-0000-4000-8000-000000000002'::uuid then
    raise exception 'authorization fixture did not resolve the member auth user';
  end if;
  if public.real_current_profile_id() is distinct from 'd2000000-0000-4000-8000-000000000002'::uuid then
    raise exception 'authorization fixture did not resolve the member profile';
  end if;
  if public.is_family_admin('d1000000-0000-4000-8000-000000000001') is distinct from false then
    raise exception 'member fixture admin check did not resolve explicitly to false';
  end if;
  begin
    perform public.resolve_duplicate_active_walks_v12(
      array['d4000000-0000-4000-8000-000000000001','d4000000-0000-4000-8000-000000000003']::uuid[],null,
      'Unauthorized fixture attempt must fail.', 'd6000000-0000-4000-8000-000000000002'
    );
    raise exception 'non-admin resolution unexpectedly succeeded';
  exception when others then
    if sqlerrm = 'non-admin resolution unexpectedly succeeded' then raise; end if;
    if sqlerrm not like '%family admin required%' then raise; end if;
  end;
end;
$unauthorized$;
