-- Preserve every pee/poop event recorded while a walk is in progress.
-- Additive and safe for rolling deploys: legacy clients continue using the
-- existing boolean-only finish RPC, while count-aware clients use v12.

alter table public.walks add column if not exists pee_count integer;
alter table public.walks add column if not exists poop_count integer;

do $$
begin
  if not exists (select 1 from pg_constraint where conrelid = 'public.walks'::regclass and conname = 'walks_pee_count_nonnegative') then
    alter table public.walks add constraint walks_pee_count_nonnegative check (pee_count is null or pee_count >= 0);
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.walks'::regclass and conname = 'walks_poop_count_nonnegative') then
    alter table public.walks add constraint walks_poop_count_nonnegative check (poop_count is null or poop_count >= 0);
  end if;
end;
$$;

-- Historical walks only stored yes/no flags. Backfill them as 0/1, preserving
-- the legacy interpretation while leaving scheduled and active rows unknown.
update public.walks
set pee_count = case when had_pee is true then 1 else 0 end,
    poop_count = case when had_poop is true then 1 else 0 end
where status in ('done', 'skipped') and (pee_count is null or poop_count is null);

create or replace function public.finish_walk_v12(
  p_walk_id uuid,
  p_actual_walker_id uuid,
  p_expected_actor_id uuid,
  p_operation_id uuid,
  p_had_pee boolean default null,
  p_had_poop boolean default null,
  p_note text default null,
  p_completed_at timestamptz default null,
  p_remote_confirmation boolean default false,
  p_pee_count integer default null,
  p_poop_count integer default null
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
  completed_ts timestamptz;
begin
  if auth.uid() is null or actor is null then raise exception 'active profile required'; end if;
  if p_expected_actor_id is distinct from actor then raise exception 'profile changed; lifecycle action must be reviewed by the current member'; end if;
  if p_operation_id is null then raise exception 'operation id required'; end if;
  if p_pee_count is not null and p_pee_count < 0 then raise exception 'pee count cannot be negative'; end if;
  if p_poop_count is not null and p_poop_count < 0 then raise exception 'poop count cannot be negative'; end if;
  if p_pee_count is not null and p_had_pee is distinct from (p_pee_count > 0) then raise exception 'pee count and flag do not match'; end if;
  if p_poop_count is not null and p_had_poop is distinct from (p_poop_count > 0) then raise exception 'poop count and flag do not match'; end if;

  select * into w from public.walks where id=p_walk_id and family_id=public.current_family_id() for update;
  if not found then raise exception 'walk not found'; end if;
  walker:=coalesce(w.actual_walker_user_id,w.responsible_user_id);
  request_payload:=jsonb_build_object(
    'actual_walker_id',p_actual_walker_id,
    'had_pee',p_had_pee,
    'had_poop',p_had_poop,
    'pee_count',p_pee_count,
    'poop_count',p_poop_count,
    'note',p_note,
    'completed_at',p_completed_at,
    'remote_confirmation',p_remote_confirmation
  );
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
  if p_completed_at is not null then
    if p_completed_at > now() + interval '15 minutes' then raise exception 'completion time cannot be in the future'; end if;
    if w.started_at is not null and p_completed_at < w.started_at - interval '7 days' then raise exception 'completion time is too far before the walk started'; end if;
  end if;
  completed_ts:=least(coalesce(p_completed_at,now()),now());
  perform set_config('app.trusted_write','on',true);
  update public.walks set
    status='done',
    completed_at=completed_ts,
    completed_by_user_id=p_actual_walker_id,
    ended_by_user_id=actor,
    had_pee=case when p_pee_count is not null then p_pee_count > 0 else p_had_pee end,
    had_poop=case when p_poop_count is not null then p_poop_count > 0 else p_had_poop end,
    pee_count=p_pee_count,
    poop_count=p_poop_count,
    note=p_note,
    duration_minutes=greatest(0,round(extract(epoch from (completed_ts-started_at))/60.0)::int),
    updated_at=now()
  where id=w.id returning * into w;
  update public.walk_gps_ownership set fencing_epoch=fencing_epoch+1,ended_at=now(),expires_at=now(),updated_at=now() where walk_id=w.id and ended_at is null;
  event_action:=case when actor <> walker then 'remotely_finished' else 'finished' end;
  insert into public.walk_lifecycle_events(family_id,dog_id,walk_id,action,actor_user_id,original_assignee_user_id,current_assignee_user_id,actual_walker_user_id,operation_id)
    values(w.family_id,w.dog_id,w.id,event_action,actor,coalesce(w.swap_original_user_id,w.responsible_user_id),w.responsible_user_id,p_actual_walker_id,p_operation_id);
  if event_action='remotely_finished' then
    insert into public.walk_lifecycle_notifications(family_id,walk_id,recipient_user_id,actor_user_id,kind)
      values(w.family_id,w.id,p_actual_walker_id,actor,'remote_finish');
  end if;
  return w;
end;
$$;
revoke all on function public.finish_walk_v12(uuid,uuid,uuid,uuid,boolean,boolean,text,timestamptz,boolean,integer,integer) from public, anon;
grant execute on function public.finish_walk_v12(uuid,uuid,uuid,uuid,boolean,boolean,text,timestamptz,boolean,integer,integer) to authenticated;

-- The existing read-only probe now also verifies the new RPC and columns.
create or replace function public.walk_lifecycle_server_capabilities()
returns jsonb
language plpgsql
stable
security invoker
set search_path = pg_catalog, public
as $$
declare
  required_functions text[] := array[
    'public.start_walk_v11(uuid,uuid,uuid,uuid,boolean,boolean)',
    'public.start_spontaneous_walk_v11(uuid,uuid,uuid,date,text,uuid,uuid)',
    'public.finish_walk_v11(uuid,uuid,uuid,uuid,boolean,boolean,text,timestamptz,boolean)',
    'public.finish_walk_v12(uuid,uuid,uuid,uuid,boolean,boolean,text,timestamptz,boolean,integer,integer)',
    'public.acquire_walk_gps_ownership_v11(uuid,boolean)',
    'public.heartbeat_walk_gps_ownership_v11(uuid,bigint)',
    'public.release_walk_gps_ownership_v11(uuid,bigint)',
    'public.append_walk_gps_route_v11(uuid,bigint,jsonb,numeric,integer,timestamptz,timestamptz)',
    'public.claim_walk_lifecycle_notifications_v11(uuid)',
    'public.finish_walk_lifecycle_notification_delivery_v11(uuid[],boolean,text)',
    'public.acknowledge_walk_lifecycle_notifications_v11(uuid[])'
  ];
  required_tables text[] := array[
    'public.walk_lifecycle_events',
    'public.walk_gps_ownership',
    'public.walk_gps_route_samples_v11',
    'public.walk_lifecycle_notifications'
  ];
  missing text[] := '{}';
  signature text;
  fn regprocedure;
  rel regclass;
begin
  foreach signature in array required_functions loop
    fn := to_regprocedure(signature);
    if fn is null then
      missing := missing || ('function:' || signature);
    elsif not has_function_privilege(fn, 'execute') then
      missing := missing || ('execute:' || signature);
    end if;
  end loop;
  foreach signature in array required_tables loop
    rel := to_regclass(signature);
    if rel is null then
      missing := missing || ('table:' || signature);
    elsif not has_table_privilege(rel, 'select') then
      missing := missing || ('select:' || signature);
    end if;
  end loop;
  if not exists (select 1 from pg_attribute where attrelid='public.walks'::regclass and attname='actual_walker_user_id' and not attisdropped) then missing := missing || 'column:public.walks.actual_walker_user_id'; end if;
  if not exists (select 1 from pg_attribute where attrelid='public.walks'::regclass and attname='duplicate_resolution_group_id' and not attisdropped) then missing := missing || 'column:public.walks.duplicate_resolution_group_id'; end if;
  if not exists (select 1 from pg_attribute where attrelid='public.walks'::regclass and attname='pee_count' and not attisdropped) then missing := missing || 'column:public.walks.pee_count'; end if;
  if not exists (select 1 from pg_attribute where attrelid='public.walks'::regclass and attname='poop_count' and not attisdropped) then missing := missing || 'column:public.walks.poop_count'; end if;
  if to_regclass('public.walks_one_active_per_dog_uidx') is null then missing := missing || 'index:public.walks_one_active_per_dog_uidx'; end if;
  return jsonb_build_object('lifecycle_version','1.1','missing',to_jsonb(missing));
end;
$$;
revoke all on function public.walk_lifecycle_server_capabilities() from public, anon;
grant execute on function public.walk_lifecycle_server_capabilities() to authenticated;

comment on function public.finish_walk_v12(uuid,uuid,uuid,uuid,boolean,boolean,text,timestamptz,boolean,integer,integer) is
  'Walk Lifecycle v1.2 completion: atomically records pee/poop event counts with the idempotent lifecycle finish and GPS lease closure.';
