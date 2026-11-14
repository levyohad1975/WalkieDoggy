-- Reserve the System Admin's original claimed profile while their auth identity
-- is temporarily attached to an isolated QA family. This reservation is
-- enforced on the database write paths used by profile claims and sessions.
-- Additive and retry-safe; no hosted environment is changed by this file.

create table if not exists public.family_profile_reservations (
  profile_id uuid primary key references public.users(id),
  auth_user_id uuid not null unique references auth.users(id),
  family_id uuid not null references public.families(id),
  role text not null check (role in ('admin', 'member')),
  reserved_at timestamptz not null default now(),
  constraint family_profile_reservations_snapshot_fk
    foreign key (auth_user_id) references public.family_membership_snapshots(auth_user_id)
    deferrable initially deferred
);

alter table public.family_profile_reservations enable row level security;
revoke all on public.family_profile_reservations from public, anon, authenticated;
comment on table public.family_profile_reservations is
  'Private server-enforced claim fence for an original family profile while a verified System Admin is switched into a QA family.';

-- Preserve active reservations if this additive migration is re-run after a
-- partial deployment. Fail closed if existing snapshots conflict.
do $$
begin
  if exists (
    select 1
    from public.family_membership_snapshots s
    join public.users u on u.id = s.claimed_user_id
    left join public.family_profile_reservations r on r.auth_user_id = s.auth_user_id
    where s.claimed_user_id is not null
      and (u.family_id is distinct from s.family_id
        or (r.auth_user_id is not null and (r.profile_id is distinct from s.claimed_user_id
          or r.family_id is distinct from s.family_id or r.role is distinct from s.role)))
  ) then
    raise exception 'family profile reservation backfill found inconsistent active snapshots';
  end if;
  if exists (
    select 1
    from public.family_membership_snapshots s
    join public.users u on u.id = s.claimed_user_id
    where s.claimed_user_id is not null
      and u.auth_user_id is not null
      and u.auth_user_id is distinct from s.auth_user_id
  ) then
    raise exception 'family profile reservation backfill found a profile already claimed by another auth identity';
  end if;
end;
$$;

insert into public.family_profile_reservations(profile_id, auth_user_id, family_id, role)
select s.claimed_user_id, s.auth_user_id, s.family_id, s.role
from public.family_membership_snapshots s
join public.users u on u.id = s.claimed_user_id and u.family_id = s.family_id
where s.claimed_user_id is not null
on conflict (auth_user_id) do nothing;

create or replace function public.reserve_system_admin_snapshot_profile()
returns trigger
language plpgsql security definer
set search_path = public, auth
as $$
declare
  v_profile_family uuid;
  v_removed_at timestamptz;
begin
  if new.claimed_user_id is null then return new; end if;

  -- Match the snapshot to the authenticated owner and lock the target row
  -- before inserting the reservation. This serializes against concurrent
  -- PIN/plain claims, which lock the same users row before updating it.
  if new.auth_user_id is distinct from auth.uid() or not public.is_system_admin() then
    raise exception 'only the verified System Admin may reserve its active profile';
  end if;
  select u.family_id, u.removed_at
    into v_profile_family, v_removed_at
  from public.users u
  where u.id = new.claimed_user_id
  for update;
  if v_profile_family is distinct from new.family_id or v_removed_at is not null then
    raise exception 'original profile changed before it could be reserved';
  end if;
  if not exists (
    select 1 from public.family_auth_members m
    where m.auth_user_id = new.auth_user_id and m.family_id = new.family_id and m.role = new.role
  ) then raise exception 'original family membership changed before it could be reserved'; end if;

  insert into public.family_profile_reservations(profile_id, auth_user_id, family_id, role)
  values (new.claimed_user_id, new.auth_user_id, new.family_id, new.role);
  return new;
end;
$$;
revoke all on function public.reserve_system_admin_snapshot_profile() from public, anon, authenticated;
drop trigger if exists family_membership_snapshot_reserve_profile on public.family_membership_snapshots;
create trigger family_membership_snapshot_reserve_profile
before insert on public.family_membership_snapshots
for each row execute function public.reserve_system_admin_snapshot_profile();

create or replace function public.prevent_system_admin_snapshot_mutation()
returns trigger
language plpgsql security definer
set search_path = public, auth
as $$
begin
  raise exception 'active System Admin family snapshot is immutable';
end;
$$;
revoke all on function public.prevent_system_admin_snapshot_mutation() from public, anon, authenticated;
drop trigger if exists family_membership_snapshot_immutable on public.family_membership_snapshots;
create trigger family_membership_snapshot_immutable
before update on public.family_membership_snapshots
for each row execute function public.prevent_system_admin_snapshot_mutation();

create or replace function public.release_system_admin_snapshot_profile_reservation()
returns trigger
language plpgsql security definer
set search_path = public, auth
as $$
begin
  if auth.uid() is distinct from old.auth_user_id then
    raise exception 'only the snapshot owner may release its profile reservation';
  end if;
  -- Exit RPC deletes the snapshot only after it restored the original family,
  -- role, profile_auth_sessions row and legacy auth_user_id pointer. Requiring
  -- those postconditions makes a failed/partial restore keep its reservation.
  if old.claimed_user_id is not null and exists (
    select 1
    from public.family_profile_reservations r
    where r.auth_user_id = old.auth_user_id and r.profile_id = old.claimed_user_id
  ) then
    if not exists (
      select 1 from public.family_auth_members m
      where m.auth_user_id = old.auth_user_id and m.family_id = old.family_id and m.role = old.role
    ) or not exists (
      select 1 from public.users u
      where u.id = old.claimed_user_id and u.family_id = old.family_id and u.removed_at is null
        and u.auth_user_id = old.auth_user_id
    ) or not exists (
      select 1 from public.profile_auth_sessions s
      where s.auth_user_id = old.auth_user_id and s.family_id = old.family_id and s.user_id = old.claimed_user_id
    ) then
      raise exception 'original profile restoration is incomplete; reservation retained';
    end if;
  end if;
  delete from public.family_profile_reservations r
  where r.auth_user_id = old.auth_user_id;
  return old;
end;
$$;
revoke all on function public.release_system_admin_snapshot_profile_reservation() from public, anon, authenticated;
drop trigger if exists family_membership_snapshot_release_profile on public.family_membership_snapshots;
create trigger family_membership_snapshot_release_profile
before delete on public.family_membership_snapshots
for each row execute function public.release_system_admin_snapshot_profile_reservation();

create or replace function public.enforce_reserved_profile_claim()
returns trigger
language plpgsql security definer
set search_path = public, auth
as $$
declare
  v_owner uuid;
  v_family uuid;
  v_profile uuid;
begin
  if tg_op = 'DELETE' then
    select r.auth_user_id into v_owner
    from public.family_profile_reservations r where r.profile_id = old.id;
    if v_owner is not null then raise exception 'profile is reserved during System Admin QA'; end if;
    return old;
  end if;
  if tg_op = 'UPDATE' then
    select r.auth_user_id, r.family_id, r.profile_id into v_owner, v_family, v_profile
    from public.family_profile_reservations r where r.profile_id = old.id;
    if v_owner is not null then
      if new.id is distinct from v_profile then
        raise exception 'reserved profile identity cannot be reassigned';
      end if;
      if (new.auth_user_id is distinct from old.auth_user_id
          or new.family_id is distinct from old.family_id)
         and auth.uid() is distinct from v_owner then
        raise exception 'profile is reserved during System Admin QA';
      end if;
      if new.family_id is distinct from v_family then
        raise exception 'reserved profile family cannot be reassigned';
      end if;
      if new.auth_user_id is not null and new.auth_user_id is distinct from v_owner then
        raise exception 'profile is reserved during System Admin QA';
      end if;
    end if;
  end if;
  return new;
end;
$$;
revoke all on function public.enforce_reserved_profile_claim() from public, anon, authenticated;
drop trigger if exists users_reserved_profile_claim_guard on public.users;
create trigger users_reserved_profile_claim_guard
before update of id, auth_user_id, family_id or delete on public.users
for each row execute function public.enforce_reserved_profile_claim();

create or replace function public.enforce_reserved_profile_session()
returns trigger
language plpgsql security definer
set search_path = public, auth
as $$
declare
  v_owner uuid;
  v_old_owner uuid;
  v_family uuid;
  v_profile uuid;
  v_locked_profile uuid;
begin
  if tg_op = 'DELETE' then
    select u.id into v_locked_profile from public.users u where u.id = old.user_id for update;
    select r.auth_user_id into v_owner
    from public.family_profile_reservations r where r.profile_id = old.user_id;
    if v_owner is not null and (old.auth_user_id is distinct from v_owner or auth.uid() is distinct from v_owner) then
      raise exception 'profile is reserved during System Admin QA';
    end if;
    return old;
  end if;

  if tg_op = 'UPDATE' then
    select u.id into v_locked_profile from public.users u where u.id = old.user_id for update;
    select r.auth_user_id into v_old_owner
    from public.family_profile_reservations r where r.profile_id = old.user_id;
    if v_old_owner is not null and (auth.uid() is distinct from v_old_owner
        or new.user_id is distinct from old.user_id or new.auth_user_id is distinct from v_old_owner) then
      raise exception 'reserved profile session cannot be reassigned';
    end if;
  end if;

  -- Serialize direct session inserts/updates with reservation creation, even
  -- when the caller bypasses every supported RPC and writes the table itself.
  select u.id into v_locked_profile from public.users u where u.id = new.user_id for update;
  select r.auth_user_id, r.family_id, r.profile_id into v_owner, v_family, v_profile
  from public.family_profile_reservations r where r.profile_id = new.user_id;
  if v_owner is not null and (auth.uid() is distinct from v_owner or new.auth_user_id is distinct from v_owner
      or new.family_id is distinct from v_family or new.user_id is distinct from v_profile) then
    raise exception 'profile is reserved during System Admin QA';
  end if;
  return new;
end;
$$;
revoke all on function public.enforce_reserved_profile_session() from public, anon, authenticated;
drop trigger if exists profile_sessions_reserved_profile_guard on public.profile_auth_sessions;
create trigger profile_sessions_reserved_profile_guard
before insert or update or delete on public.profile_auth_sessions
for each row execute function public.enforce_reserved_profile_session();

-- Safe rollback: only after all family_membership_snapshots rows are restored
-- and removed. Dropping this migration while snapshots remain would remove an
-- active security fence; do not use a blind down migration.
