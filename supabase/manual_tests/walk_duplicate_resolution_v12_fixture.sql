-- Isolated CI fixture only. Creates three conflicting active starts, selects
-- the middle row (not the earliest) as canonical, and audits resolution.
do $guard$
begin
  if current_database() <> 'postgres'
     or current_setting('app.walk_duplicate_fixture', true) is distinct from 'local' then
    raise exception 'Duplicate-walk fixture requires the isolated CI session flag';
  end if;
end;
$guard$;

begin;
select set_config('app.trusted_write','on',true);
insert into auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
values ('d0000000-0000-4000-8000-000000000001','authenticated','authenticated','walk-dup-admin@example.test',now(),'{}','{}',now(),now());
insert into auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
values ('d0000000-0000-4000-8000-000000000002','authenticated','authenticated','walk-dup-member@example.test',now(),'{}','{}',now(),now());
insert into public.families(id,name,invite_code)
values ('d1000000-0000-4000-8000-000000000001','Duplicate Resolution Fixture','dup-resolve-v12');
insert into public.family_auth_members(auth_user_id,family_id,role) values
 ('d0000000-0000-4000-8000-000000000001','d1000000-0000-4000-8000-000000000001','admin'),
 ('d0000000-0000-4000-8000-000000000002','d1000000-0000-4000-8000-000000000001','member');
insert into public.users(id,family_id,auth_user_id,name) values
 ('d2000000-0000-4000-8000-000000000001','d1000000-0000-4000-8000-000000000001','d0000000-0000-4000-8000-000000000001','Fixture Admin'),
 ('d2000000-0000-4000-8000-000000000002','d1000000-0000-4000-8000-000000000001','d0000000-0000-4000-8000-000000000002','Fixture Member');
insert into public.profile_auth_sessions(auth_user_id,family_id,user_id) values
 ('d0000000-0000-4000-8000-000000000001','d1000000-0000-4000-8000-000000000001','d2000000-0000-4000-8000-000000000001'),
 ('d0000000-0000-4000-8000-000000000002','d1000000-0000-4000-8000-000000000001','d2000000-0000-4000-8000-000000000002');
insert into public.dogs(id,family_id,name)
values ('d3000000-0000-4000-8000-000000000001','d1000000-0000-4000-8000-000000000001','Fixture Dog');
insert into public.walks(id,family_id,dog_id,date,scheduled_time,responsible_user_id,status,started_at,started_by_user_id)
values
 ('d4000000-0000-4000-8000-000000000001','d1000000-0000-4000-8000-000000000001','d3000000-0000-4000-8000-000000000001',current_date,'09:00','d2000000-0000-4000-8000-000000000001','in_progress','2026-10-13 05:03:58+00','d2000000-0000-4000-8000-000000000001'),
 ('d4000000-0000-4000-8000-000000000002','d1000000-0000-4000-8000-000000000001','d3000000-0000-4000-8000-000000000001',current_date,'09:01','d2000000-0000-4000-8000-000000000001','in_progress','2026-10-13 05:04:05+00','d2000000-0000-4000-8000-000000000001'),
 ('d4000000-0000-4000-8000-000000000003','d1000000-0000-4000-8000-000000000001','d3000000-0000-4000-8000-000000000001',current_date,'09:02','d2000000-0000-4000-8000-000000000001','in_progress','2026-10-13 05:04:36+00','d2000000-0000-4000-8000-000000000001');
insert into public.walk_gps_sessions(id,walk_id,family_id,dog_id,distance_meters,point_count,route_points,started_at,ended_at,created_by_user_id)
values
 ('d5000000-0000-4000-8000-000000000001','d4000000-0000-4000-8000-000000000001','d1000000-0000-4000-8000-000000000001','d3000000-0000-4000-8000-000000000001',0,4,'[{"latitude":31,"longitude":34,"timestamp":1}]','2026-10-13 05:03:58+00','2026-10-13 05:03:59+00','d2000000-0000-4000-8000-000000000001'),
 ('d5000000-0000-4000-8000-000000000002','d4000000-0000-4000-8000-000000000002','d1000000-0000-4000-8000-000000000001','d3000000-0000-4000-8000-000000000001',0,3,'[{"latitude":31.1,"longitude":34.1,"timestamp":2}]','2026-10-13 05:04:05+00','2026-10-13 05:04:06+00','d2000000-0000-4000-8000-000000000001'),
 ('d5000000-0000-4000-8000-000000000003','d4000000-0000-4000-8000-000000000003','d1000000-0000-4000-8000-000000000001','d3000000-0000-4000-8000-000000000001',0,1,'[{"latitude":31.2,"longitude":34.2,"timestamp":3}]','2026-10-13 05:04:36+00','2026-10-13 05:04:37+00','d2000000-0000-4000-8000-000000000001');
select set_config('app.trusted_write','off',true);
set local role authenticated;
select set_config('request.jwt.claim.sub','d0000000-0000-4000-8000-000000000001',true);
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claims','{"sub":"d0000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
select public.resolve_duplicate_active_walks_v12(
  array['d4000000-0000-4000-8000-000000000001','d4000000-0000-4000-8000-000000000002','d4000000-0000-4000-8000-000000000003']::uuid[],
  'd4000000-0000-4000-8000-000000000002',
  'Isolated regression fixture: three test starts, middle record selected explicitly as canonical.',
  'd6000000-0000-4000-8000-000000000001'
);
-- An identical retry returns the same group id and does not add audit rows.
select public.resolve_duplicate_active_walks_v12(
  array['d4000000-0000-4000-8000-000000000001','d4000000-0000-4000-8000-000000000002','d4000000-0000-4000-8000-000000000003']::uuid[],
  'd4000000-0000-4000-8000-000000000002',
  'Isolated regression fixture: three test starts, middle record selected explicitly as canonical.',
  'd6000000-0000-4000-8000-000000000001'
);
do $unauthorized$
begin
  perform set_config('request.jwt.claim.sub','d0000000-0000-4000-8000-000000000002',true);
  perform set_config('request.jwt.claim.role','authenticated',true);
  perform set_config('request.jwt.claims','{"sub":"d0000000-0000-4000-8000-000000000002","role":"authenticated"}',true);
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
set local role postgres;
do $assertions$
declare v_group_id uuid;
begin
  select id into v_group_id from public.walk_duplicate_resolution_groups
    where operation_id='d6000000-0000-4000-8000-000000000001';
  if v_group_id is null then raise exception 'missing resolution audit group'; end if;
  if (select count(*) from public.walk_duplicate_resolution_groups where operation_id='d6000000-0000-4000-8000-000000000001') <> 1 then raise exception 'retry duplicated the audit group'; end if;
  if (select count(*) from public.walk_duplicate_resolution_items i where i.group_id=v_group_id) <> 3 then raise exception 'audit item count mismatch'; end if;
  if (select duplicate_resolution_group_id from public.walks where id='d4000000-0000-4000-8000-000000000002') is not null then raise exception 'middle canonical row was excluded'; end if;
  if (select count(*) from public.walks where dog_id='d3000000-0000-4000-8000-000000000001' and status='in_progress' and duplicate_resolution_group_id is null) <> 1 then raise exception 'expected exactly one unresolved active walk'; end if;
  if (select count(*) from public.walk_gps_sessions where walk_id in ('d4000000-0000-4000-8000-000000000001','d4000000-0000-4000-8000-000000000002','d4000000-0000-4000-8000-000000000003')) <> 3 then raise exception 'GPS sessions were not preserved'; end if;
  if (select count(*) from public.walk_gps_sessions where walk_id in ('d4000000-0000-4000-8000-000000000001','d4000000-0000-4000-8000-000000000002','d4000000-0000-4000-8000-000000000003') and route_points is not null) <> 3 then raise exception 'GPS route points were not preserved'; end if;
end;
$assertions$;
commit;
