-- Verified per-dog home pin and isolated estimated route metadata.
-- Additive only: existing measured GPS route/session fields are never rewritten.
alter table public.dogs
  add column if not exists home_latitude double precision,
  add column if not exists home_longitude double precision,
  add column if not exists home_accuracy_meters double precision,
  add column if not exists home_verified_at timestamptz,
  add column if not exists home_verified_by_user_id uuid;

alter table public.walk_gps_sessions
  add column if not exists reconstruction jsonb;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'dogs_home_location_pair_check') then
    alter table public.dogs add constraint dogs_home_location_pair_check check (
      (home_latitude is null and home_longitude is null and home_accuracy_meters is null and home_verified_at is null and home_verified_by_user_id is null)
      or (home_latitude between -90 and 90 and home_longitude between -180 and 180
          and home_accuracy_meters between 0 and 25 and home_verified_at is not null and home_verified_by_user_id is not null)
    );
  end if;
end $$;

create or replace function public.guard_dog_home_location_admin_v1()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if tg_op = 'INSERT' then
    if new.home_latitude is not null or new.home_longitude is not null or new.home_verified_at is not null then
      if public.is_family_admin(new.family_id) is distinct from true then
        raise exception 'family admin required to verify dog home location';
      end if;
      if new.home_verified_by_user_id is distinct from public.real_current_profile_id() then
        raise exception 'home location verifier must be the current family profile';
      end if;
    end if;
  elsif old.home_verified_at is not null
        and new.home_latitude is null and new.home_longitude is null and new.home_verified_at is null then
    -- Older/offline dog objects can omit newly added fields. Preserve an
    -- already verified pin instead of letting an unrelated dog edit erase it.
    new.home_latitude := old.home_latitude;
    new.home_longitude := old.home_longitude;
    new.home_accuracy_meters := old.home_accuracy_meters;
    new.home_verified_at := old.home_verified_at;
    new.home_verified_by_user_id := old.home_verified_by_user_id;
  elsif row(new.home_latitude, new.home_longitude, new.home_accuracy_meters, new.home_verified_at, new.home_verified_by_user_id)
        is distinct from row(old.home_latitude, old.home_longitude, old.home_accuracy_meters, old.home_verified_at, old.home_verified_by_user_id) then
    if public.is_family_admin(new.family_id) is distinct from true then
      raise exception 'family admin required to change dog home location';
    end if;
    if new.home_verified_by_user_id is distinct from public.real_current_profile_id() then
      raise exception 'home location verifier must be the current family profile';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists dogs_home_location_admin_guard on public.dogs;
create trigger dogs_home_location_admin_guard
before insert or update on public.dogs
for each row execute function public.guard_dog_home_location_admin_v1();

revoke all on function public.guard_dog_home_location_admin_v1() from public, anon;

create or replace function public.save_walk_gps_reconstruction_v1(p_walk_id uuid, p_reconstruction jsonb)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare target public.walks;
declare source public.walks;
declare point jsonb;
declare source_walk_id uuid;
declare saved jsonb;
begin
  if auth.uid() is null or public.real_current_profile_id() is null then
    raise exception 'claimed family profile required';
  end if;
  if jsonb_typeof(p_reconstruction) is distinct from 'object'
     or jsonb_typeof(p_reconstruction->'routePoints') is distinct from 'array'
     or jsonb_array_length(p_reconstruction->'routePoints') < 2
     or jsonb_array_length(p_reconstruction->'routePoints') > 300
     or coalesce((p_reconstruction->>'distanceMeters')::numeric, 0) <= 0
     or coalesce((p_reconstruction->>'durationSeconds')::numeric, 0) <= 0
     or coalesce(p_reconstruction->>'confidence','') not in ('high','low') then
    raise exception 'invalid GPS reconstruction payload';
  end if;
  for point in select value from jsonb_array_elements(p_reconstruction->'routePoints') loop
    if coalesce((point->>'latitude')::numeric, 100) not between -90 and 90
       or coalesce((point->>'longitude')::numeric, 200) not between -180 and 180
       or coalesce((point->>'timestamp')::bigint, -1) <> 0 then
      raise exception 'invalid estimated route point';
    end if;
  end loop;
  source_walk_id := (p_reconstruction->>'sourceWalkId')::uuid;
  select * into target from public.walks w
    where w.id = p_walk_id and w.family_id = public.current_family_id()
      and w.status in ('in_progress','done') and w.duplicate_resolution_group_id is null
      and coalesce(w.actual_walker_user_id,w.responsible_user_id) = public.real_current_profile_id();
  if not found then raise exception 'active/completed walk not found for current walker'; end if;
  select * into source from public.walks w
    where w.id = source_walk_id and w.family_id = target.family_id
      and w.dog_id = target.dog_id and w.status = 'done' and w.duplicate_resolution_group_id is null;
  if not found or not exists (
    select 1 from public.dogs d where d.id = target.dog_id and d.family_id = target.family_id
      and d.home_verified_at is not null and d.home_verified_by_user_id is not null
  ) then raise exception 'verified home and completed same-dog source walk required'; end if;
  if not exists (
    select 1 from public.walk_gps_sessions s where s.walk_id = source.id and s.ended_at is not null
      and (jsonb_array_length(coalesce(s.route_points,'[]'::jsonb)) >= 5
        or (select count(*) from public.walk_gps_route_samples_v11 p where p.walk_id = source.id) >= 5)
  ) and not exists (
    select 1 from public.walk_gps_ownership o where o.walk_id = source.id and o.route_ended_at is not null
      and (select count(*) from public.walk_gps_route_samples_v11 p where p.walk_id = source.id) >= 5
  ) then raise exception 'completed source route is not available'; end if;

  insert into public.walk_gps_sessions(walk_id,family_id,dog_id,distance_meters,point_count,route_points,source,created_by_user_id,reconstruction)
    values(target.id,target.family_id,target.dog_id,null,0,null,'device_gps',public.real_current_profile_id(),p_reconstruction)
    on conflict(walk_id) do update set reconstruction = coalesce(public.walk_gps_sessions.reconstruction, excluded.reconstruction);
  select reconstruction into saved from public.walk_gps_sessions where walk_id = target.id;
  if saved is distinct from p_reconstruction then raise exception 'a different GPS reconstruction is already saved'; end if;
end;
$$;
revoke all on function public.save_walk_gps_reconstruction_v1(uuid,jsonb) from public, anon;
grant execute on function public.save_walk_gps_reconstruction_v1(uuid,jsonb) to authenticated;
