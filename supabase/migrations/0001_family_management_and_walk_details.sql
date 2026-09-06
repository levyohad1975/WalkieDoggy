-- ============================================================================
-- Migration 0001 — family management, walk details, photo storage.
-- Safe to run against an existing database seeded from supabase/schema.sql +
-- supabase/seed.sql: every change is additive or widens a constraint, and
-- nothing here deletes existing rows. Run this in the Supabase SQL editor
-- (or `supabase db push` if you use the CLI) AFTER the base schema exists.
--
-- What this migration does:
--   1. users.photo_url               — real profile photo (separate from the emoji avatar fallback)
--   2. schedule_rules.label          — optional friendly name for a time slot ("טיול בוקר")
--   3. schedule_rules.sort_order     — explicit display order for the family's daily time slots
--   4. walks.schedule_entry_id       — made nullable, to support unplanned/spontaneous walks
--   5. walks.had_pee / had_poop / note / duration_minutes / is_unplanned — walk detail fields
--   6. RLS policy fixes so a brand-new device can actually log in and sync
--      (see "auth bootstrap" section below — this is what makes the
--      multi-device shared-data requirement actually work; the original
--      schema's policies required a user to already be linked to Supabase
--      Auth before they could even read the family roster to log in, which
--      is a chicken-and-egg problem the app-side "pick your profile" login
--      never solved on its own).
--   7. A public "family-photos" Storage bucket + policies for dog/user photo uploads.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1-3. New columns
-- ----------------------------------------------------------------------------
alter table users add column if not exists photo_url text;

alter table schedule_rules add column if not exists label text;
alter table schedule_rules add column if not exists sort_order int not null default 0;

-- Backfill sort_order for any rules created before this migration, ordered by time.
with ranked as (
  select id, row_number() over (partition by family_id, dog_id order by time) - 1 as rn
  from schedule_rules
)
update schedule_rules
set sort_order = ranked.rn
from ranked
where schedule_rules.id = ranked.id and schedule_rules.sort_order = 0;

-- ----------------------------------------------------------------------------
-- 4-5. walks: nullable schedule_entry_id + new detail columns
-- ----------------------------------------------------------------------------
alter table walks alter column schedule_entry_id drop not null;

alter table walks add column if not exists had_pee boolean;
alter table walks add column if not exists had_poop boolean;
alter table walks add column if not exists note text;
alter table walks add column if not exists duration_minutes int;
alter table walks add column if not exists is_unplanned boolean not null default false;

-- ----------------------------------------------------------------------------
-- 6. RLS — auth bootstrap fix
--
-- The base schema scopes every table to `current_family_id()`, which is
-- resolved from `users.auth_user_id = auth.uid()`. That's correct once a
-- device is linked, but a brand-new device has no linked auth_user_id yet —
-- so it could never even SELECT the family roster to show the "pick your
-- profile" login screen. This app uses one Supabase project per family (see
-- README), so relaxing `families`/`users` reads to "any authenticated
-- caller" (including an anonymous Supabase Auth session) does not leak data
-- across families in practice — there IS only one family in this project.
-- The sensitive tables (dogs/schedule_rules/schedule_entries/walks/
-- notifications) keep the strict per-family policy unchanged.
--
-- App-side, this pairs with `ensureAnonymousSession()` /
-- `claimFamilyProfile()` in src/lib/supabase.ts: every device signs in
-- anonymously on launch (so `auth.uid()` exists), then "claims" the chosen
-- family member's row by setting its `auth_user_id` the first time someone
-- picks that profile.
-- ----------------------------------------------------------------------------

drop policy if exists "select own family" on families;
create policy "select family (any authenticated device)" on families
  for select using (auth.uid() is not null);

drop policy if exists "select users in own family" on users;
create policy "select users (any authenticated device)" on users
  for select using (auth.uid() is not null);

drop policy if exists "insert users in own family" on users;
create policy "insert users (any authenticated device)" on users
  for insert with check (auth.uid() is not null);

drop policy if exists "update users in own family" on users;
create policy "update users (self, unclaimed profile, or own family)" on users
  for update using (
    auth.uid() is not null
    and (auth_user_id is null or auth_user_id = auth.uid() or family_id = current_family_id())
  )
  with check (
    auth.uid() is not null
    and (auth_user_id is null or auth_user_id = auth.uid() or family_id = current_family_id())
  );

drop policy if exists "delete users (own family)" on users;
create policy "delete users (own family)" on users
  for delete using (family_id = current_family_id());

-- ----------------------------------------------------------------------------
-- 7. Storage bucket for dog/user photos
-- ----------------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('family-photos', 'family-photos', true)
on conflict (id) do nothing;

drop policy if exists "read family photos" on storage.objects;
create policy "read family photos" on storage.objects
  for select using (bucket_id = 'family-photos');

drop policy if exists "upload family photos" on storage.objects;
create policy "upload family photos" on storage.objects
  for insert with check (bucket_id = 'family-photos' and auth.uid() is not null);

drop policy if exists "update family photos" on storage.objects;
create policy "update family photos" on storage.objects
  for update using (bucket_id = 'family-photos' and auth.uid() is not null)
  with check (bucket_id = 'family-photos' and auth.uid() is not null);

drop policy if exists "delete family photos" on storage.objects;
create policy "delete family photos" on storage.objects
  for delete using (bucket_id = 'family-photos' and auth.uid() is not null);
