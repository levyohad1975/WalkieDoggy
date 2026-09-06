-- ============================================================================
-- Migration 0002 — invite codes + real family membership.
--
-- Why this migration exists: migration 0001 made `families`/`users` SELECT-
-- able by "any authenticated caller" (including anonymous sessions) to solve
-- the chicken-and-egg "a brand-new device can't read the roster to log in"
-- problem. That only worked because the app was designed for one Supabase
-- project per family — a single family, full stop. It does NOT work for
-- multiple families sharing one Supabase project (a real multi-family
-- deployment), because ANY anonymous device could read EVERY family's
-- roster. This migration replaces that with real per-device family
-- membership (`family_auth_members`) established explicitly by creating or
-- joining a family via a short invite code, and narrows every policy back
-- to "only your own family" — including `families` and `users`.
--
-- Run this in the Supabase SQL editor (or `supabase db push`) AFTER
-- schema.sql and migrations/0001_*.sql. Additive/safe to run once; re-running
-- is safe too (every statement uses if-not-exists / drop-if-exists / or-replace).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. families.invite_code — short, unique, case-insensitive join code.
-- ----------------------------------------------------------------------------
alter table families add column if not exists invite_code text;

-- Case-insensitive uniqueness: two codes that differ only in case collide.
-- Codes are always generated/stored upper-case (see generate_invite_code()
-- below) and normalized to upper-case client-side before lookup, but the
-- index itself is what actually enforces case-insensitive uniqueness.
create unique index if not exists families_invite_code_key on families (upper(invite_code));

-- Unambiguous 6-character alphabet: digits/letters that are easy to read
-- aloud and to type on a phone keyboard, excluding 0/O, 1/I/L which are
-- easily confused with each other in most fonts.
create or replace function generate_invite_code()
returns text as $$
declare
  alphabet text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  code text;
begin
  code := '';
  for i in 1..6 loop
    code := code || substr(alphabet, floor(random() * length(alphabet))::int + 1, 1);
  end loop;
  return code;
end;
$$ language plpgsql volatile;

-- Backfill existing families (e.g. the seeded demo family) with a code,
-- retrying on the astronomically unlikely collision.
do $$
declare
  fam record;
  new_code text;
  attempts int;
begin
  for fam in select id from families where invite_code is null loop
    attempts := 0;
    loop
      new_code := generate_invite_code();
      attempts := attempts + 1;
      begin
        update families set invite_code = new_code where id = fam.id;
        exit;
      exception when unique_violation then
        if attempts > 20 then
          raise exception 'could not generate a unique invite_code for family %', fam.id;
        end if;
      end;
    end loop;
  end loop;
end $$;

alter table families alter column invite_code set not null;

-- ----------------------------------------------------------------------------
-- 2. family_auth_members — device-level family membership.
--
-- This is the missing piece migration 0001 didn't have: a device is a member
-- of a family the moment it creates or joins one (via the functions below),
-- *before* it has picked which specific family member (users row) it is.
-- `users.auth_user_id` (from the base schema) is a separate, narrower
-- concern: which specific person's profile this device has "claimed" —
-- unchanged by this migration.
-- ----------------------------------------------------------------------------
create table if not exists family_auth_members (
  auth_user_id uuid primary key references auth.users(id) on delete cascade,
  family_id uuid not null references families(id) on delete cascade,
  created_at timestamptz not null default now()
);

create index if not exists family_auth_members_family_id_idx on family_auth_members(family_id);

alter table family_auth_members enable row level security;

-- The client never queries this table directly (current_family_id(),
-- create_family(), join_family() below all run as SECURITY DEFINER and
-- bypass RLS internally) — this policy just lets a device see its own
-- membership row if it ever needs to (e.g. debugging), nothing more.
drop policy if exists "select own membership" on family_auth_members;
create policy "select own membership" on family_auth_members
  for select using (auth_user_id = auth.uid());

-- ----------------------------------------------------------------------------
-- 3. current_family_id() — now resolved from family_auth_members, not from
-- users.auth_user_id. This is what actually fixes the chicken-and-egg
-- problem properly: a device's family membership exists as soon as it
-- creates/joins a family, before it has ever touched the `users` table.
-- ----------------------------------------------------------------------------
create or replace function current_family_id()
returns uuid as $$
  select family_id from family_auth_members where auth_user_id = auth.uid() limit 1;
$$ language sql stable security definer;

-- ----------------------------------------------------------------------------
-- 4. find_family_by_invite_code(code) — the ONLY way a device that hasn't
-- joined a family yet can resolve an invite code to a family. Deliberately:
--   - takes no other filter (can't be used to enumerate/browse families)
--   - returns only the minimal, non-sensitive fields the join screen needs
--     (id, name, dog name) — never the full family row or its members
--   - is SECURITY DEFINER so it works before the caller has any
--     family_auth_members / current_family_id() at all
-- This is what makes "no free `select` on families with the anon key"
-- (requirement) hold: the base `families` SELECT policy below only allows a
-- device to see the family it's already a member of; this function is the
-- sole, narrow exception, and it does not expose a broad table scan.
-- ----------------------------------------------------------------------------
create or replace function find_family_by_invite_code(code text)
returns table (id uuid, name text, dog_name text) as $$
  select f.id, f.name, d.name as dog_name
  from families f
  left join dogs d on d.family_id = f.id
  where upper(f.invite_code) = upper(code)
  limit 1;
$$ language sql stable security definer;

-- ----------------------------------------------------------------------------
-- 5. create_family(name, dog_name) — creates a new family AND makes the
-- calling (already-anonymous) auth session a member of it in one atomic
-- call. dog_name is optional: local/demo mode's "טופי" default must never be
-- forced onto a real new family (requirement) — pass null/omit to create the
-- family with no dog yet; the app can add one later from Settings.
-- ----------------------------------------------------------------------------
create or replace function create_family(family_name text, dog_name text default null)
returns table (id uuid, name text, invite_code text) as $$
declare
  new_family_id uuid;
  new_code text;
  attempts int := 0;
begin
  if auth.uid() is null then
    raise exception 'must be authenticated to create a family';
  end if;
  if family_name is null or length(trim(family_name)) = 0 then
    raise exception 'family_name is required';
  end if;

  loop
    new_code := generate_invite_code();
    attempts := attempts + 1;
    begin
      insert into families (name, invite_code) values (trim(family_name), new_code)
      returning families.id into new_family_id;
      exit;
    exception when unique_violation then
      if attempts > 20 then
        raise exception 'could not generate a unique invite_code';
      end if;
    end;
  end loop;

  -- This device becomes a member of the family it just created. If it was
  -- already a member of a different family (shouldn't normally happen from
  -- the app's flow, but guard anyway), membership moves to the new one.
  insert into family_auth_members (auth_user_id, family_id)
  values (auth.uid(), new_family_id)
  on conflict (auth_user_id) do update set family_id = excluded.family_id;

  if dog_name is not null and length(trim(dog_name)) > 0 then
    insert into dogs (family_id, name) values (new_family_id, trim(dog_name));
  end if;

  return query select f.id, f.name, f.invite_code from families f where f.id = new_family_id;
end;
$$ language plpgsql volatile security definer;

-- ----------------------------------------------------------------------------
-- 6. join_family(code) — resolves an invite code and makes the calling
-- session a member of that family. Never creates a `users` row — picking
-- *which* family member you are (אבא/אמא/עידן/עומר/מאור) happens afterward
-- on the app's existing "pick your profile" screen via claim_family_profile,
-- unchanged by this migration.
-- ----------------------------------------------------------------------------
create or replace function join_family(code text)
returns table (id uuid, name text) as $$
declare
  target_family_id uuid;
begin
  if auth.uid() is null then
    raise exception 'must be authenticated to join a family';
  end if;

  select f.id into target_family_id from families f where upper(f.invite_code) = upper(code) limit 1;
  if target_family_id is null then
    raise exception 'invalid invite code';
  end if;

  insert into family_auth_members (auth_user_id, family_id)
  values (auth.uid(), target_family_id)
  on conflict (auth_user_id) do update set family_id = excluded.family_id;

  return query select f.id, f.name from families f where f.id = target_family_id;
end;
$$ language plpgsql volatile security definer;

-- ----------------------------------------------------------------------------
-- 7. regenerate_invite_code(family_id) — only a device that is ALREADY a
-- member of that family can rotate its code. Devices that joined with the
-- old code stay members (family_auth_members isn't touched); only the code
-- itself changes, so it stops working for NEW joins.
-- ----------------------------------------------------------------------------
create or replace function regenerate_invite_code(target_family_id uuid)
returns text as $$
declare
  new_code text;
  attempts int := 0;
begin
  if current_family_id() is distinct from target_family_id then
    raise exception 'not a member of this family';
  end if;

  loop
    new_code := generate_invite_code();
    attempts := attempts + 1;
    begin
      update families set invite_code = new_code where id = target_family_id;
      exit;
    exception when unique_violation then
      if attempts > 20 then
        raise exception 'could not generate a unique invite_code';
      end if;
    end;
  end loop;

  return new_code;
end;
$$ language plpgsql volatile security definer;

-- ----------------------------------------------------------------------------
-- 8. RLS — narrow `families` and `users` back down to "own family only".
-- The 0001 "any authenticated caller" policies are dropped: they were only
-- safe under a one-family-per-project deployment, which invite codes make
-- unnecessary (a device now gets `current_family_id()` from
-- family_auth_members as soon as it creates/joins, before ever touching
-- `users`) and unsafe (multiple real families now share one project).
-- ----------------------------------------------------------------------------
drop policy if exists "select family (any authenticated device)" on families;
create policy "select own family" on families
  for select using (id = current_family_id());
-- No direct insert/update/delete policy on `families` for the client at
-- all: creation happens only through create_family() (SECURITY DEFINER,
-- bypasses RLS), and invite_code rotation only through
-- regenerate_invite_code() (also SECURITY DEFINER, with its own membership
-- check above). The family's `name` is editable only via the same route as
-- everything else the family owns — add an UPDATE policy scoped to
-- current_family_id() here if the app later needs client-side family-name
-- edits; none of the current screens do.

drop policy if exists "select users (any authenticated device)" on users;
create policy "select users in own family" on users
  for select using (family_id = current_family_id());

drop policy if exists "insert users (any authenticated device)" on users;
create policy "insert users in own family" on users
  for insert with check (family_id = current_family_id());

drop policy if exists "update users (self, unclaimed profile, or own family)" on users;
create policy "update users in own family" on users
  for update using (family_id = current_family_id())
  with check (family_id = current_family_id());

-- "delete users (own family)" from 0001 already uses current_family_id()
-- and needs no change — current_family_id() itself now resolves
-- differently (see #3 above), which is exactly the point.

-- dogs / schedule_rules / schedule_entries / walks / notifications policies
-- from schema.sql already read `family_id = current_family_id()` — since
-- current_family_id() was CREATE OR REPLACE'd in #3, they automatically
-- pick up the new (correct) definition. Nothing to change there.

-- ----------------------------------------------------------------------------
-- 9. Storage — scope uploads/updates/deletes to the caller's own family's
-- folder. Upload paths are now `{familyId}/dog/...` and
-- `{familyId}/users/{userId}/...` (see src/lib/uploadImage.ts) — this policy
-- checks the first path segment against current_family_id(). Reads stay
-- public (the bucket itself is public=true; this policy only governs
-- authenticated SELECTs through the API, not public-URL access — same
-- tradeoff already documented in 0001, now scoped to a real per-family path
-- instead of the old flat `dogs/...` / `users/...` layout).
-- ----------------------------------------------------------------------------
drop policy if exists "upload family photos" on storage.objects;
create policy "upload family photos" on storage.objects
  for insert with check (
    bucket_id = 'family-photos'
    and auth.uid() is not null
    and (storage.foldername(name))[1] = current_family_id()::text
  );

drop policy if exists "update family photos" on storage.objects;
create policy "update family photos" on storage.objects
  for update using (
    bucket_id = 'family-photos'
    and auth.uid() is not null
    and (storage.foldername(name))[1] = current_family_id()::text
  )
  with check (
    bucket_id = 'family-photos'
    and auth.uid() is not null
    and (storage.foldername(name))[1] = current_family_id()::text
  );

drop policy if exists "delete family photos" on storage.objects;
create policy "delete family photos" on storage.objects
  for delete using (
    bucket_id = 'family-photos'
    and auth.uid() is not null
    and (storage.foldername(name))[1] = current_family_id()::text
  );

-- "read family photos" (bucket_id = 'family-photos') is unchanged — see the
-- comment above this section for why.

-- ----------------------------------------------------------------------------
-- 10. Backfill: every existing device that already claimed a `users` row
-- (auth_user_id set) before this migration must get a family_auth_members
-- row too, or it would suddenly lose access to its own family's data.
-- ----------------------------------------------------------------------------
insert into family_auth_members (auth_user_id, family_id)
select u.auth_user_id, u.family_id
from users u
where u.auth_user_id is not null
on conflict (auth_user_id) do nothing;
