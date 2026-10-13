-- Walk Lifecycle & GPS Flow v1.1 — additive, review-only migration.
-- This file is intentionally NOT applied to any hosted database.
-- Existing walks are never auto-resolved or rewritten. The partial unique
-- index fails closed with an actionable diagnostic if old data contains
-- multiple active walks for a dog; operators must review that conflict in a
-- separately approved data-change plan before this migration can proceed.
-- Only rows bearing an administrator-created audit marker are excluded.

-- Run the data gate first so a known conflict causes no preceding DDL to be
-- applied by migration runners that do not wrap the whole file in a transaction.
do $$
declare conflicts text;
begin
  select string_agg(format('dog %s (%s active walks)', dog_id, active_count), ', ' order by dog_id)
    into conflicts
    from (
      select dog_id, count(*) as active_count
      from public.walks
      where status = 'in_progress' and duplicate_resolution_group_id is null
      group by dog_id
      having count(*) > 1
    ) as duplicates;
  if conflicts is not null then
    raise exception 'Walk Lifecycle v1.1 blocked: duplicate active walks require owner-reviewed resolution before uniqueness can be enforced: %', conflicts;
  end if;
end $$;

alter table public.walks
  add column if not exists actual_walker_user_id uuid references public.users(id) on delete set null;
alter table public.families
  add column if not exists spontaneous_association_window_minutes smallint not null default 30
  check (spontaneous_association_window_minutes between 5 and 120);

create table if not exists public.walk_lifecycle_operations (
  actor_user_id uuid not null references public.users(id) on delete restrict,
  operation_id uuid not null,
  action text not null check (action in ('start','start_spontaneous','finish')),
  walk_id uuid not null,
  payload jsonb not null,
  created_at timestamptz not null default now(),
  primary key (actor_user_id, operation_id)
);
alter table public.walk_lifecycle_operations enable row level security;
revoke all on public.walk_lifecycle_operations from public, anon, authenticated;

create table if not exists public.walk_lifecycle_events (
  id bigint generated always as identity primary key,
  family_id uuid not null references public.families(id) on delete cascade,
  dog_id uuid not null references public.dogs(id) on delete cascade,
  walk_id uuid not null references public.walks(id) on delete cascade,
  action text not null check (action in ('started','remotely_started','finished','remotely_finished','gps_owner_changed')),
  actor_user_id uuid not null references public.users(id) on delete restrict,
  original_assignee_user_id uuid references public.users(id) on delete set null,
  current_assignee_user_id uuid references public.users(id) on delete set null,
  actual_walker_user_id uuid references public.users(id) on delete set null,
  operation_id uuid,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
alter table public.walk_lifecycle_events enable row level security;
create policy "family members can read walk lifecycle events" on public.walk_lifecycle_events
  for select to authenticated using (family_id = current_family_id());
revoke insert, update, delete on public.walk_lifecycle_events from public, anon, authenticated;
grant select on public.walk_lifecycle_events to authenticated;

create table if not exists public.walk_gps_ownership (
  walk_id uuid primary key references public.walks(id) on delete cascade,
  family_id uuid not null references public.families(id) on delete cascade,
  dog_id uuid not null references public.dogs(id) on delete cascade,
  owner_user_id uuid not null references public.users(id) on delete restrict,
  owner_auth_user_id uuid not null,
  fencing_epoch bigint not null default 1 check (fencing_epoch > 0),
  expires_at timestamptz not null,
  ended_at timestamptz,
  distance_meters numeric(10,2) not null default 0 check (distance_meters >= 0),
  point_count integer not null default 0 check (point_count >= 0),
  route_started_at timestamptz,
  route_ended_at timestamptz,
  updated_at timestamptz not null default now()
);
alter table public.walk_gps_ownership enable row level security;
create policy "family members can read walk gps ownership" on public.walk_gps_ownership
  for select to authenticated using (family_id = current_family_id());
revoke insert, update, delete on public.walk_gps_ownership from public, anon, authenticated;
grant select on public.walk_gps_ownership to authenticated;

-- v1.1 coordinates are isolated from the legacy GPS session upsert queue.
-- This keeps old queued payloads untouched while ensuring new coordinates
-- can only be written by append_walk_gps_route_v11 after lease validation.
create table if not exists public.walk_gps_route_samples_v11 (
  walk_id uuid not null references public.walks(id) on delete cascade,
  family_id uuid not null references public.families(id) on delete cascade,
  dog_id uuid not null references public.dogs(id) on delete cascade,
  fencing_epoch bigint not null,
  point_timestamp_ms bigint not null,
  latitude double precision not null check (latitude between -90 and 90),
  longitude double precision not null check (longitude between -180 and 180),
  sampled_at timestamptz not null,
  ingested_at timestamptz not null default now(),
  primary key (walk_id,point_timestamp_ms)
);
create index if not exists walk_gps_route_samples_v11_family_walk_idx on public.walk_gps_route_samples_v11(family_id,walk_id,sampled_at);
alter table public.walk_gps_route_samples_v11 enable row level security;
create policy "family members can read v11 walk gps route" on public.walk_gps_route_samples_v11
  for select to authenticated using (family_id=current_family_id());
revoke insert, update, delete on public.walk_gps_route_samples_v11 from public, anon, authenticated;
grant select on public.walk_gps_route_samples_v11 to authenticated;

create or replace function public.prune_walk_gps_route_samples_v11()
returns integer language plpgsql security definer set search_path=pg_catalog,public as $$
declare affected integer;
begin
  delete from public.walk_gps_route_samples_v11 where ingested_at < now()-interval '7 days';
  get diagnostics affected = row_count;
  return affected;
end;
$$;
revoke all on function public.prune_walk_gps_route_samples_v11() from public,anon,authenticated;
do $$
begin
  if exists(select 1 from pg_extension where extname='pg_cron')
     and not exists(select 1 from cron.job where jobname='walkie-prune-gps-route-samples-v11') then
    perform cron.schedule('walkie-prune-gps-route-samples-v11','23 3 * * *','select public.prune_walk_gps_route_samples_v11();');
  end if;
end $$;

create table if not exists public.walk_lifecycle_notifications (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families(id) on delete cascade,
  walk_id uuid not null references public.walks(id) on delete cascade,
  recipient_user_id uuid not null references public.users(id) on delete restrict,
  actor_user_id uuid not null references public.users(id) on delete restrict,
  kind text not null check (kind in ('remote_start','activate_gps','remote_finish')),
  delivery_state text not null default 'pending' check (delivery_state in ('pending','sending','provider_accepted','failed','opened')),
  failure_reason text,
  delivery_claimed_at timestamptz,
  created_at timestamptz not null default now(),
  provider_accepted_at timestamptz,
  opened_at timestamptz,
  unique (walk_id,recipient_user_id,kind,created_at)
);
alter table public.walk_lifecycle_notifications enable row level security;
create policy "walk lifecycle notification recipient can read" on public.walk_lifecycle_notifications
  for select to authenticated using (family_id=current_family_id() and recipient_user_id=real_current_profile_id());
revoke insert, update, delete on public.walk_lifecycle_notifications from public, anon, authenticated;
grant select on public.walk_lifecycle_notifications to authenticated;

create or replace function public.claim_walk_lifecycle_notifications_v11(p_walk_id uuid)
returns table(notification_id uuid,family_id uuid,walk_id uuid,recipient_user_id uuid,actor_user_id uuid,kind text,recipient_name text,actor_name text,dog_name text,scheduled_time text)
language plpgsql security definer set search_path=pg_catalog,public as $$
declare actor uuid:=public.real_current_profile_id();
begin
  if auth.uid() is null or actor is null or not public.is_family_admin(public.current_family_id()) then raise exception 'family admin required'; end if;
  return query
    with claimed as (
      update public.walk_lifecycle_notifications n set delivery_state='sending',delivery_claimed_at=now(),failure_reason=null
      where n.walk_id=p_walk_id and n.family_id=public.current_family_id() and n.actor_user_id=actor
        and n.kind in ('remote_start','activate_gps','remote_finish')
        and (n.delivery_state in ('pending','failed') or (n.delivery_state='sending' and n.delivery_claimed_at<now()-interval '2 minutes'))
      returning n.*
    )
    select c.id,c.family_id,c.walk_id,c.recipient_user_id,c.actor_user_id,c.kind,recipient.name,actor_user.name,d.name,w.scheduled_time
    from claimed c join public.users recipient on recipient.id=c.recipient_user_id
      join public.users actor_user on actor_user.id=c.actor_user_id
      join public.walks w on w.id=c.walk_id join public.dogs d on d.id=w.dog_id;
end;
$$;
revoke all on function public.claim_walk_lifecycle_notifications_v11(uuid) from public,anon;
grant execute on function public.claim_walk_lifecycle_notifications_v11(uuid) to authenticated;

create or replace function public.finish_walk_lifecycle_notification_delivery_v11(p_notification_ids uuid[],p_provider_accepted boolean,p_failure_reason text default null)
returns integer language plpgsql security definer set search_path=pg_catalog,public as $$
declare actor uuid:=public.real_current_profile_id(); affected integer;
begin
  if auth.uid() is null or actor is null or not public.is_family_admin(public.current_family_id()) then raise exception 'family admin required'; end if;
  update public.walk_lifecycle_notifications n set delivery_state=case
      when n.delivery_state='opened' then 'opened'
      when p_provider_accepted then 'provider_accepted'
      else 'failed' end,
    failure_reason=case when p_provider_accepted or n.delivery_state='opened' then null else left(coalesce(p_failure_reason,'delivery failed'),240) end,
    provider_accepted_at=case when p_provider_accepted then now() else null end
  where n.id=any(p_notification_ids) and n.family_id=public.current_family_id() and n.actor_user_id=actor and n.delivery_state in ('sending','opened');
  get diagnostics affected=row_count;
  return affected;
end;
$$;
revoke all on function public.finish_walk_lifecycle_notification_delivery_v11(uuid[],boolean,text) from public,anon;
grant execute on function public.finish_walk_lifecycle_notification_delivery_v11(uuid[],boolean,text) to authenticated;

-- Provider acceptance only means a push provider queued a destination. This
-- separate recipient-scoped RPC records that the app actually opened it.
create or replace function public.acknowledge_walk_lifecycle_notifications_v11(p_notification_ids uuid[])
returns integer language plpgsql security definer set search_path=pg_catalog,public as $$
declare actor uuid:=public.real_current_profile_id(); affected integer;
begin
  if auth.uid() is null or actor is null then raise exception 'active profile required'; end if;
  update public.walk_lifecycle_notifications n
    set delivery_state='opened',opened_at=coalesce(opened_at,now())
    where n.id=any(p_notification_ids)
      and n.family_id=public.current_family_id()
      and n.recipient_user_id=actor
      and n.delivery_state in ('pending','sending','provider_accepted','failed');
  get diagnostics affected=row_count;
  return affected;
end;
$$;
revoke all on function public.acknowledge_walk_lifecycle_notifications_v11(uuid[]) from public,anon;
grant execute on function public.acknowledge_walk_lifecycle_notifications_v11(uuid[]) to authenticated;

create unique index if not exists walks_one_active_per_dog_uidx
  on public.walks (dog_id) where status = 'in_progress' and duplicate_resolution_group_id is null;

create or replace function public.start_walk_v11(
  p_walk_id uuid,
  p_actual_walker_id uuid,
  p_expected_actor_id uuid,
  p_operation_id uuid,
  p_substitution_confirmed boolean default false,
  p_remote_start boolean default false
)
returns public.walks
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  w public.walks;
  actor uuid := public.real_current_profile_id();
  prior public.walk_lifecycle_operations;
  original_assignee uuid;
  is_new boolean;
begin
  if auth.uid() is null or actor is null then raise exception 'active profile required'; end if;
  if p_expected_actor_id is distinct from actor then raise exception 'profile changed; lifecycle action must be reviewed by the current member'; end if;
  if p_operation_id is null then raise exception 'operation id required'; end if;
  select * into w from public.walks where id = p_walk_id and family_id = public.current_family_id() for update;
  if not found then raise exception 'walk not found'; end if;
  if w.duplicate_resolution_group_id is not null then raise exception 'resolved duplicate walk cannot be started'; end if;

  insert into public.walk_lifecycle_operations(actor_user_id, operation_id, action, walk_id, payload)
    values (actor, p_operation_id, 'start', w.id,
      jsonb_build_object('actual_walker_id', p_actual_walker_id, 'substitution_confirmed', p_substitution_confirmed, 'remote_start', p_remote_start))
    on conflict (actor_user_id, operation_id) do nothing
    returning true into is_new;
  select * into prior from public.walk_lifecycle_operations where actor_user_id = actor and operation_id = p_operation_id for update;
  if prior.action <> 'start' or prior.walk_id <> w.id or prior.payload <> jsonb_build_object('actual_walker_id', p_actual_walker_id, 'substitution_confirmed', p_substitution_confirmed, 'remote_start', p_remote_start) then
    raise exception 'operation id reused with a different walk start request';
  end if;
  if not coalesce(is_new, false) then
    -- The insert is transaction-local on first use; an existing committed
    -- row indicates a retry. Return the canonical state idempotently.
    return w;
  end if;

  if w.status <> 'pending' then
    raise exception 'walk is not pending';
  end if;
  if p_remote_start and not public.is_family_admin(w.family_id) then raise exception 'family admin required for remote start'; end if;
  if not exists (
    select 1 from public.users u where u.id = p_actual_walker_id and u.family_id = w.family_id and u.removed_at is null
  ) then raise exception 'actual walker must be an active member of this family'; end if;
  if not public.is_family_admin(w.family_id) then
    if actor = w.responsible_user_id then
      if p_actual_walker_id <> actor or p_remote_start then raise exception 'assigned member can only start for themselves'; end if;
    elsif p_actual_walker_id = actor and p_substitution_confirmed and not p_remote_start then
      null; -- regular member explicitly confirmed they are walking instead
    else
      raise exception 'only assigned member or confirmed substitute may start this walk';
    end if;
  end if;

  -- Serialize concurrent starts on different schedule rows for the same dog.
  perform pg_advisory_xact_lock(hashtextextended(w.dog_id::text, 0));
  if exists (select 1 from public.walks active where active.dog_id = w.dog_id and active.status = 'in_progress' and active.duplicate_resolution_group_id is null and active.id <> w.id) then
    raise exception 'another active walk already exists for this dog';
  end if;

  original_assignee := coalesce(w.swap_original_user_id, w.responsible_user_id);
  perform set_config('app.trusted_write', 'on', true);
  update public.walks set status = 'in_progress', started_at = now(), started_by_user_id = actor,
    actual_walker_user_id = p_actual_walker_id, updated_at = now()
  where id = w.id returning * into w;
  insert into public.walk_lifecycle_events(family_id,dog_id,walk_id,action,actor_user_id,original_assignee_user_id,current_assignee_user_id,actual_walker_user_id,operation_id)
    values (w.family_id,w.dog_id,w.id,case when p_remote_start then 'remotely_started' else 'started' end,actor,original_assignee,w.responsible_user_id,p_actual_walker_id,p_operation_id);
  if p_remote_start then
    insert into public.walk_lifecycle_notifications(family_id,walk_id,recipient_user_id,actor_user_id,kind)
      values(w.family_id,w.id,p_actual_walker_id,actor,'remote_start');
    insert into public.walk_lifecycle_notifications(family_id,walk_id,recipient_user_id,actor_user_id,kind)
      values(w.family_id,w.id,p_actual_walker_id,actor,'activate_gps');
  end if;
  return w;
end;
$$;
revoke all on function public.start_walk_v11(uuid,uuid,uuid,uuid,boolean,boolean) from public, anon;
grant execute on function public.start_walk_v11(uuid,uuid,uuid,uuid,boolean,boolean) to authenticated;

create or replace function public.start_spontaneous_walk_v11(
  p_walk_id uuid,
  p_family_id uuid,
  p_dog_id uuid,
  p_date date,
  p_scheduled_time text,
  p_expected_actor_id uuid,
  p_operation_id uuid
)
returns public.walks
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  actor uuid := public.real_current_profile_id();
  w public.walks;
  prior public.walk_lifecycle_operations;
  is_new boolean;
begin
  if auth.uid() is null or actor is null then raise exception 'active profile required'; end if;
  if p_expected_actor_id is distinct from actor then raise exception 'profile changed; lifecycle action must be reviewed by the current member'; end if;
  if p_family_id is distinct from public.current_family_id() then raise exception 'family mismatch'; end if;
  if p_operation_id is null then raise exception 'operation id required'; end if;
  insert into public.walk_lifecycle_operations(actor_user_id,operation_id,action,walk_id,payload)
    values(actor,p_operation_id,'start_spontaneous',p_walk_id,jsonb_build_object('family_id',p_family_id,'dog_id',p_dog_id,'date',p_date,'scheduled_time',p_scheduled_time))
    on conflict(actor_user_id,operation_id) do nothing returning true into is_new;
  select * into prior from public.walk_lifecycle_operations where actor_user_id=actor and operation_id=p_operation_id for update;
  if prior.action <> 'start_spontaneous' or prior.walk_id <> p_walk_id or prior.payload <> jsonb_build_object('family_id',p_family_id,'dog_id',p_dog_id,'date',p_date,'scheduled_time',p_scheduled_time) then
    raise exception 'operation id reused with a different spontaneous start request';
  end if;
  if not coalesce(is_new,false) then
    select * into w from public.walks where id=prior.walk_id and family_id=p_family_id;
    if not found then raise exception 'idempotent walk result is unavailable'; end if;
    return w;
  end if;
  if not exists(select 1 from public.dogs d where d.id=p_dog_id and d.family_id=p_family_id) then raise exception 'dog not found'; end if;
  if not exists(select 1 from public.users u where u.id=actor and u.family_id=p_family_id and u.removed_at is null) then raise exception 'active family member required'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_dog_id::text, 0));
  if exists(select 1 from public.walks active where active.dog_id=p_dog_id and active.status='in_progress' and active.duplicate_resolution_group_id is null) then raise exception 'another active walk already exists for this dog'; end if;
  perform set_config('app.trusted_write','on',true);
  insert into public.walks(id,family_id,schedule_entry_id,dog_id,date,scheduled_time,responsible_user_id,status,started_at,started_by_user_id,actual_walker_user_id,is_unplanned)
    values(p_walk_id,p_family_id,null,p_dog_id,p_date,p_scheduled_time,actor,'in_progress',now(),actor,actor,true)
    returning * into w;
  insert into public.walk_lifecycle_events(family_id,dog_id,walk_id,action,actor_user_id,original_assignee_user_id,current_assignee_user_id,actual_walker_user_id,operation_id)
    values(p_family_id,p_dog_id,w.id,'started',actor,actor,actor,actor,p_operation_id);
  return w;
end;
$$;
revoke all on function public.start_spontaneous_walk_v11(uuid,uuid,uuid,date,text,uuid,uuid) from public, anon;
grant execute on function public.start_spontaneous_walk_v11(uuid,uuid,uuid,date,text,uuid,uuid) to authenticated;

create or replace function public.finish_walk_v11(
  p_walk_id uuid,
  p_actual_walker_id uuid,
  p_expected_actor_id uuid,
  p_operation_id uuid,
  p_had_pee boolean default null,
  p_had_poop boolean default null,
  p_note text default null,
  p_completed_at timestamptz default null,
  p_remote_confirmation boolean default false
)
returns public.walks
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  w public.walks;
  actor uuid := public.real_current_profile_id();
  prior public.walk_lifecycle_operations;
  event_action text;
  request_payload jsonb;
  is_new boolean;
  walker uuid;
begin
  if auth.uid() is null or actor is null then raise exception 'active profile required'; end if;
  if p_expected_actor_id is distinct from actor then raise exception 'profile changed; lifecycle action must be reviewed by the current member'; end if;
  if p_operation_id is null then raise exception 'operation id required'; end if;
  select * into w from public.walks where id=p_walk_id and family_id=public.current_family_id() for update;
  if not found then raise exception 'walk not found'; end if;
  -- A walk already in progress when this migration is applied was started by
  -- the legacy start_walk() and has no actual_walker_user_id. Use the same
  -- default the legacy finish_walk() used (the responsible member) so such a
  -- walk can still be finished, and so NULL can never satisfy the walker
  -- authorization comparisons below. The row itself is not backfilled.
  walker:=coalesce(w.actual_walker_user_id,w.responsible_user_id);
  request_payload:=jsonb_build_object('actual_walker_id',p_actual_walker_id,'had_pee',p_had_pee,'had_poop',p_had_poop,'note',p_note,'completed_at',p_completed_at,'remote_confirmation',p_remote_confirmation);
  insert into public.walk_lifecycle_operations(actor_user_id,operation_id,action,walk_id,payload)
    values(actor,p_operation_id,'finish',w.id,request_payload) on conflict(actor_user_id,operation_id) do nothing returning true into is_new;
  select * into prior from public.walk_lifecycle_operations where actor_user_id=actor and operation_id=p_operation_id for update;
  if prior.action <> 'finish' or prior.walk_id <> w.id or prior.payload <> request_payload then raise exception 'operation id reused with a different finish request'; end if;
  if not coalesce(is_new,false) then
    if w.status='done' and w.ended_by_user_id=actor then return w; end if;
    raise exception 'walk finish operation is already recorded';
  end if;
  if w.status='done' and w.ended_by_user_id=actor then return w; end if;
  if w.status <> 'in_progress' or w.duplicate_resolution_group_id is not null then raise exception 'walk is not in progress'; end if;
  if walker is null or p_actual_walker_id is distinct from walker then raise exception 'actual walker cannot be changed during finish'; end if;
  if actor <> walker and not (public.is_family_admin(w.family_id) and p_remote_confirmation) then
    raise exception 'actual walker or confirmed family admin required to finish';
  end if;
  perform set_config('app.trusted_write','on',true);
  update public.walks set status='done',completed_at=coalesce(p_completed_at,now()),completed_by_user_id=p_actual_walker_id,
    ended_by_user_id=actor,had_pee=p_had_pee,had_poop=p_had_poop,note=p_note,
    duration_minutes=greatest(0,round(extract(epoch from (coalesce(p_completed_at,now())-started_at))/60.0)::int),updated_at=now()
  where id=w.id returning * into w;
  update public.walk_gps_ownership set fencing_epoch=fencing_epoch+1,ended_at=now(),expires_at=now(),updated_at=now() where walk_id=w.id and ended_at is null;
  event_action:=case when actor <> walker then 'remotely_finished' else 'finished' end;
  insert into public.walk_lifecycle_events(family_id,dog_id,walk_id,action,actor_user_id,original_assignee_user_id,current_assignee_user_id,actual_walker_user_id,operation_id)
    values(w.family_id,w.dog_id,w.id, event_action,actor,coalesce(w.swap_original_user_id,w.responsible_user_id),w.responsible_user_id,p_actual_walker_id,p_operation_id);
  if event_action='remotely_finished' then
    insert into public.walk_lifecycle_notifications(family_id,walk_id,recipient_user_id,actor_user_id,kind)
      values(w.family_id,w.id,p_actual_walker_id,actor,'remote_finish');
  end if;
  return w;
end;
$$;
revoke all on function public.finish_walk_v11(uuid,uuid,uuid,uuid,boolean,boolean,text,timestamptz,boolean) from public, anon;
grant execute on function public.finish_walk_v11(uuid,uuid,uuid,uuid,boolean,boolean,text,timestamptz,boolean) to authenticated;

create or replace function public.acquire_walk_gps_ownership_v11(p_walk_id uuid,p_confirm_transfer boolean default false)
returns table(fencing_epoch bigint,expires_at timestamptz)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  w public.walks;
  owner public.walk_gps_ownership;
  profile_id uuid:=public.real_current_profile_id();
  next_epoch bigint;
begin
  if auth.uid() is null or profile_id is null then raise exception 'active profile required'; end if;
  select * into w from public.walks where id=p_walk_id and family_id=public.current_family_id() for update;
  if not found or w.status <> 'in_progress' or w.duplicate_resolution_group_id is not null then raise exception 'active walk not found'; end if;
  if w.actual_walker_user_id is distinct from profile_id then raise exception 'only the actual walker can collect GPS'; end if;
  select * into owner from public.walk_gps_ownership where walk_id=w.id for update;
  if found and owner.owner_auth_user_id<>auth.uid() and not p_confirm_transfer then
    raise exception 'confirm GPS transfer on this device';
  end if;
  if found and owner.ended_at is null and owner.expires_at>now() and owner.owner_auth_user_id<>auth.uid() then
    raise exception 'current GPS owner must release tracking or its lease must expire before transfer';
  end if;
  next_epoch:=case when not found then 1 when owner.owner_auth_user_id=auth.uid() and owner.ended_at is null and owner.expires_at>now() then owner.fencing_epoch else owner.fencing_epoch+1 end;
  insert into public.walk_gps_ownership(walk_id,family_id,dog_id,owner_user_id,owner_auth_user_id,fencing_epoch,expires_at,ended_at,updated_at)
    values(w.id,w.family_id,w.dog_id,profile_id,auth.uid(),next_epoch,now()+interval '45 seconds',null,now())
    on conflict(walk_id) do update set owner_user_id=excluded.owner_user_id,owner_auth_user_id=excluded.owner_auth_user_id,
      fencing_epoch=excluded.fencing_epoch,expires_at=excluded.expires_at,ended_at=null,updated_at=now();
  insert into public.walk_lifecycle_events(family_id,dog_id,walk_id,action,actor_user_id,original_assignee_user_id,current_assignee_user_id,actual_walker_user_id,details)
    values(w.family_id,w.dog_id,w.id,'gps_owner_changed',profile_id,coalesce(w.swap_original_user_id,w.responsible_user_id),w.responsible_user_id,w.actual_walker_user_id,
      jsonb_build_object('fencing_epoch',next_epoch,'device_auth_user_id',auth.uid()));
  return query select next_epoch,now()+interval '45 seconds';
end;
$$;
revoke all on function public.acquire_walk_gps_ownership_v11(uuid,boolean) from public, anon;
grant execute on function public.acquire_walk_gps_ownership_v11(uuid,boolean) to authenticated;

create or replace function public.release_walk_gps_ownership_v11(p_walk_id uuid,p_fencing_epoch bigint)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  w public.walks;
  owner public.walk_gps_ownership;
  profile_id uuid:=public.real_current_profile_id();
begin
  if auth.uid() is null or profile_id is null then raise exception 'active profile required'; end if;
  select * into w from public.walks where id=p_walk_id and family_id=public.current_family_id() and status='in_progress' and duplicate_resolution_group_id is null for update;
  if not found or w.actual_walker_user_id is distinct from profile_id then raise exception 'active walk not found for current walker'; end if;
  select * into owner from public.walk_gps_ownership where walk_id=w.id for update;
  if not found or owner.owner_auth_user_id is distinct from auth.uid()
     or owner.fencing_epoch is distinct from p_fencing_epoch or owner.ended_at is not null then
    raise exception 'GPS ownership expired or transferred';
  end if;
  update public.walk_gps_ownership set fencing_epoch=fencing_epoch+1,expires_at=now(),ended_at=now(),updated_at=now()
    where walk_id=w.id;
  insert into public.walk_lifecycle_events(family_id,dog_id,walk_id,action,actor_user_id,original_assignee_user_id,current_assignee_user_id,actual_walker_user_id,details)
    values(w.family_id,w.dog_id,w.id,'gps_owner_changed',profile_id,coalesce(w.swap_original_user_id,w.responsible_user_id),w.responsible_user_id,w.actual_walker_user_id,
      jsonb_build_object('released',true,'fencing_epoch',owner.fencing_epoch+1,'device_auth_user_id',auth.uid()));
  return true;
end;
$$;
revoke all on function public.release_walk_gps_ownership_v11(uuid,bigint) from public, anon;
grant execute on function public.release_walk_gps_ownership_v11(uuid,bigint) to authenticated;

create or replace function public.heartbeat_walk_gps_ownership_v11(p_walk_id uuid,p_fencing_epoch bigint)
returns timestamptz
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare renewed timestamptz;
begin
  update public.walk_gps_ownership o set expires_at=now()+interval '45 seconds',updated_at=now()
  from public.walks w
  where o.walk_id=p_walk_id and o.fencing_epoch=p_fencing_epoch and o.owner_auth_user_id=auth.uid() and o.ended_at is null
    and o.expires_at>now() and o.family_id=public.current_family_id() and w.id=o.walk_id and w.status='in_progress' and w.duplicate_resolution_group_id is null
    and w.actual_walker_user_id=public.real_current_profile_id()
  returning o.expires_at into renewed;
  if renewed is null then raise exception 'GPS ownership expired or transferred'; end if;
  return renewed;
end;
$$;
revoke all on function public.heartbeat_walk_gps_ownership_v11(uuid,bigint) from public, anon;
grant execute on function public.heartbeat_walk_gps_ownership_v11(uuid,bigint) to authenticated;

create or replace function public.append_walk_gps_route_v11(
  p_walk_id uuid,p_fencing_epoch bigint,p_points jsonb,p_distance_meters numeric,p_point_count integer,p_started_at timestamptz default null,p_ended_at timestamptz default null
)
returns public.walk_gps_sessions
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  w public.walks;
  owner public.walk_gps_ownership;
  session public.walk_gps_sessions;
begin
  if jsonb_typeof(p_points)<>'array' or jsonb_array_length(p_points)>250 then raise exception 'invalid GPS point batch'; end if;
  if exists(
    select 1 from jsonb_array_elements(p_points) point
    where coalesce((point->>'latitude')::numeric,100) not between -90 and 90
      or coalesce((point->>'longitude')::numeric,200) not between -180 and 180
      or coalesce((point->>'timestamp')::bigint,0)<=0
  ) then raise exception 'invalid GPS coordinate'; end if;
  select * into w from public.walks where id=p_walk_id and family_id=public.current_family_id() and status='in_progress' and duplicate_resolution_group_id is null for update;
  if not found or w.actual_walker_user_id is distinct from public.real_current_profile_id() then raise exception 'active walk not found for current walker'; end if;
  select * into owner from public.walk_gps_ownership o where o.walk_id=w.id for update;
  if not found or owner.owner_auth_user_id is distinct from auth.uid() or owner.fencing_epoch is distinct from p_fencing_epoch or owner.expires_at<=now() or owner.ended_at is not null then
    raise exception 'GPS ownership expired or transferred';
  end if;
  insert into public.walk_gps_route_samples_v11(walk_id,family_id,dog_id,fencing_epoch,point_timestamp_ms,latitude,longitude,sampled_at)
    select w.id,w.family_id,w.dog_id,p_fencing_epoch,(point->>'timestamp')::bigint,
      (point->>'latitude')::double precision,(point->>'longitude')::double precision,
      to_timestamp((point->>'timestamp')::double precision/1000.0)
    from jsonb_array_elements(p_points) point
    on conflict(walk_id,point_timestamp_ms) do nothing;
  update public.walk_gps_ownership set
    distance_meters=greatest(distance_meters,greatest(0,coalesce(p_distance_meters,0))),
    point_count=greatest(point_count,greatest(0,coalesce(p_point_count,0))),
    route_started_at=coalesce(route_started_at,p_started_at,now()),
    route_ended_at=coalesce(p_ended_at,route_ended_at),updated_at=now()
  where walk_id=w.id returning * into owner;
  insert into public.walk_gps_sessions(walk_id,family_id,dog_id,distance_meters,point_count,route_points,started_at,created_by_user_id,source)
    values(w.id,w.family_id,w.dog_id,owner.distance_meters,owner.point_count,null,owner.route_started_at,public.real_current_profile_id(),'device_gps')
    on conflict(walk_id) do update set
      distance_meters=excluded.distance_meters,point_count=excluded.point_count,
      started_at=coalesce(walk_gps_sessions.started_at,excluded.started_at),ended_at=coalesce(p_ended_at,walk_gps_sessions.ended_at),updated_at=now()
    returning * into session;
  return session;
end;
$$;
revoke all on function public.append_walk_gps_route_v11(uuid,bigint,jsonb,numeric,integer,timestamptz,timestamptz) from public, anon;
grant execute on function public.append_walk_gps_route_v11(uuid,bigint,jsonb,numeric,integer,timestamptz,timestamptz) to authenticated;
