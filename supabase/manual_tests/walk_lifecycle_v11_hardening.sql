-- Isolated CI rehearsal only. Runs after the duplicate-resolution fixture and
-- the actual v1.1 migration. Everything below is rolled back.
--
-- Fixture state on entry: walk d4..02 is the canonical walk that was already
-- in_progress when v1.1 was applied (started by the legacy start_walk(), so
-- actual_walker_user_id is NULL), responsible = d2..01 (family admin).
-- d2..02 is a regular member.
--
-- Covers: (1) actual_walker_user_id cannot be written through legacy paths,
-- (2) GPS leases work for walks active before v1.1, (3) only real GPS owner
-- changes are audited, (4) completion-time bounds, (5) a late delivery result
-- never erases a recorded provider acceptance.
do $guard$
begin
  if current_database() <> 'postgres'
     or current_setting('app.walk_duplicate_fixture', true) is distinct from 'local' then
    raise exception 'Lifecycle hardening check requires the isolated CI session flag';
  end if;
end;
$guard$;

begin;

-- ---------------------------------------------------------------- setup (trusted fixture SQL)
select set_config('app.trusted_write','on',true);
-- A second device signed in as the same admin profile.
insert into auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
values ('d0000000-0000-4000-8000-000000000003','authenticated','authenticated','walk-hardening-device2@example.test',now(),'{}','{}',now(),now());
insert into public.family_auth_members(auth_user_id,family_id,role)
values ('d0000000-0000-4000-8000-000000000003','d1000000-0000-4000-8000-000000000001','admin');
insert into public.profile_auth_sessions(auth_user_id,family_id,user_id)
values ('d0000000-0000-4000-8000-000000000003','d1000000-0000-4000-8000-000000000001','d2000000-0000-4000-8000-000000000001');
-- A second dog (the first dog is occupied by the active d4..02) with a pending
-- scheduled-style walk for the member, plus a member-owned unplanned pending walk.
insert into public.dogs(id,family_id,name)
values ('d3000000-0000-4000-8000-000000000002','d1000000-0000-4000-8000-000000000001','Hardening Dog');
insert into public.walks(id,family_id,dog_id,date,scheduled_time,responsible_user_id,status)
values ('d4000000-0000-4000-8000-000000000012','d1000000-0000-4000-8000-000000000001','d3000000-0000-4000-8000-000000000002',current_date,'11:00','d2000000-0000-4000-8000-000000000002','pending');
insert into public.walks(id,family_id,dog_id,date,scheduled_time,responsible_user_id,status,is_unplanned)
values ('d4000000-0000-4000-8000-000000000010','d1000000-0000-4000-8000-000000000001','d3000000-0000-4000-8000-000000000002',current_date,'12:00','d2000000-0000-4000-8000-000000000002','pending',true);
select set_config('app.trusted_write','off',true);

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

-- ============================================================ (1) direct writes to actual_walker_user_id
set local role authenticated;
select set_config('request.jwt.claim.sub','d0000000-0000-4000-8000-000000000002',true);
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claims','{"sub":"d0000000-0000-4000-8000-000000000002","role":"authenticated"}',true);

do $member_direct$
declare n integer;
begin
  if public.real_current_profile_id() is distinct from 'd2000000-0000-4000-8000-000000000002'::uuid then
    raise exception 'fixture did not resolve the member profile';
  end if;
  -- The owner of an unplanned walk may edit it directly, but not its walker.
  begin
    update public.walks set actual_walker_user_id='d2000000-0000-4000-8000-000000000002' where id='d4000000-0000-4000-8000-000000000010';
    raise exception 'member set actual_walker_user_id on their own unplanned walk';
  exception when others then
    if sqlerrm = 'member set actual_walker_user_id on their own unplanned walk' then raise; end if;
    if sqlerrm not like '%actual walker can only be changed%' then raise; end if;
  end;
  -- Spoofing the credited walker on a retrospective walk is refused too.
  begin
    insert into public.walks(id,family_id,dog_id,date,scheduled_time,responsible_user_id,status,is_unplanned,completed_at,completed_by_user_id,actual_walker_user_id)
    values ('d4000000-0000-4000-8000-000000000011','d1000000-0000-4000-8000-000000000001','d3000000-0000-4000-8000-000000000002',current_date,'10:00',
      'd2000000-0000-4000-8000-000000000002','done',true,now(),'d2000000-0000-4000-8000-000000000002','d2000000-0000-4000-8000-000000000001');
    raise exception 'member inserted a walk crediting another walker';
  exception when others then
    if sqlerrm = 'member inserted a walk crediting another walker' then raise; end if;
    if sqlerrm not like '%actual walker can only be set%' then raise; end if;
  end;
  -- Ordinary direct edits and retrospective inserts (which never carry the column) keep working.
  update public.walks set note='edited directly' where id='d4000000-0000-4000-8000-000000000010';
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'ordinary direct edit of an own unplanned walk no longer works'; end if;
  insert into public.walks(id,family_id,dog_id,date,scheduled_time,responsible_user_id,status,is_unplanned,completed_at,completed_by_user_id)
  values ('d4000000-0000-4000-8000-000000000011','d1000000-0000-4000-8000-000000000001','d3000000-0000-4000-8000-000000000002',current_date,'10:00',
    'd2000000-0000-4000-8000-000000000002','done',true,now(),'d2000000-0000-4000-8000-000000000002');
end;
$member_direct$;

-- A family admin is not exempt: the walker is changed only through the audited operations.
select set_config('request.jwt.claim.sub','d0000000-0000-4000-8000-000000000001',true);
select set_config('request.jwt.claims','{"sub":"d0000000-0000-4000-8000-000000000001","role":"authenticated"}',true);

do $admin_direct$
begin
  if public.is_family_admin('d1000000-0000-4000-8000-000000000001') is not true then
    raise exception 'fixture admin is not a family admin';
  end if;
  begin
    update public.walks set actual_walker_user_id='d2000000-0000-4000-8000-000000000001' where id='d4000000-0000-4000-8000-000000000002';
    raise exception 'admin set actual_walker_user_id directly on a legacy active walk';
  exception when others then
    if sqlerrm = 'admin set actual_walker_user_id directly on a legacy active walk' then raise; end if;
    if sqlerrm not like '%actual walker can only be changed%' then raise; end if;
  end;
end;
$admin_direct$;

-- The audited RPC path is unaffected by the guard: the member starts their own walk.
select set_config('request.jwt.claim.sub','d0000000-0000-4000-8000-000000000002',true);
select set_config('request.jwt.claims','{"sub":"d0000000-0000-4000-8000-000000000002","role":"authenticated"}',true);

do $rpc_start$
declare w public.walks;
begin
  w := public.start_walk_v11('d4000000-0000-4000-8000-000000000012','d2000000-0000-4000-8000-000000000002',
    'd2000000-0000-4000-8000-000000000002','d7000000-0000-4000-8000-000000000011',false,false);
  if w.status <> 'in_progress' or w.actual_walker_user_id is distinct from 'd2000000-0000-4000-8000-000000000002'::uuid then
    raise exception 'start_walk_v11 did not record the actual walker';
  end if;
end;
$rpc_start$;

-- ============================================================ (2)+(3) GPS leases for a walk active before v1.1
-- A regular member is not the walker of d4..02 (responsible: d2..01).
do $non_walker$
begin
  begin
    perform public.acquire_walk_gps_ownership_v11('d4000000-0000-4000-8000-000000000002', false);
    raise exception 'a non-walker acquired GPS ownership of a legacy active walk';
  exception when others then
    if sqlerrm = 'a non-walker acquired GPS ownership of a legacy active walk' then raise; end if;
    if sqlerrm not like '%only the actual walker can collect GPS%' then raise; end if;
  end;
end;
$non_walker$;

-- Device 1 (admin, auth ..01) is the responsible member, hence the walker.
select set_config('request.jwt.claim.sub','d0000000-0000-4000-8000-000000000001',true);
select set_config('request.jwt.claims','{"sub":"d0000000-0000-4000-8000-000000000001","role":"authenticated"}',true);

do $device1_first$
declare lease record; beat timestamptz; saved public.walk_gps_sessions;
begin
  select * into lease from public.acquire_walk_gps_ownership_v11('d4000000-0000-4000-8000-000000000002', false);
  if lease.fencing_epoch <> 1 then raise exception 'first lease epoch should be 1, got %', lease.fencing_epoch; end if;
  -- Re-acquiring while the lease is active is a renewal: same epoch, no new audit event.
  select * into lease from public.acquire_walk_gps_ownership_v11('d4000000-0000-4000-8000-000000000002', false);
  if lease.fencing_epoch <> 1 then raise exception 'active renewal changed the epoch to %', lease.fencing_epoch; end if;
  beat := public.heartbeat_walk_gps_ownership_v11('d4000000-0000-4000-8000-000000000002', 1);
  if beat is null then raise exception 'heartbeat failed for a legacy active walk'; end if;
  saved := public.append_walk_gps_route_v11('d4000000-0000-4000-8000-000000000002', 1,
    '[{"latitude":31.1,"longitude":34.1,"timestamp":1760000000000}]'::jsonb, 10, 1, null, null);
  if saved.walk_id is distinct from 'd4000000-0000-4000-8000-000000000002'::uuid then raise exception 'route append returned the wrong session'; end if;
end;
$device1_first$;

reset role;
do $audit_after_renew$
begin
  if (select count(*) from public.walk_lifecycle_events where walk_id='d4000000-0000-4000-8000-000000000002' and action='gps_owner_changed') <> 1 then
    raise exception 'renewing an active lease must not add an ownership-change event (count=%)',
      (select count(*) from public.walk_lifecycle_events where walk_id='d4000000-0000-4000-8000-000000000002' and action='gps_owner_changed');
  end if;
  if (select count(*) from public.walk_gps_route_samples_v11 where walk_id='d4000000-0000-4000-8000-000000000002') <> 1 then
    raise exception 'the fenced route sample was not stored for the legacy active walk';
  end if;
  if (select actual_walker_user_id from public.walks where id='d4000000-0000-4000-8000-000000000002') is not null then
    raise exception 'GPS ownership must not backfill actual_walker_user_id';
  end if;
  if (select actual_walker_user_id from public.walk_lifecycle_events where walk_id='d4000000-0000-4000-8000-000000000002' and action='gps_owner_changed')
       is distinct from 'd2000000-0000-4000-8000-000000000001'::uuid then
    raise exception 'the ownership event must record the effective walker';
  end if;
  -- Simulate the 45-second lease lapsing while the phone was locked.
  update public.walk_gps_ownership set expires_at = now() - interval '1 second' where walk_id='d4000000-0000-4000-8000-000000000002';
end;
$audit_after_renew$;

set local role authenticated;
select set_config('request.jwt.claim.sub','d0000000-0000-4000-8000-000000000001',true);
select set_config('request.jwt.claims','{"sub":"d0000000-0000-4000-8000-000000000001","role":"authenticated"}',true);

do $device1_lapsed$
declare lease record;
begin
  -- The same device renewing a lapsed lease gets a new fencing epoch but is not an owner change.
  select * into lease from public.acquire_walk_gps_ownership_v11('d4000000-0000-4000-8000-000000000002', false);
  if lease.fencing_epoch <> 2 then raise exception 'lapsed same-device renewal should move to epoch 2, got %', lease.fencing_epoch; end if;
end;
$device1_lapsed$;

reset role;
do $audit_after_lapse$
begin
  if (select count(*) from public.walk_lifecycle_events where walk_id='d4000000-0000-4000-8000-000000000002' and action='gps_owner_changed') <> 1 then
    raise exception 'a same-device renewal after lapse must not be audited as an ownership change';
  end if;
  update public.walk_gps_ownership set expires_at = now() - interval '1 second' where walk_id='d4000000-0000-4000-8000-000000000002';
end;
$audit_after_lapse$;

-- Device 2 (same admin profile, different auth session) can take over only with explicit confirmation.
set local role authenticated;
select set_config('request.jwt.claim.sub','d0000000-0000-4000-8000-000000000003',true);
select set_config('request.jwt.claims','{"sub":"d0000000-0000-4000-8000-000000000003","role":"authenticated"}',true);

do $device2_transfer$
declare lease record;
begin
  begin
    perform public.acquire_walk_gps_ownership_v11('d4000000-0000-4000-8000-000000000002', false);
    raise exception 'device 2 took over GPS without confirming the transfer';
  exception when others then
    if sqlerrm = 'device 2 took over GPS without confirming the transfer' then raise; end if;
    if sqlerrm not like '%confirm GPS transfer on this device%' then raise; end if;
  end;
  select * into lease from public.acquire_walk_gps_ownership_v11('d4000000-0000-4000-8000-000000000002', true);
  if lease.fencing_epoch <> 3 then raise exception 'transfer should move to epoch 3, got %', lease.fencing_epoch; end if;
end;
$device2_transfer$;

-- Device 1 is fenced out immediately.
select set_config('request.jwt.claim.sub','d0000000-0000-4000-8000-000000000001',true);
select set_config('request.jwt.claims','{"sub":"d0000000-0000-4000-8000-000000000001","role":"authenticated"}',true);

do $device1_fenced$
begin
  begin
    perform public.heartbeat_walk_gps_ownership_v11('d4000000-0000-4000-8000-000000000002', 2);
    raise exception 'the fenced-out device renewed its lease';
  exception when others then
    if sqlerrm = 'the fenced-out device renewed its lease' then raise; end if;
    if sqlerrm not like '%GPS ownership expired or transferred%' then raise; end if;
  end;
  begin
    perform public.append_walk_gps_route_v11('d4000000-0000-4000-8000-000000000002', 2,
      '[{"latitude":31.2,"longitude":34.2,"timestamp":1760000001000}]'::jsonb, 20, 2, null, null);
    raise exception 'the fenced-out device wrote a route point';
  exception when others then
    if sqlerrm = 'the fenced-out device wrote a route point' then raise; end if;
    if sqlerrm not like '%GPS ownership expired or transferred%' then raise; end if;
  end;
end;
$device1_fenced$;

reset role;
do $audit_after_transfer$
begin
  if (select count(*) from public.walk_lifecycle_events where walk_id='d4000000-0000-4000-8000-000000000002' and action='gps_owner_changed') <> 2 then
    raise exception 'a device transfer must be audited exactly once';
  end if;
  if (select details->>'device_auth_user_id' from public.walk_lifecycle_events
        where walk_id='d4000000-0000-4000-8000-000000000002' and action='gps_owner_changed' order by id desc limit 1) <> 'd0000000-0000-4000-8000-000000000003' then
    raise exception 'the transfer event does not name the new device';
  end if;
end;
$audit_after_transfer$;

-- Release and re-acquire on the same device: the release and the new ownership period are both audited.
set local role authenticated;
select set_config('request.jwt.claim.sub','d0000000-0000-4000-8000-000000000003',true);
select set_config('request.jwt.claims','{"sub":"d0000000-0000-4000-8000-000000000003","role":"authenticated"}',true);

do $release_reacquire$
begin
  if public.release_walk_gps_ownership_v11('d4000000-0000-4000-8000-000000000002', 3) is not true then raise exception 'release failed'; end if;
  perform public.acquire_walk_gps_ownership_v11('d4000000-0000-4000-8000-000000000002', false);
end;
$release_reacquire$;

reset role;
do $audit_after_release$
begin
  if (select count(*) from public.walk_lifecycle_events where walk_id='d4000000-0000-4000-8000-000000000002' and action='gps_owner_changed') <> 4 then
    raise exception 'release + re-acquire should add two events (count=%)',
      (select count(*) from public.walk_lifecycle_events where walk_id='d4000000-0000-4000-8000-000000000002' and action='gps_owner_changed');
  end if;
end;
$audit_after_release$;

-- ============================================================ (4) completion-time bounds
set local role authenticated;
select set_config('request.jwt.claim.sub','d0000000-0000-4000-8000-000000000001',true);
select set_config('request.jwt.claims','{"sub":"d0000000-0000-4000-8000-000000000001","role":"authenticated"}',true);

do $bounds$
declare w public.walks; started timestamptz;
begin
  select started_at into started from public.walks where id='d4000000-0000-4000-8000-000000000002';
  begin
    perform public.finish_walk_v11('d4000000-0000-4000-8000-000000000002','d2000000-0000-4000-8000-000000000001',
      'd2000000-0000-4000-8000-000000000001','d7000000-0000-4000-8000-000000000021',null,null,null,now()+interval '1 hour',false);
    raise exception 'a completion time an hour in the future was accepted';
  exception when others then
    if sqlerrm = 'a completion time an hour in the future was accepted' then raise; end if;
    if sqlerrm not like '%completion time cannot be in the future%' then raise; end if;
  end;
  begin
    perform public.finish_walk_v11('d4000000-0000-4000-8000-000000000002','d2000000-0000-4000-8000-000000000001',
      'd2000000-0000-4000-8000-000000000001','d7000000-0000-4000-8000-000000000022',null,null,null,started - interval '8 days',false);
    raise exception 'a completion time 8 days before the walk started was accepted';
  exception when others then
    if sqlerrm = 'a completion time 8 days before the walk started was accepted' then raise; end if;
    if sqlerrm not like '%completion time is too far before the walk started%' then raise; end if;
  end;
  -- Neither rejected attempt consumed its operation id or changed the walk.
  reset role;  -- the operations table is not readable by clients
  if exists (select 1 from public.walk_lifecycle_operations where operation_id in ('d7000000-0000-4000-8000-000000000021','d7000000-0000-4000-8000-000000000022')) then
    raise exception 'a rejected finish left an operation record behind';
  end if;
  set local role authenticated;
  if (select status from public.walks where id='d4000000-0000-4000-8000-000000000002') <> 'in_progress' then
    raise exception 'a rejected finish changed the walk';
  end if;
  -- A small device clock skew is clamped to server time rather than stored in the future.
  w := public.finish_walk_v11('d4000000-0000-4000-8000-000000000002','d2000000-0000-4000-8000-000000000001',
    'd2000000-0000-4000-8000-000000000001','d7000000-0000-4000-8000-000000000023',null,null,null,now()+interval '10 minutes',false);
  if w.status <> 'done' or w.completed_at > now() then raise exception 'clock-skewed completion was not clamped to server time'; end if;
end;
$bounds$;

-- An offline walk is started at replay time but finished at the time the walker recorded: allowed within a week.
select set_config('request.jwt.claim.sub','d0000000-0000-4000-8000-000000000002',true);
select set_config('request.jwt.claims','{"sub":"d0000000-0000-4000-8000-000000000002","role":"authenticated"}',true);

do $offline_replay_time$
declare w public.walks;
begin
  w := public.finish_walk_v11('d4000000-0000-4000-8000-000000000012','d2000000-0000-4000-8000-000000000002',
    'd2000000-0000-4000-8000-000000000002','d7000000-0000-4000-8000-000000000024',true,null,null,now()-interval '3 days',false);
  if w.status <> 'done' or w.completed_at <> now()-interval '3 days' or w.duration_minutes <> 0 then
    raise exception 'an offline-recorded completion time inside the tolerance window was not honoured';
  end if;
end;
$offline_replay_time$;

-- ============================================================ (5) provider acceptance is never erased
reset role;
select set_config('app.trusted_write','on',true);
insert into public.walk_lifecycle_notifications(id,family_id,walk_id,recipient_user_id,actor_user_id,kind,delivery_state,provider_accepted_at,opened_at,delivery_claimed_at) values
 ('d8000000-0000-4000-8000-000000000001','d1000000-0000-4000-8000-000000000001','d4000000-0000-4000-8000-000000000012','d2000000-0000-4000-8000-000000000002','d2000000-0000-4000-8000-000000000001','remote_start','opened',now()-interval '5 minutes',now()-interval '1 minute',now()-interval '6 minutes'),
 ('d8000000-0000-4000-8000-000000000002','d1000000-0000-4000-8000-000000000001','d4000000-0000-4000-8000-000000000012','d2000000-0000-4000-8000-000000000002','d2000000-0000-4000-8000-000000000001','activate_gps','sending',null,null,now()),
 ('d8000000-0000-4000-8000-000000000003','d1000000-0000-4000-8000-000000000001','d4000000-0000-4000-8000-000000000012','d2000000-0000-4000-8000-000000000002','d2000000-0000-4000-8000-000000000001','remote_finish','sending',null,null,now());
select set_config('app.trusted_write','off',true);

create temp table accepted_before as
  select id, provider_accepted_at from public.walk_lifecycle_notifications where id = 'd8000000-0000-4000-8000-000000000001';
grant select on accepted_before to authenticated;

set local role authenticated;
select set_config('request.jwt.claim.sub','d0000000-0000-4000-8000-000000000001',true);
select set_config('request.jwt.claims','{"sub":"d0000000-0000-4000-8000-000000000001","role":"authenticated"}',true);

do $delivery$
declare changed integer;
begin
  -- A late failure for an already-opened notification that a provider accepted earlier.
  changed := public.finish_walk_lifecycle_notification_delivery_v11(array['d8000000-0000-4000-8000-000000000001']::uuid[], false, 'late duplicate attempt failed');
  if changed <> 1 then raise exception 'late failure result was not applied (%)', changed; end if;
  -- A later success report for the same opened notification must not move the original timestamp either.
  changed := public.finish_walk_lifecycle_notification_delivery_v11(array['d8000000-0000-4000-8000-000000000001']::uuid[], true, null);
  if changed <> 1 then raise exception 'late success result was not applied (%)', changed; end if;
  -- Ordinary outcomes still work.
  changed := public.finish_walk_lifecycle_notification_delivery_v11(array['d8000000-0000-4000-8000-000000000002']::uuid[], false, 'no registered push destinations');
  changed := changed + public.finish_walk_lifecycle_notification_delivery_v11(array['d8000000-0000-4000-8000-000000000003']::uuid[], true, null);
  if changed <> 2 then raise exception 'ordinary delivery outcomes were not applied (%)', changed; end if;
end;
$delivery$;

reset role;
do $delivery_assertions$
begin
  if (select n.provider_accepted_at from public.walk_lifecycle_notifications n where n.id='d8000000-0000-4000-8000-000000000001')
       is distinct from (select b.provider_accepted_at from accepted_before b) then
    raise exception 'a late delivery result changed the recorded provider acceptance time';
  end if;
  if (select delivery_state from public.walk_lifecycle_notifications where id='d8000000-0000-4000-8000-000000000001') <> 'opened' then
    raise exception 'an opened notification must stay opened';
  end if;
  if (select failure_reason from public.walk_lifecycle_notifications where id='d8000000-0000-4000-8000-000000000001') is not null then
    raise exception 'an opened notification must not carry a failure reason';
  end if;
  if not exists (select 1 from public.walk_lifecycle_notifications where id='d8000000-0000-4000-8000-000000000002'
       and delivery_state='failed' and provider_accepted_at is null and failure_reason='no registered push destinations') then
    raise exception 'a failed delivery was not recorded as failed without an acceptance time';
  end if;
  if not exists (select 1 from public.walk_lifecycle_notifications where id='d8000000-0000-4000-8000-000000000003'
       and delivery_state='provider_accepted' and provider_accepted_at is not null) then
    raise exception 'an accepted delivery was not recorded';
  end if;
end;
$delivery_assertions$;

rollback;
