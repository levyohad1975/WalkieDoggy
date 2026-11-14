-- Runs after the isolated fixture and the actual v1.1 migration are applied.
do $guard$
begin
  if current_database() <> 'postgres'
     or current_setting('app.walk_duplicate_fixture', true) is distinct from 'local' then
    raise exception 'Duplicate-walk post-migration check requires the isolated CI session flag';
  end if;
end;
$guard$;

do $verify$
declare v_group_id uuid;
begin
  select id into v_group_id from public.walk_duplicate_resolution_groups
    where operation_id='d6000000-0000-4000-8000-000000000001';
  if v_group_id is null then raise exception 'resolution group missing after v1.1 migration'; end if;
  if (select count(*) from public.walks where id in (
      'd4000000-0000-4000-8000-000000000001','d4000000-0000-4000-8000-000000000002','d4000000-0000-4000-8000-000000000003')) <> 3 then
    raise exception 'original walk rows missing after migration';
  end if;
  if (select count(*) from public.walks where dog_id='d3000000-0000-4000-8000-000000000001'
      and status='in_progress' and duplicate_resolution_group_id is null) <> 1 then
    raise exception 'v1.1 migration did not retain exactly one active canonical row';
  end if;
  if (select count(*) from public.walk_duplicate_resolution_items i where i.group_id=v_group_id
      and (i.original_walk->>'status')='in_progress') <> 3 then
    raise exception 'audit snapshots lost original lifecycle status';
  end if;
  if (select count(*) from public.walks w join public.walk_duplicate_resolution_items i on i.walk_id=w.id
      where i.group_id=v_group_id and w.status='in_progress'
        and w.started_by_user_id='d2000000-0000-4000-8000-000000000001'
        and w.started_at=(i.original_walk->>'started_at')::timestamptz) <> 3 then
    raise exception 'walk timestamps or attribution changed';
  end if;
  if (select count(*) from public.walk_gps_sessions s where s.walk_id in (
      'd4000000-0000-4000-8000-000000000001','d4000000-0000-4000-8000-000000000002','d4000000-0000-4000-8000-000000000003')
      and s.route_points is not null and s.point_count in (1,3,4)) <> 3 then
    raise exception 'GPS session or route data changed';
  end if;
  if not exists (select 1 from pg_indexes where schemaname='public'
      and indexname='walks_one_active_per_dog_uidx'
      and indexdef like '%duplicate_resolution_group_id IS NULL%') then
    raise exception 'v1.1 uniqueness index does not honor audited resolution marker';
  end if;
  -- This isolated post-migration probe is trusted fixture SQL, not an app
  -- request; bypass the write-authorization trigger so the unique index is
  -- the guard under test.
  perform set_config('app.trusted_write','on',true);
  begin
    insert into public.walks(id,family_id,dog_id,date,scheduled_time,responsible_user_id,status,started_at,started_by_user_id)
    values ('d4000000-0000-4000-8000-000000000099','d1000000-0000-4000-8000-000000000001',
      'd3000000-0000-4000-8000-000000000001',current_date,'09:03','d2000000-0000-4000-8000-000000000001',
      'in_progress',now(),'d2000000-0000-4000-8000-000000000001');
    raise exception 'v1.1 uniqueness index allowed a second unresolved active walk';
  exception when unique_violation then
    null;
  end;
end;
$verify$;
