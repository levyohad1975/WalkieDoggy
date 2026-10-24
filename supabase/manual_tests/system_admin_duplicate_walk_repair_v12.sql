-- Isolated CI rehearsal only. Runs after the duplicate-resolution fixture has
-- seeded three conflicting active walks (d4..01-03, dog d3..01) and BEFORE
-- the fixture's own Family Admin resolution. Everything is rolled back, so
-- the existing rehearsal continues from the same state.
--
-- Covers system_admin_resolve_authorized_duplicate_walks_v12():
-- (1) the migration's Staging seed inserts nothing outside Staging,
-- (2) anon, a Family Admin, an anonymous System Admin and an observing
--     System Admin are refused; no client can read the authorization table,
-- (3) expired / changed / foreign authorizations are refused,
-- (4) a verified System Admin marks exactly the authorized walks, with no
--     canonical walk, preserving status, timestamps, attribution and GPS,
-- (5) identical retry is idempotent; reuse with another operation id fails,
-- (6) an immutable system audit row is written and the v1.1 gate clears.
do $guard$
begin
  if current_database() <> 'postgres'
     or current_setting('app.walk_duplicate_fixture', true) is distinct from 'local' then
    raise exception 'System Admin duplicate repair check requires the isolated CI session flag';
  end if;
end;
$guard$;

begin;

-- (1) The real Staging seed matches nothing here.
do $seed$
begin
  if exists (select 1 from public.system_maintenance_duplicate_walk_authorizations) then
    raise exception 'maintenance authorization seed must not match any non-Staging database';
  end if;
end;
$seed$;

-- ---------------------------------------------------------------- fixtures (trusted SQL)
select set_config('app.trusted_write','on',true);
-- Verified System Admin with a profile in their own family.
insert into auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at,is_anonymous)
values ('e0000000-0000-4000-8000-000000000001','authenticated','authenticated','sysadmin-repair@example.test',now(),'{}','{}',now(),now(),false);
-- System Admin row on an ANONYMOUS identity (must be refused).
insert into auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at,is_anonymous)
values ('e0000000-0000-4000-8000-000000000002','authenticated','authenticated',null,null,'{}','{}',now(),now(),true);
insert into public.system_admins(auth_user_id) values
 ('e0000000-0000-4000-8000-000000000001'),
 ('e0000000-0000-4000-8000-000000000002');
insert into public.families(id,name,invite_code)
values ('e1000000-0000-4000-8000-000000000001','System Admin Home Fixture','sysadmin-repair-home');
insert into public.family_auth_members(auth_user_id,family_id,role)
values ('e0000000-0000-4000-8000-000000000001','e1000000-0000-4000-8000-000000000001','admin');
insert into public.users(id,family_id,auth_user_id,name)
values ('e2000000-0000-4000-8000-000000000001','e1000000-0000-4000-8000-000000000001','e0000000-0000-4000-8000-000000000001','Fixture System Admin');
insert into public.profile_auth_sessions(auth_user_id,family_id,user_id)
values ('e0000000-0000-4000-8000-000000000001','e1000000-0000-4000-8000-000000000001','e2000000-0000-4000-8000-000000000001');
select set_config('app.trusted_write','off',true);

-- Authorizations: the three fixture duplicates; an expired one; one naming a
-- walk that is not an active duplicate (a completed walk).
insert into public.system_maintenance_duplicate_walk_authorizations(id,family_id,dog_id,walk_ids,reason,approval_reference,expires_at) values
 ('e3000000-0000-4000-8000-000000000001','d1000000-0000-4000-8000-000000000001','d3000000-0000-4000-8000-000000000001',
  array['d4000000-0000-4000-8000-000000000001','d4000000-0000-4000-8000-000000000002','d4000000-0000-4000-8000-000000000003']::uuid[],
  'CI fixture: three test-generated active starts for one dog.','CI rehearsal approval',now()+interval '1 hour'),
 ('e3000000-0000-4000-8000-000000000002','d1000000-0000-4000-8000-000000000001','d3000000-0000-4000-8000-000000000001',
  array['d4000000-0000-4000-8000-000000000001','d4000000-0000-4000-8000-000000000002']::uuid[],
  'CI fixture: expired authorization must be refused.','CI rehearsal approval',now()-interval '1 minute');

-- Snapshot of everything the repair must not change.
create temp table repair_before on commit drop as
  select w.id, w.status, w.started_at, w.started_by_user_id, w.responsible_user_id, w.created_at,
         w.completed_at, w.ended_by_user_id
  from public.walks w where w.dog_id = 'd3000000-0000-4000-8000-000000000001';
create temp table repair_gps_before on commit drop as
  select s.id, s.walk_id, s.point_count, s.distance_meters, s.route_points
  from public.walk_gps_sessions s
  where s.walk_id in ('d4000000-0000-4000-8000-000000000001','d4000000-0000-4000-8000-000000000002','d4000000-0000-4000-8000-000000000003');
grant select on repair_before, repair_gps_before to authenticated;

-- (2) anon is refused at the grant level.
set local role anon;
do $anon$
begin
  perform public.system_admin_resolve_authorized_duplicate_walks_v12('e3000000-0000-4000-8000-000000000001','e4000000-0000-4000-8000-000000000001');
  raise exception 'anon executed the maintenance RPC';
exception when insufficient_privilege then null;
end;
$anon$;
reset role;

-- (2) A Family Admin of the affected family is not a System Admin.
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"d0000000-0000-4000-8000-000000000001","role":"authenticated","is_anonymous":false}',true);
select set_config('request.jwt.claim.sub','d0000000-0000-4000-8000-000000000001',true);
do $family_admin$
begin
  perform public.system_admin_resolve_authorized_duplicate_walks_v12('e3000000-0000-4000-8000-000000000001','e4000000-0000-4000-8000-000000000001');
  raise exception 'family admin executed the System Admin maintenance RPC';
exception when others then
  if sqlerrm <> 'verified system admin required' then raise; end if;
end;
$family_admin$;
do $no_table$
begin
  perform 1 from public.system_maintenance_duplicate_walk_authorizations;
  raise exception 'authenticated client read the authorization table';
exception when insufficient_privilege then null;
end;
$no_table$;
reset role;

-- (2) A System Admin row on an anonymous identity is refused.
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"e0000000-0000-4000-8000-000000000002","role":"authenticated","is_anonymous":true}',true);
select set_config('request.jwt.claim.sub','e0000000-0000-4000-8000-000000000002',true);
do $anon_sysadmin$
begin
  perform public.system_admin_resolve_authorized_duplicate_walks_v12('e3000000-0000-4000-8000-000000000001','e4000000-0000-4000-8000-000000000001');
  raise exception 'anonymous system admin executed the maintenance RPC';
exception when others then
  if sqlerrm <> 'verified system admin required' then raise; end if;
end;
$anon_sysadmin$;
reset role;

-- Verified System Admin from here on.
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"e0000000-0000-4000-8000-000000000001","role":"authenticated","is_anonymous":false}',true);
select set_config('request.jwt.claim.sub','e0000000-0000-4000-8000-000000000001',true);

do $list$
declare v_count integer;
begin
  select unresolved_active_count into v_count from public.system_admin_list_duplicate_walk_authorizations()
    where authorization_id = 'e3000000-0000-4000-8000-000000000001';
  if v_count is distinct from 3 then raise exception 'list did not report 3 unresolved active walks: %', v_count; end if;
end;
$list$;

-- (3) expired authorization
do $expired$
begin
  perform public.system_admin_resolve_authorized_duplicate_walks_v12('e3000000-0000-4000-8000-000000000002','e4000000-0000-4000-8000-000000000002');
  raise exception 'expired authorization was accepted';
exception when others then
  if sqlerrm <> 'maintenance authorization expired' then raise; end if;
end;
$expired$;

-- (3) unknown authorization
do $unknown$
begin
  perform public.system_admin_resolve_authorized_duplicate_walks_v12('e3000000-0000-4000-8000-0000000000ff','e4000000-0000-4000-8000-000000000003');
  raise exception 'unknown authorization was accepted';
exception when others then
  if sqlerrm <> 'maintenance authorization not found' then raise; end if;
end;
$unknown$;

-- (2) observing a family is refused even for a verified System Admin.
reset role;
insert into public.system_admin_observer_sessions(system_admin_auth_user_id,family_id)
values ('e0000000-0000-4000-8000-000000000001','d1000000-0000-4000-8000-000000000001');
set local role authenticated;
do $observer$
begin
  perform public.system_admin_resolve_authorized_duplicate_walks_v12('e3000000-0000-4000-8000-000000000001','e4000000-0000-4000-8000-000000000001');
  raise exception 'observing system admin executed maintenance';
exception when others then
  if sqlerrm <> 'exit observation or impersonation before maintenance' then raise; end if;
end;
$observer$;
reset role;
update public.system_admin_observer_sessions set ended_at = now()
  where system_admin_auth_user_id = 'e0000000-0000-4000-8000-000000000001' and ended_at is null;
set local role authenticated;

-- (4) the authorized resolution
create temp table repair_result(group_id uuid) on commit drop;
reset role;
grant insert, select on repair_result to authenticated;
set local role authenticated;
insert into repair_result
  select public.system_admin_resolve_authorized_duplicate_walks_v12('e3000000-0000-4000-8000-000000000001','e4000000-0000-4000-8000-000000000001');

-- (5) identical retry returns the same group; another operation id is refused
do $retry$
declare v_first uuid; v_again uuid;
begin
  select group_id into v_first from repair_result;
  v_again := public.system_admin_resolve_authorized_duplicate_walks_v12('e3000000-0000-4000-8000-000000000001','e4000000-0000-4000-8000-000000000001');
  if v_again is distinct from v_first then raise exception 'retry returned a different group'; end if;
  begin
    perform public.system_admin_resolve_authorized_duplicate_walks_v12('e3000000-0000-4000-8000-000000000001','e4000000-0000-4000-8000-0000000000aa');
    raise exception 'authorization was reused with another operation id';
  exception when others then
    if sqlerrm <> 'maintenance authorization was already used' then raise; end if;
  end;
end;
$retry$;
reset role;

-- (4)(6) assertions as the trusted owner
do $assertions$
declare v_group uuid;
begin
  select group_id into v_group from repair_result;
  if v_group is null then raise exception 'no resolution group returned'; end if;
  if (select count(*) from public.walk_duplicate_resolution_groups where id = v_group and canonical_walk_id is null
        and created_by_user_id = 'e2000000-0000-4000-8000-000000000001'
        and operation_id = 'e4000000-0000-4000-8000-000000000001') <> 1 then
    raise exception 'resolution group missing, canonical set, or wrong actor/operation';
  end if;
  if (select count(*) from public.walk_duplicate_resolution_items where group_id = v_group and disposition = 'resolved_duplicate'
        and original_walk->>'status' = 'in_progress') <> 3 then
    raise exception 'expected 3 resolved_duplicate snapshots of the in_progress rows';
  end if;
  if (select count(*) from public.walks where dog_id = 'd3000000-0000-4000-8000-000000000001' and duplicate_resolution_group_id = v_group) <> 3 then
    raise exception 'expected exactly the 3 authorized walks to carry the marker';
  end if;
  if exists (
    select 1 from repair_before b join public.walks w on w.id = b.id
    where (b.status, b.started_at, b.started_by_user_id, b.responsible_user_id, b.created_at, b.completed_at, b.ended_by_user_id)
      is distinct from (w.status, w.started_at, w.started_by_user_id, w.responsible_user_id, w.created_at, w.completed_at, w.ended_by_user_id)
  ) then raise exception 'walk status, timestamps or attribution changed'; end if;
  if (select count(*) from repair_before b join public.walks w on w.id = b.id) <> (select count(*) from repair_before) then
    raise exception 'a walk row was deleted';
  end if;
  if exists (
    select 1 from repair_gps_before b left join public.walk_gps_sessions s on s.id = b.id
    where s.id is null or (b.walk_id, b.point_count, b.distance_meters, b.route_points)
      is distinct from (s.walk_id, s.point_count, s.distance_meters, s.route_points)
  ) then raise exception 'GPS sessions or route points changed'; end if;
  if (select count(*) from public.system_audit_log
        where action = 'system_admin_resolved_duplicate_active_walks'
          and actor_auth_user_id = 'e0000000-0000-4000-8000-000000000001'
          and target_id = 'd1000000-0000-4000-8000-000000000001'
          and metadata->>'resolution_group_id' = v_group::text
          and metadata->>'operation_id' = 'e4000000-0000-4000-8000-000000000001') <> 1 then
    raise exception 'expected exactly one system audit row (retry must not add another)';
  end if;
  if (select consumed_group_id from public.system_maintenance_duplicate_walk_authorizations
        where id = 'e3000000-0000-4000-8000-000000000001') is distinct from v_group then
    raise exception 'authorization was not consumed';
  end if;
  -- The v1.1 migration's own data gate now passes.
  if exists (
    select 1 from public.walks where status = 'in_progress' and duplicate_resolution_group_id is null
    group by dog_id having count(*) > 1
  ) then raise exception 'v1.1 duplicate gate still blocked'; end if;
end;
$assertions$;

-- (3) a later authorization over rows that are no longer unresolved active walks is refused
insert into public.system_maintenance_duplicate_walk_authorizations(id,family_id,dog_id,walk_ids,reason,approval_reference,expires_at) values
 ('e3000000-0000-4000-8000-000000000003','d1000000-0000-4000-8000-000000000001','d3000000-0000-4000-8000-000000000001',
  array['d4000000-0000-4000-8000-000000000002','d4000000-0000-4000-8000-000000000003']::uuid[],
  'CI fixture: rows already resolved must be refused.','CI rehearsal approval',now()+interval '1 hour');
set local role authenticated;
do $changed$
begin
  perform public.system_admin_resolve_authorized_duplicate_walks_v12('e3000000-0000-4000-8000-000000000003','e4000000-0000-4000-8000-000000000004');
  raise exception 'authorization over already-resolved rows was accepted';
exception when others then
  if sqlerrm <> 'authorized walks changed since approval; re-review required' then raise; end if;
end;
$changed$;
reset role;

rollback;

select 'system admin duplicate-walk repair rehearsal passed' as result;
