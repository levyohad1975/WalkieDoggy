-- Isolated CI regression only. Runs after the duplicate-resolution fixture and
-- the actual v1.1 migration. The fixture's canonical walk d4..02 is still
-- in_progress and was started before v1.1, so actual_walker_user_id is NULL:
-- exactly the state of any real walk that is active when v1.1 is applied.
-- Everything below is rolled back; no fixture state is changed.
do $guard$
begin
  if current_database() <> 'postgres'
     or current_setting('app.walk_duplicate_fixture', true) is distinct from 'local' then
    raise exception 'Legacy active-walk finish check requires the isolated CI session flag';
  end if;
end;
$guard$;

begin;

do $precondition$
begin
  if not exists (select 1 from public.walks
      where id='d4000000-0000-4000-8000-000000000002' and status='in_progress'
        and duplicate_resolution_group_id is null and actual_walker_user_id is null
        and responsible_user_id='d2000000-0000-4000-8000-000000000001') then
    raise exception 'fixture walk is not a pre-v1.1 active walk with a NULL actual walker';
  end if;
end;
$precondition$;

set local role authenticated;

-- A member who is neither the responsible member nor an admin must not be
-- able to finish the walk, including by passing a NULL walker.
select set_config('request.jwt.claim.sub','d0000000-0000-4000-8000-000000000002',true);
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claims','{"sub":"d0000000-0000-4000-8000-000000000002","role":"authenticated"}',true);

do $member$
begin
  if public.real_current_profile_id() is distinct from 'd2000000-0000-4000-8000-000000000002'::uuid then
    raise exception 'fixture did not resolve the member profile';
  end if;
  begin
    perform public.finish_walk_v11('d4000000-0000-4000-8000-000000000002', null,
      'd2000000-0000-4000-8000-000000000002', 'd7000000-0000-4000-8000-000000000001');
    raise exception 'member finished a legacy active walk by passing a NULL walker';
  exception when others then
    if sqlerrm = 'member finished a legacy active walk by passing a NULL walker' then raise; end if;
    if sqlerrm not like '%actual walker cannot be changed%' then raise; end if;
  end;
  begin
    perform public.finish_walk_v11('d4000000-0000-4000-8000-000000000002', 'd2000000-0000-4000-8000-000000000001',
      'd2000000-0000-4000-8000-000000000002', 'd7000000-0000-4000-8000-000000000002');
    raise exception 'member finished another member''s legacy active walk';
  exception when others then
    if sqlerrm = 'member finished another member''s legacy active walk' then raise; end if;
    if sqlerrm not like '%actual walker or confirmed family admin required%' then raise; end if;
  end;
end;
$member$;

-- The responsible member (the legacy default walker, which is what the app
-- sends) must be able to finish it. Before the fix this raised
-- "actual walker cannot be changed during finish" and the walk stayed active.
select set_config('request.jwt.claim.sub','d0000000-0000-4000-8000-000000000001',true);
select set_config('request.jwt.claims','{"sub":"d0000000-0000-4000-8000-000000000001","role":"authenticated"}',true);

do $walker$
declare w public.walks;
begin
  if public.real_current_profile_id() is distinct from 'd2000000-0000-4000-8000-000000000001'::uuid then
    raise exception 'fixture did not resolve the responsible profile';
  end if;
  w := public.finish_walk_v11('d4000000-0000-4000-8000-000000000002', 'd2000000-0000-4000-8000-000000000001',
    'd2000000-0000-4000-8000-000000000001', 'd7000000-0000-4000-8000-000000000003');
  if w.status <> 'done' or w.completed_by_user_id is distinct from 'd2000000-0000-4000-8000-000000000001'::uuid
     or w.ended_by_user_id is distinct from 'd2000000-0000-4000-8000-000000000001'::uuid then
    raise exception 'legacy active walk was not finished with the responsible member as walker';
  end if;
  if w.actual_walker_user_id is not null then
    raise exception 'finish unexpectedly backfilled actual_walker_user_id';
  end if;
  if not exists (select 1 from public.walk_lifecycle_events e
      where e.walk_id=w.id and e.action='finished'
        and e.actual_walker_user_id='d2000000-0000-4000-8000-000000000001') then
    raise exception 'finish did not record a local (non-remote) lifecycle event';
  end if;
  -- An identical retry is idempotent.
  w := public.finish_walk_v11('d4000000-0000-4000-8000-000000000002', 'd2000000-0000-4000-8000-000000000001',
    'd2000000-0000-4000-8000-000000000001', 'd7000000-0000-4000-8000-000000000003');
  if w.status <> 'done' then raise exception 'idempotent finish retry failed'; end if;
end;
$walker$;

rollback;
