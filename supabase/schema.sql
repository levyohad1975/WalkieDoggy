-- ============================================================================
-- Dog Walk Family — Supabase schema
-- Run this in the Supabase SQL editor (or via `supabase db push`) for a
-- brand-new project. If you already ran an older version of this file,
-- apply supabase/migrations/*.sql in order instead — this file always
-- reflects the current/target schema, not an incremental diff.
-- Requires the pgcrypto extension for gen_random_uuid().
-- ============================================================================

create extension if not exists pgcrypto;

-- ----------------------------------------------------------------------------
-- families
-- ----------------------------------------------------------------------------
create table if not exists families (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  -- Short, unique, case-insensitive join code (see the unique index below
  -- and generate_invite_code() further down) — this is how a second/third
  -- device joins this exact family instead of creating its own.
  invite_code text not null,
  created_at timestamptz not null default now()
);

create unique index if not exists families_invite_code_key on families (upper(invite_code));

-- ----------------------------------------------------------------------------
-- users
-- One row per family member. `auth_user_id` links to Supabase Auth's
-- `auth.users` — every device signs in anonymously on launch and "claims"
-- the family member it picks on the login screen by setting this column
-- (see src/lib/supabase.ts: ensureAnonymousSession / claimFamilyProfile).
-- ----------------------------------------------------------------------------
create table if not exists users (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references families(id) on delete cascade,
  auth_user_id uuid references auth.users(id) on delete set null,
  name text not null,
  avatar text not null default '🙂',
  photo_url text,
  color text not null default '#5B8DEF',
  reminders_enabled boolean not null default true,
  -- Soft-delete marker for "removing" a family member. Never actually
  -- deleted: schedule_entries.responsible_user_id and
  -- walks.responsible_user_id are `on delete restrict` specifically so a
  -- member with any history can never be hard-deleted out from under it.
  -- See admin_delete_family_member() further down and
  -- migrations/0004_*.sql for the full rationale.
  removed_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists users_family_id_idx on users(family_id);
create unique index if not exists users_auth_user_id_idx on users(auth_user_id) where auth_user_id is not null;

-- ----------------------------------------------------------------------------
-- dogs
-- ----------------------------------------------------------------------------
create table if not exists dogs (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references families(id) on delete cascade,
  name text not null,
  photo_url text,
  walks_per_day int not null default 4 check (walks_per_day > 0),
  notes text,
  created_at timestamptz not null default now()
);

create index if not exists dogs_family_id_idx on dogs(family_id);

-- ----------------------------------------------------------------------------
-- schedule_rules
-- A recurring rule ("every day at 20:00, rotate danny -> yael -> noam") used
-- to generate schedule_entries + walks going forward. Each rule is one of
-- the family's daily walk time slots — "4 walks a day" is 4 active rules.
-- ----------------------------------------------------------------------------
create table if not exists schedule_rules (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references families(id) on delete cascade,
  dog_id uuid not null references dogs(id) on delete cascade,
  time text not null check (time ~ '^([01]\d|2[0-3]):[0-5]\d$'),
  label text,
  days_of_week int[] not null default '{0,1,2,3,4,5,6}',
  rotation_user_ids uuid[] not null,
  rotation_anchor_date date not null,
  sort_order int not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create index if not exists schedule_rules_family_id_idx on schedule_rules(family_id);

-- ----------------------------------------------------------------------------
-- schedule_entries
-- A concrete generated slot on the calendar (date + time + who's responsible),
-- independent of whether a `walks` row/execution exists yet. `time` can be
-- edited per-entry (a single-occurrence time change) without touching the rule.
-- ----------------------------------------------------------------------------
create table if not exists schedule_entries (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references families(id) on delete cascade,
  dog_id uuid not null references dogs(id) on delete cascade,
  rule_id uuid references schedule_rules(id) on delete set null,
  date date not null,
  time text not null check (time ~ '^([01]\d|2[0-3]):[0-5]\d$'),
  responsible_user_id uuid not null references users(id) on delete restrict,
  created_at timestamptz not null default now(),
  unique (dog_id, date, time)
);

create index if not exists schedule_entries_family_id_idx on schedule_entries(family_id);
create index if not exists schedule_entries_date_idx on schedule_entries(family_id, date);

-- ----------------------------------------------------------------------------
-- walks
-- The execution record for a schedule_entry: status, who actually did it,
-- pee/poop/note detail, and (if swapped) the swap audit trail.
-- `schedule_entry_id` is nullable — an unplanned/spontaneous walk (logged
-- via "add a walk that already happened") has no prior schedule_entry and
-- must not affect the future rotation.
-- ----------------------------------------------------------------------------
create table if not exists walks (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references families(id) on delete cascade,
  schedule_entry_id uuid references schedule_entries(id) on delete cascade,
  dog_id uuid not null references dogs(id) on delete cascade,
  date date not null,
  scheduled_time text not null,
  responsible_user_id uuid not null references users(id) on delete restrict,
  status text not null default 'pending' check (status in ('pending', 'done', 'skipped')),
  completed_at timestamptz,
  completed_by_user_id uuid references users(id) on delete set null,
  had_pee boolean,
  had_poop boolean,
  note text,
  duration_minutes int,
  is_unplanned boolean not null default false,
  swap_original_user_id uuid references users(id) on delete set null,
  swap_new_user_id uuid references users(id) on delete set null,
  swap_swapped_at timestamptz,
  swap_swapped_by_user_id uuid references users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (schedule_entry_id)
);

create index if not exists walks_family_id_idx on walks(family_id);
create index if not exists walks_status_idx on walks(family_id, status);
create index if not exists walks_date_idx on walks(family_id, date);

-- ----------------------------------------------------------------------------
-- notifications (scheduled reminders)
-- ----------------------------------------------------------------------------
create table if not exists notifications (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references families(id) on delete cascade,
  walk_id uuid not null references walks(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  kind text not null check (kind in ('pre_walk_reminder', 'overdue_reminder')),
  fire_at timestamptz not null,
  sent boolean not null default false,
  canceled_reason text check (canceled_reason in ('walk_completed', 'walk_skipped', 'rescheduled')),
  created_at timestamptz not null default now()
);

create index if not exists notifications_family_id_idx on notifications(family_id);
create index if not exists notifications_fire_at_idx on notifications(sent, fire_at);

-- ----------------------------------------------------------------------------
-- updated_at trigger for walks
-- ----------------------------------------------------------------------------
create or replace function set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists walks_set_updated_at on walks;
create trigger walks_set_updated_at
  before update on walks
  for each row execute function set_updated_at();

-- ============================================================================
-- Family membership — invite codes
--
-- A device becomes a member of a family by creating one (create_family) or
-- joining one with a short invite code (join_family); membership is tracked
-- in family_auth_members, keyed by the device's (anonymous) auth.uid(). This
-- is deliberately separate from `users.auth_user_id`, which tracks a
-- narrower thing: which specific family member (אבא/אמא/...) this device
-- has "claimed" on the login screen. See migrations/0002_*.sql for the full
-- rationale (this file always reflects current/target state for a brand-new
-- project; existing projects should apply the migration instead).
-- ============================================================================

create table if not exists family_auth_members (
  auth_user_id uuid primary key references auth.users(id) on delete cascade,
  family_id uuid not null references families(id) on delete cascade,
  -- 'admin' = created the family; 'member' = joined via invite code. See
  -- migrations/0003_family_admin_roles.sql for the full rationale — this
  -- file always reflects current/target state for a brand-new project.
  role text not null default 'member' check (role in ('admin', 'member')),
  created_at timestamptz not null default now()
);

create index if not exists family_auth_members_family_id_idx on family_auth_members(family_id);

create or replace function generate_invite_code()
returns text as $$
declare
  alphabet text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; -- no 0/O/1/I/L — easy to read+type
  code text;
begin
  code := '';
  for i in 1..6 loop
    code := code || substr(alphabet, floor(random() * length(alphabet))::int + 1, 1);
  end loop;
  return code;
end;
$$ language plpgsql volatile;

-- ============================================================================
-- Row Level Security
--
-- Every table is isolated by family_id via current_family_id(), which is now
-- resolved from family_auth_members (device -> family), not from
-- users.auth_user_id (device -> claimed profile). A device gets
-- current_family_id() the moment it creates/joins a family — before it has
-- ever touched `users` — which is what lets `families`/`users` be scoped
-- strictly to "own family only" like every other table, with exactly one
-- narrow, deliberate exception: find_family_by_invite_code() (further down),
-- the sole way to resolve a code to a family before joining it.
-- ============================================================================

create or replace function current_family_id()
returns uuid as $$
  select family_id from family_auth_members where auth_user_id = auth.uid() limit 1;
$$ language sql stable security definer;

alter table families enable row level security;
alter table users enable row level security;
alter table dogs enable row level security;
alter table schedule_rules enable row level security;
alter table schedule_entries enable row level security;
alter table walks enable row level security;
alter table notifications enable row level security;
alter table family_auth_members enable row level security;

create policy "select own family" on families
  for select using (id = current_family_id());
-- No client-facing insert/update/delete policy on `families`: creation goes
-- through create_family(), invite_code rotation through
-- regenerate_invite_code() — both SECURITY DEFINER, below.

create policy "select own membership" on family_auth_members
  for select using (auth_user_id = auth.uid());
-- No client-facing insert/update/delete either — only create_family() /
-- join_family() write this table, and they run as SECURITY DEFINER.

create or replace function current_family_role()
returns text as $$
  select role
  from family_auth_members
  where auth_user_id = auth.uid()
  limit 1;
$$ language sql stable security definer;

create or replace function is_family_admin(target_family_id uuid)
returns boolean as $$
  select exists (
    select 1
    from family_auth_members
    where auth_user_id = auth.uid()
      and family_id = target_family_id
      and role = 'admin'
  );
$$ language sql stable security definer;

create policy "select users in own family" on users
  for select using (family_id = current_family_id());
-- Adding a new family member is admin-only. Editing (name/photo/reminder
-- settings) stays open to every family member — that includes editing your
-- own profile, which is not an administrative action.
create policy "insert users (family admins only)" on users
  for insert with check (
    family_id = current_family_id()
    and is_family_admin(family_id)
  );
-- Editing a profile (name/avatar/color/photo/reminders) is allowed for:
--   - your OWN row (auth_user_id = auth.uid()), or
--   - any admin, for any row in their family.
-- Both the USING (which existing rows can be touched) and WITH CHECK (what
-- the resulting row must look like) require removed_at is null — this does
-- two things at once: a removed profile can never be edited by anyone
-- through this policy (USING excludes it entirely), AND removed_at can
-- never be set to non-null OR cleared back to null through this policy
-- either (WITH CHECK requires it stay null) — soft-delete/undelete stays
-- exclusively the job of admin_delete_family_member() (further down),
-- which runs as SECURITY DEFINER and bypasses this policy entirely. Claiming
-- a profile (setting auth_user_id on first pick) is NOT covered by this
-- policy — see claim_family_profile() further down for why that needed its
-- own narrow RPC instead of broader UPDATE access.
create policy "update users (self or admin, active profiles only)" on users
  for update using (
    family_id = current_family_id()
    and removed_at is null
    and (auth_user_id = auth.uid() or is_family_admin(family_id))
  )
  with check (
    family_id = current_family_id()
    and removed_at is null
    and (auth_user_id = auth.uid() or is_family_admin(family_id))
  );
-- Intentionally no DELETE policy on users — direct client deletion is
-- blocked. Deletion goes through admin_delete_family_member() (below), an
-- atomic SECURITY DEFINER RPC that also reassigns the departing member's
-- rotation turns. See migrations/0003_*.sql and 0004_*.sql.

-- The ONLY way to resolve an invite code to a family before you've joined
-- it. Deliberately narrow: takes no other filter (can't enumerate/browse
-- families), returns just the 3 fields the join screen needs — never a full
-- families row, never any member/schedule/walk data.
create or replace function find_family_by_invite_code(code text)
returns table (id uuid, name text, dog_name text) as $$
  select f.id, f.name, d.name as dog_name
  from families f
  left join dogs d on d.family_id = f.id
  where upper(f.invite_code) = upper(code)
  limit 1;
$$ language sql stable security definer;

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

  -- Creator becomes admin.
  insert into family_auth_members (auth_user_id, family_id, role)
  values (auth.uid(), new_family_id, 'admin')
  on conflict (auth_user_id) do update set family_id = excluded.family_id, role = 'admin';

  if dog_name is not null and length(trim(dog_name)) > 0 then
    insert into dogs (family_id, name) values (new_family_id, trim(dog_name));
  end if;

  return query select f.id, f.name, f.invite_code from families f where f.id = new_family_id;
end;
$$ language plpgsql volatile security definer;

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

  -- Joining devices become members — unless this device is already an
  -- admin of this exact same family (re-joining shouldn't demote it).
  insert into family_auth_members (auth_user_id, family_id, role)
  values (auth.uid(), target_family_id, 'member')
  on conflict (auth_user_id) do update set
    family_id = excluded.family_id,
    role = case
      when family_auth_members.family_id = excluded.family_id
       and family_auth_members.role = 'admin'
        then 'admin'
      else 'member'
    end;

  return query select f.id, f.name from families f where f.id = target_family_id;
end;
$$ language plpgsql volatile security definer;

-- Invite-code rotation is admin-only.
create or replace function regenerate_invite_code(target_family_id uuid)
returns text as $$
declare
  new_code text;
  attempts int := 0;
begin
  if not is_family_admin(target_family_id) then
    raise exception 'admin permission required';
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

-- Claims a family member profile for the CALLING device by setting
-- users.auth_user_id — this is what "pick your profile" does on first
-- sign-in, and what lets current_family_id()-style RLS resolve who this
-- device is going forward for profile-scoped concerns. Deliberately a
-- narrow RPC rather than exposed through the general users UPDATE policy:
-- claiming isn't a "profile edit" (auth_user_id = auth.uid() can't hold
-- yet — there is no "self" row until this call establishes one), so it
-- could never pass the self-or-admin UPDATE policy above, and reopening
-- that policy just to allow claiming would also reopen arbitrary edits to
-- name/color/photo/removed_at, which is exactly what this migration set
-- out to close. This function only ever sets auth_user_id — nothing else —
-- and only on an active (removed_at is null) user in the caller's own
-- family.
--
-- IMPORTANT — this is NOT a profile-transfer mechanism. A profile that is
-- already claimed by a DIFFERENT auth_user_id is rejected outright: without
-- this check, any Member's device could call this RPC against any other
-- active profile in the family and silently steal it (overwrite its
-- auth_user_id with their own), which would let them become "self" for
-- that profile and bypass the entire Self + Admin edit model. Re-claiming
-- your OWN already-claimed profile (e.g. the app calls this again on every
-- sign-in) stays a no-op success — that's idempotent, not a takeover. Moving
-- a profile to a new phone on purpose is a separate, not-yet-implemented
-- admin-only reset/transfer flow; it is intentionally unsupported here
-- rather than allowed insecurely for convenience.
-- REVISION NOTE: the SELECT-then-UPDATE structure below has a TOCTOU race
-- between reading target_auth_user_id and running the guarded UPDATE — two
-- devices can both read auth_user_id as null, both pass the "not already
-- claimed by someone else" check, and then both run the UPDATE. The WHERE
-- guard (auth_user_id is null or auth_user_id = auth.uid()) still prevents
-- a WRONG row from being written (only the first UPDATE to actually commit
-- can match), but without checking how many rows it affected, the SECOND
-- (loser) caller's UPDATE affects 0 rows and — since a 0-row UPDATE is not
-- an error in Postgres — the function would return normally, reporting
-- success to a caller that did NOT actually claim the profile. authStore.
-- signIn() would then persist currentUserId for a profile this device
-- never claimed. Fixed by checking GET DIAGNOSTICS ROW_COUNT after the
-- UPDATE and raising when it's 0 — the initial SELECT-based check above
-- stays only as a fast, friendly early rejection; the actual guarantee is
-- the atomic UPDATE + row-count check below.
create or replace function claim_family_profile(target_user_id uuid)
returns void as $$
declare
  target_family uuid;
  target_removed_at timestamptz;
  target_auth_user_id uuid;
  updated_count int;
begin
  if auth.uid() is null then
    raise exception 'must be authenticated';
  end if;

  select family_id, removed_at, auth_user_id
    into target_family, target_removed_at, target_auth_user_id
  from users
  where id = target_user_id;

  if target_family is null then
    raise exception 'user not found';
  end if;

  if target_family is distinct from current_family_id() then
    raise exception 'not a member of this user''s family';
  end if;

  if target_removed_at is not null then
    raise exception 'cannot claim a removed profile';
  end if;

  if target_auth_user_id is not null and target_auth_user_id is distinct from auth.uid() then
    raise exception 'profile already claimed by another device';
  end if;

  update users
  set auth_user_id = auth.uid()
  where id = target_user_id
    and family_id = target_family
    and removed_at is null
    and (auth_user_id is null or auth_user_id = auth.uid());

  get diagnostics updated_count = row_count;

  -- The atomic source of truth: if the guarded UPDATE didn't actually touch
  -- a row, this call did NOT claim the profile — regardless of what the
  -- earlier SELECT saw. This is what closes the race: only one concurrent
  -- caller can ever see updated_count > 0 for a given target_user_id.
  if updated_count = 0 then
    raise exception 'profile already claimed by another device';
  end if;
end;
$$ language plpgsql volatile security definer;

create policy "select dogs in own family" on dogs
  for select using (family_id = current_family_id());
create policy "modify dogs in own family" on dogs
  for all using (family_id = current_family_id()) with check (family_id = current_family_id());

-- Permanent schedule configuration (add/edit/delete a fixed walk time,
-- reorder, change rotation assignments) is admin-only — see
-- migrations/0004_*.sql. Every family member can still SEE the schedule;
-- ordinary daily activity (schedule_entries, walks — including logging a
-- spontaneous walk) is a separate table and stays open to all, below.
create policy "select rules in own family" on schedule_rules
  for select using (family_id = current_family_id());
create policy "insert rules (family admins only)" on schedule_rules
  for insert with check (family_id = current_family_id() and is_family_admin(family_id));
create policy "update rules (family admins only)" on schedule_rules
  for update using (family_id = current_family_id() and is_family_admin(family_id))
  with check (family_id = current_family_id() and is_family_admin(family_id));
create policy "delete rules (family admins only)" on schedule_rules
  for delete using (family_id = current_family_id() and is_family_admin(family_id));

create policy "select entries in own family" on schedule_entries
  for select using (family_id = current_family_id());
create policy "modify entries in own family" on schedule_entries
  for all using (family_id = current_family_id()) with check (family_id = current_family_id());

create policy "select walks in own family" on walks
  for select using (family_id = current_family_id());
create policy "modify walks in own family" on walks
  for all using (family_id = current_family_id()) with check (family_id = current_family_id());

create policy "select notifications in own family" on notifications
  for select using (family_id = current_family_id());
create policy "modify notifications in own family" on notifications
  for all using (family_id = current_family_id()) with check (family_id = current_family_id());

-- ----------------------------------------------------------------------------
-- Admin-only, atomic family-member deletion (see migrations/0004_*.sql for
-- the full rationale). Applies the rotation reassignment the client already
-- computed via src/logic/familyManagement.ts planUserRemoval() — completed
-- walks are never included, so history is preserved — and deletes the user,
-- as one transaction, after independently re-checking server-side that the
-- caller is an admin of that exact user's family.
-- ----------------------------------------------------------------------------
create or replace function admin_delete_family_member(
  target_user_id uuid,
  rule_updates jsonb default '[]'::jsonb,
  entry_updates jsonb default '[]'::jsonb,
  walk_updates jsonb default '[]'::jsonb
)
returns void as $$
declare
  target_family uuid;
  item jsonb;
  elem text;
begin
  if auth.uid() is null then
    raise exception 'must be authenticated';
  end if;

  select family_id into target_family from users where id = target_user_id;
  if target_family is null then
    raise exception 'user not found';
  end if;

  if target_family is distinct from current_family_id() then
    raise exception 'not a member of this user''s family';
  end if;

  if not is_family_admin(target_family) then
    raise exception 'admin permission required';
  end if;

  -- Validate EVERY replacement user id in the client-supplied JSON before
  -- applying anything. This RPC is SECURITY DEFINER, so it runs with more
  -- privilege than RLS would otherwise grant the caller — the *_updates
  -- payloads must not be trusted just because the caller is confirmed to be
  -- an admin of this family. Each replacement responsible_user_id /
  -- rotation_user_ids entry must reference a user that: exists, belongs to
  -- target_family (never a different family), is active (removed_at is
  -- null — never a previously-removed member), and is not target_user_id
  -- itself (the member being removed can't be their own replacement).
  -- Any violation aborts the whole call (raise exception rolls back the
  -- implicit transaction) rather than partially applying a bad payload.
  for item in select * from jsonb_array_elements(rule_updates) loop
    for elem in select * from jsonb_array_elements_text(item->'rotation_user_ids') loop
      if not exists (
        select 1 from users u
        where u.id = elem::uuid
          and u.family_id = target_family
          and u.removed_at is null
          and u.id <> target_user_id
      ) then
        raise exception 'invalid rotation_user_ids replacement in rule_updates';
      end if;
    end loop;
  end loop;

  for item in select * from jsonb_array_elements(entry_updates) loop
    if not exists (
      select 1 from users u
      where u.id = (item->>'responsible_user_id')::uuid
        and u.family_id = target_family
        and u.removed_at is null
        and u.id <> target_user_id
    ) then
      raise exception 'invalid responsible_user_id replacement in entry_updates';
    end if;
  end loop;

  for item in select * from jsonb_array_elements(walk_updates) loop
    if not exists (
      select 1 from users u
      where u.id = (item->>'responsible_user_id')::uuid
        and u.family_id = target_family
        and u.removed_at is null
        and u.id <> target_user_id
    ) then
      raise exception 'invalid responsible_user_id replacement in walk_updates';
    end if;
  end loop;

  for item in select * from jsonb_array_elements(rule_updates) loop
    update schedule_rules
    set rotation_user_ids = (
      select array_agg(elem::text::uuid)
      from jsonb_array_elements_text(item->'rotation_user_ids') as elem
    )
    where id = (item->>'id')::uuid
      and family_id = target_family;
  end loop;

  for item in select * from jsonb_array_elements(entry_updates) loop
    update schedule_entries
    set responsible_user_id = (item->>'responsible_user_id')::uuid
    where id = (item->>'id')::uuid
      and family_id = target_family;
  end loop;

  for item in select * from jsonb_array_elements(walk_updates) loop
    update walks
    set responsible_user_id = (item->>'responsible_user_id')::uuid,
        updated_at = now()
    where id = (item->>'id')::uuid
      and family_id = target_family;
  end loop;

  -- Soft-delete, never a real DELETE: schedule_entries/walks.*_user_id are
  -- `on delete restrict` on purpose, and past entries + completed walks are
  -- intentionally left pointing at this user (planUserRemoval only
  -- reassigns future pending ones) — a real DELETE here would fail with a
  -- foreign_key_violation for any member with actual history. See
  -- migrations/0004_*.sql for the full rationale.
  update users
  set removed_at = now()
  where id = target_user_id
    and family_id = target_family;
end;
$$ language plpgsql volatile security definer;

-- ============================================================================
-- Requests / audit / presence (from migrations/0005_requests_audit_presence.sql)
--
-- Everything below this line is additive on top of 0001-0004 and reflects
-- migration 0005 verbatim (search_path hardening, walks/schedule_entries
-- active-user RLS, walk_swap_requests, time_change_requests, audit_log,
-- user_presence, the audit triggers on walks/schedule_rules/users, and the
-- RPCs that back all of it). This file represents the fresh-install
-- schema — 0001-0004's own migration files were NOT rewritten; see
-- requirement 15.
-- ============================================================================

-- ============================================================================
-- 0005_requests_audit_presence.sql
--
-- 0001-0004 are already deployed to the live project — this migration does
-- NOT touch any of those files. Everything here is additive: new tables,
-- new RLS policies (only ADDING checks to `walks`/`schedule_entries`, which
-- are re-created as narrower equivalents — see section 2 — never removing
-- an existing guarantee), and new SECURITY DEFINER functions.
--
-- ORDER MATTERS in this file: helper functions (current_profile_id(),
-- log_audit_event()) are defined before anything that calls them, so this
-- runs correctly top-to-bottom in one pass (a plpgsql function body that
-- calls a not-yet-existing function can fail at CREATE time under Postgres's
-- default check_function_bodies).
--
-- Sections:
--   1. search_path hardening for existing SECURITY DEFINER functions.
--   2. walks / schedule_entries: reject a removed user as a NEW responsible
--      assignment (INSERT/UPDATE only — SELECT/DELETE unchanged).
--   3. current_profile_id() helper.
--   4. audit_log table + log_audit_event().
--   5. walk_swap_requests — Member-to-Member swap request/approval.
--   6. time_change_requests — Member-to-Admin time-change request/approval.
--   7. admin_delete_family_member() / regenerate_invite_code() — re-defined
--      identically to their deployed 0004 versions, plus one audit-log call
--      each.
--   8. user_presence — lightweight last-seen tracking, Admin-only to read.
--   9. Audit triggers on walks / schedule_rules / users — server-authored
--      "walk completed", "spontaneous walk added", "schedule rule
--      created/edited/deleted", "profile edited", "profile claimed".
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. search_path hardening (requirement: "set safe search_path on SECURITY
--    DEFINER functions"). An unqualified search_path on a SECURITY DEFINER
--    function is a known Postgres foot-gun (a caller-controlled schema
--    earlier in their search_path could shadow an unqualified identifier
--    used inside the function). None of these functions' logic changes —
--    this only pins the schema each one resolves unqualified names against.
-- ----------------------------------------------------------------------------

alter function current_family_id() set search_path = public;
alter function current_family_role() set search_path = public;
alter function is_family_admin(uuid) set search_path = public;
alter function find_family_by_invite_code(text) set search_path = public;
alter function create_family(text, text) set search_path = public;
alter function join_family(text) set search_path = public;
alter function claim_family_profile(uuid) set search_path = public;

-- ----------------------------------------------------------------------------
-- 2. walks / schedule_entries: a removed user must never become the NEW
--    responsible_user_id of a walk or schedule_entry. The previous policies
--    were `for all` (covering select/insert/update/delete with one check),
--    which is why this couldn't just be "added" to them — a check strong
--    enough for insert/update would also apply to (and needlessly break)
--    SELECT of old rows whose responsible user has since been removed,
--    which History depends on ("(הוסר)" display, preserved historical
--    references). Each `for all` policy is replaced with separate INSERT/
--    UPDATE/SELECT/DELETE policies: SELECT and DELETE are UNCHANGED in
--    effect (same condition as before), INSERT/UPDATE gain the active-user
--    check. completed_by_user_id is deliberately NOT constrained here — a
--    walk already legitimately completed by someone who was later removed
--    must remain writable for its OTHER fields (e.g. admin editing pee/poop
--    details afterward) without that historical reference blocking it.
-- ----------------------------------------------------------------------------

drop policy if exists "modify walks in own family" on walks;

drop policy if exists "select walks in own family" on walks;
create policy "select walks in own family" on walks
  for select using (family_id = current_family_id());

create policy "insert walks in own family" on walks
  for insert with check (
    family_id = current_family_id()
    and exists (
      select 1 from users ru
      where ru.id = responsible_user_id
        and ru.family_id = walks.family_id
        and ru.removed_at is null
    )
  );

create policy "update walks in own family" on walks
  for update using (family_id = current_family_id())
  with check (
    family_id = current_family_id()
    and exists (
      select 1 from users ru
      where ru.id = responsible_user_id
        and ru.family_id = walks.family_id
        and ru.removed_at is null
    )
  );

create policy "delete walks in own family" on walks
  for delete using (family_id = current_family_id());

drop policy if exists "modify entries in own family" on schedule_entries;

drop policy if exists "select entries in own family" on schedule_entries;
create policy "select entries in own family" on schedule_entries
  for select using (family_id = current_family_id());

create policy "insert entries in own family" on schedule_entries
  for insert with check (
    family_id = current_family_id()
    and exists (
      select 1 from users ru
      where ru.id = responsible_user_id
        and ru.family_id = schedule_entries.family_id
        and ru.removed_at is null
    )
  );

create policy "update entries in own family" on schedule_entries
  for update using (family_id = current_family_id())
  with check (
    family_id = current_family_id()
    and exists (
      select 1 from users ru
      where ru.id = responsible_user_id
        and ru.family_id = schedule_entries.family_id
        and ru.removed_at is null
    )
  );

create policy "delete entries in own family" on schedule_entries
  for delete using (family_id = current_family_id());

-- ----------------------------------------------------------------------------
-- 3. current_profile_id() — resolves the CALLING DEVICE's own active
--    profile id within its current family (i.e. "which users.id am I"), the
--    same concept claim_family_profile()/the Self+Admin UPDATE policy rely
--    on (auth_user_id = auth.uid()). Used throughout this file so every new
--    RPC resolves "who is calling" the same trusted way, rather than
--    trusting a client-supplied user id anywhere.
-- ----------------------------------------------------------------------------

create or replace function current_profile_id()
returns uuid as $$
  select id from users
  where auth_user_id = auth.uid()
    and family_id = current_family_id()
    and removed_at is null
  limit 1;
$$ language sql stable security definer set search_path = public;

-- ----------------------------------------------------------------------------
-- 4. audit_log table + log_audit_event() — server-authored only. No INSERT/UPDATE/DELETE policy is
--    defined for the `authenticated` role at all, which under RLS means
--    ordinary clients can never write here directly, whatever they call —
--    only log_audit_event() (SECURITY DEFINER, executed as its owner) can,
--    and only functions defined later in this file call it. EXECUTE on
--    log_audit_event itself is explicitly revoked from PUBLIC/anon/
--    authenticated so a client can't invoke it directly as an RPC either
--    (Postgres still lets the *owner* call it internally from another
--    SECURITY DEFINER function, since ownership implies execute rights on
--    one's own objects) — this is what "prefer server-side creation for
--    security-sensitive events" and "avoid trusting arbitrary client-
--    supplied actor IDs" mean in practice here: actor is always resolved
--    server-side, never passed in trusted as-is by a caller with EXECUTE on
--    the logging function itself.
-- ----------------------------------------------------------------------------

create table if not exists audit_log (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references families(id) on delete cascade,
  actor_user_id uuid references users(id) on delete set null,
  action text not null,
  target_type text,
  target_id uuid,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists audit_log_family_id_idx on audit_log(family_id, created_at desc);

alter table audit_log enable row level security;

drop policy if exists "admin reads audit log" on audit_log;
create policy "admin reads audit log" on audit_log
  for select using (family_id = current_family_id() and is_family_admin(family_id));
-- No insert/update/delete policy — see comment block above.

create or replace function log_audit_event(
  p_family_id uuid,
  p_actor_user_id uuid,
  p_action text,
  p_target_type text,
  p_target_id uuid,
  p_metadata jsonb default '{}'::jsonb
)
returns void as $$
begin
  insert into audit_log (family_id, actor_user_id, action, target_type, target_id, metadata)
  values (p_family_id, p_actor_user_id, p_action, p_target_type, p_target_id, p_metadata);
end;
$$ language plpgsql volatile security definer set search_path = public;

revoke all on function log_audit_event(uuid, uuid, text, text, uuid, jsonb) from public;

-- NOTE: an earlier draft of this migration exposed a client-callable
-- log_client_audit_event(p_action, ...) for a small allow-list of
-- "self-describing" events (profile_edited/profile_claimed). It was removed
-- before this migration was ever deployed (no app code called it) in favor
-- of the triggers in section 9 below: a trigger observes the actual row
-- change and derives the actor from auth.uid() itself, so the event can
-- never be logged without the change really happening, and never for an
-- action the client merely claims occurred. That is strictly more
-- trustworthy than a client-invoked "please log this" call, per the
-- "prefer trustworthy server-authored audit events where possible"
-- requirement.

-- ----------------------------------------------------------------------------
-- 5. walk_swap_requests — Member A asks Member B to take over a walk
--    currently assigned to A. Only B (the target) can approve/reject;
--    Admin is deliberately NOT a party to this workflow. Creation and
--    resolution both go through SECURITY DEFINER RPCs (never a direct
--    client INSERT/UPDATE) so every actor/target/eligibility check is
--    server-side and atomic — see the requirement: "Authorization MUST be
--    server-side, not only hidden in the UI."
-- ----------------------------------------------------------------------------

create table if not exists walk_swap_requests (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references families(id) on delete cascade,
  walk_id uuid not null references walks(id) on delete cascade,
  requested_by_user_id uuid not null references users(id) on delete restrict,
  target_user_id uuid not null references users(id) on delete restrict,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  -- Snapshot of the walk at request time, used to detect staleness on
  -- approval (requirement: "revalidate ... has not materially changed").
  expected_responsible_user_id uuid not null,
  expected_status text not null,
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by_user_id uuid references users(id) on delete set null
);

create index if not exists walk_swap_requests_family_id_idx on walk_swap_requests(family_id);
create index if not exists walk_swap_requests_walk_id_idx on walk_swap_requests(walk_id);

alter table walk_swap_requests enable row level security;

-- Visible only to the two people involved, or an admin auditing the family
-- (admin cannot approve/reject this workflow — see the functions below —
-- but not-being-the-approver isn't the same as "must not see it exists").
drop policy if exists "select relevant swap requests" on walk_swap_requests;
create policy "select relevant swap requests" on walk_swap_requests
  for select using (
    family_id = current_family_id()
    and (
      requested_by_user_id = current_profile_id()
      or target_user_id = current_profile_id()
      or is_family_admin(family_id)
    )
  );
-- No INSERT/UPDATE/DELETE policy: every write goes through the SECURITY
-- DEFINER functions below, which validate far more than RLS conveniently
-- can (walk ownership, staleness, active-user checks) and apply the walk
-- reassignment atomically in the same transaction as the status change.

create or replace function create_swap_request(p_walk_id uuid, p_target_user_id uuid)
returns uuid as $$
declare
  me uuid;
  my_family uuid;
  w record;
  new_id uuid;
begin
  select id, family_id into me, my_family from users
  where auth_user_id = auth.uid() and removed_at is null and family_id = current_family_id();
  if me is null then
    raise exception 'no active profile claimed on this family';
  end if;

  select * into w from walks where id = p_walk_id;
  if w.id is null or w.family_id is distinct from my_family then
    raise exception 'walk not found in this family';
  end if;
  if w.status <> 'pending' then
    raise exception 'walk is no longer pending';
  end if;
  if w.responsible_user_id <> me then
    raise exception 'you can only request a swap for a walk you are responsible for';
  end if;

  if p_target_user_id = me then
    raise exception 'choose a different family member';
  end if;
  if not exists (
    select 1 from users where id = p_target_user_id and family_id = my_family and removed_at is null
  ) then
    raise exception 'target member is not an active member of this family';
  end if;

  if exists (
    select 1 from walk_swap_requests
    where walk_id = p_walk_id and status = 'pending'
  ) then
    raise exception 'a pending swap request already exists for this walk';
  end if;

  insert into walk_swap_requests (
    family_id, walk_id, requested_by_user_id, target_user_id,
    expected_responsible_user_id, expected_status
  ) values (
    my_family, p_walk_id, me, p_target_user_id, w.responsible_user_id, w.status
  ) returning id into new_id;

  perform log_audit_event(my_family, me, 'swap_request_created', 'walk', p_walk_id,
    jsonb_build_object('request_id', new_id, 'target_user_id', p_target_user_id));

  return new_id;
end;
$$ language plpgsql volatile security definer set search_path = public;

create or replace function approve_swap_request(p_request_id uuid)
returns void as $$
declare
  me uuid;
  req record;
  w record;
begin
  select id into me from users
  where auth_user_id = auth.uid() and removed_at is null and family_id = current_family_id();
  if me is null then
    raise exception 'no active profile claimed on this family';
  end if;

  select * into req from walk_swap_requests where id = p_request_id for update;
  if req.id is null or req.family_id is distinct from current_family_id() then
    raise exception 'request not found in this family';
  end if;
  if req.target_user_id <> me then
    raise exception 'only the requested member can approve this swap';
  end if;

  -- Idempotent: approving an already-approved request again is a no-op
  -- success, not an error (safe against a double-tap / duplicate network
  -- retry). Approving an already-REJECTED request is a real conflict.
  if req.status = 'approved' then
    return;
  end if;
  if req.status = 'rejected' then
    raise exception 'this request was already rejected';
  end if;

  select * into w from walks where id = req.walk_id for update;
  if w.id is null or w.status <> 'pending' or w.responsible_user_id <> req.expected_responsible_user_id then
    raise exception 'the walk has changed since this request was created and can no longer be approved';
  end if;
  if not exists (select 1 from users where id = req.target_user_id and family_id = req.family_id and removed_at is null) then
    raise exception 'you are no longer an active member of this family';
  end if;

  update walks
  set responsible_user_id = req.target_user_id,
      swap_original_user_id = coalesce(w.swap_original_user_id, w.responsible_user_id),
      swap_new_user_id = req.target_user_id,
      swap_swapped_at = now(),
      swap_swapped_by_user_id = req.target_user_id,
      updated_at = now()
  where id = w.id;

  update walk_swap_requests
  set status = 'approved', resolved_at = now(), resolved_by_user_id = me
  where id = p_request_id;

  perform log_audit_event(req.family_id, me, 'swap_request_approved', 'walk', w.id,
    jsonb_build_object('request_id', p_request_id, 'requested_by_user_id', req.requested_by_user_id));
end;
$$ language plpgsql volatile security definer set search_path = public;

create or replace function reject_swap_request(p_request_id uuid)
returns void as $$
declare
  me uuid;
  req record;
begin
  select id into me from users
  where auth_user_id = auth.uid() and removed_at is null and family_id = current_family_id();
  if me is null then
    raise exception 'no active profile claimed on this family';
  end if;

  select * into req from walk_swap_requests where id = p_request_id for update;
  if req.id is null or req.family_id is distinct from current_family_id() then
    raise exception 'request not found in this family';
  end if;
  if req.target_user_id <> me then
    raise exception 'only the requested member can reject this swap';
  end if;

  if req.status = 'rejected' then
    return; -- idempotent
  end if;
  if req.status = 'approved' then
    raise exception 'this request was already approved';
  end if;

  update walk_swap_requests
  set status = 'rejected', resolved_at = now(), resolved_by_user_id = me
  where id = p_request_id;

  perform log_audit_event(req.family_id, me, 'swap_request_rejected', 'walk', req.walk_id,
    jsonb_build_object('request_id', p_request_id, 'requested_by_user_id', req.requested_by_user_id));
end;
$$ language plpgsql volatile security definer set search_path = public;

-- ----------------------------------------------------------------------------
-- 6. time_change_requests — Member asks ADMIN to move a walk's time.
--    Only an admin of the family may approve/reject. Approval also
--    re-validates the schedule_entries (dog_id, date, time) uniqueness
--    constraint before applying, and updates both schedule_entries.time
--    (when the walk came from a rule) and walks.scheduled_time atomically.
-- ----------------------------------------------------------------------------

create table if not exists time_change_requests (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references families(id) on delete cascade,
  walk_id uuid not null references walks(id) on delete cascade,
  requested_by_user_id uuid not null references users(id) on delete restrict,
  proposed_time text not null check (proposed_time ~ '^([01]\d|2[0-3]):[0-5]\d$'),
  expected_time text not null,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by_user_id uuid references users(id) on delete set null
);

create index if not exists time_change_requests_family_id_idx on time_change_requests(family_id);
create index if not exists time_change_requests_walk_id_idx on time_change_requests(walk_id);

alter table time_change_requests enable row level security;

drop policy if exists "select relevant time change requests" on time_change_requests;
create policy "select relevant time change requests" on time_change_requests
  for select using (
    family_id = current_family_id()
    and (requested_by_user_id = current_profile_id() or is_family_admin(family_id))
  );

create or replace function create_time_change_request(p_walk_id uuid, p_proposed_time text)
returns uuid as $$
declare
  me uuid;
  my_family uuid;
  w record;
  new_id uuid;
begin
  if p_proposed_time !~ '^([01]\d|2[0-3]):[0-5]\d$' then
    raise exception 'invalid time format';
  end if;

  select id, family_id into me, my_family from users
  where auth_user_id = auth.uid() and removed_at is null and family_id = current_family_id();
  if me is null then
    raise exception 'no active profile claimed on this family';
  end if;

  select * into w from walks where id = p_walk_id;
  if w.id is null or w.family_id is distinct from my_family then
    raise exception 'walk not found in this family';
  end if;
  if w.status <> 'pending' then
    raise exception 'walk is no longer pending';
  end if;
  if w.responsible_user_id <> me then
    raise exception 'you can only request a time change for a walk you are responsible for';
  end if;
  if p_proposed_time = w.scheduled_time then
    raise exception 'that is already this walk''s time';
  end if;

  if exists (
    select 1 from time_change_requests where walk_id = p_walk_id and status = 'pending'
  ) then
    raise exception 'a pending time-change request already exists for this walk';
  end if;

  insert into time_change_requests (family_id, walk_id, requested_by_user_id, proposed_time, expected_time)
  values (my_family, p_walk_id, me, p_proposed_time, w.scheduled_time)
  returning id into new_id;

  perform log_audit_event(my_family, me, 'time_change_request_created', 'walk', p_walk_id,
    jsonb_build_object('request_id', new_id, 'proposed_time', p_proposed_time));

  return new_id;
end;
$$ language plpgsql volatile security definer set search_path = public;

create or replace function approve_time_change_request(p_request_id uuid)
returns void as $$
declare
  me uuid;
  req record;
  w record;
begin
  select id into me from users
  where auth_user_id = auth.uid() and removed_at is null and family_id = current_family_id();
  if me is null then
    raise exception 'no active profile claimed on this family';
  end if;

  select * into req from time_change_requests where id = p_request_id for update;
  if req.id is null or req.family_id is distinct from current_family_id() then
    raise exception 'request not found in this family';
  end if;
  if not is_family_admin(req.family_id) then
    raise exception 'admin permission required';
  end if;

  if req.status = 'approved' then
    return; -- idempotent
  end if;
  if req.status = 'rejected' then
    raise exception 'this request was already rejected';
  end if;

  select * into w from walks where id = req.walk_id for update;
  if w.id is null or w.status <> 'pending' or w.scheduled_time <> req.expected_time then
    raise exception 'the walk has changed since this request was created and can no longer be approved';
  end if;

  if w.schedule_entry_id is not null then
    if exists (
      select 1 from schedule_entries se
      where se.dog_id = w.dog_id
        and se.date = w.date
        and se.time = req.proposed_time
        and se.id <> w.schedule_entry_id
    ) then
      raise exception 'that time is already taken by another scheduled walk';
    end if;
    update schedule_entries set time = req.proposed_time where id = w.schedule_entry_id;
  end if;

  update walks
  set scheduled_time = req.proposed_time, updated_at = now()
  where id = w.id;

  update time_change_requests
  set status = 'approved', resolved_at = now(), resolved_by_user_id = me
  where id = p_request_id;

  perform log_audit_event(req.family_id, me, 'time_change_request_approved', 'walk', w.id,
    jsonb_build_object('request_id', p_request_id, 'proposed_time', req.proposed_time));
end;
$$ language plpgsql volatile security definer set search_path = public;

create or replace function reject_time_change_request(p_request_id uuid)
returns void as $$
declare
  me uuid;
  req record;
begin
  select id into me from users
  where auth_user_id = auth.uid() and removed_at is null and family_id = current_family_id();
  if me is null then
    raise exception 'no active profile claimed on this family';
  end if;

  select * into req from time_change_requests where id = p_request_id for update;
  if req.id is null or req.family_id is distinct from current_family_id() then
    raise exception 'request not found in this family';
  end if;
  if not is_family_admin(req.family_id) then
    raise exception 'admin permission required';
  end if;

  if req.status = 'rejected' then
    return; -- idempotent
  end if;
  if req.status = 'approved' then
    raise exception 'this request was already approved';
  end if;

  update time_change_requests
  set status = 'rejected', resolved_at = now(), resolved_by_user_id = me
  where id = p_request_id;

  perform log_audit_event(req.family_id, me, 'time_change_request_rejected', 'walk', req.walk_id,
    jsonb_build_object('request_id', p_request_id));
end;
$$ language plpgsql volatile security definer set search_path = public;

-- ----------------------------------------------------------------------------
-- 7. admin_delete_family_member() / regenerate_invite_code() — re-defined
--    identically to their deployed 0004 versions (same validation, same
--    behavior), plus a search_path pin and one log_audit_event() call each.
-- ----------------------------------------------------------------------------

create or replace function admin_delete_family_member(
  target_user_id uuid,
  rule_updates jsonb default '[]'::jsonb,
  entry_updates jsonb default '[]'::jsonb,
  walk_updates jsonb default '[]'::jsonb
)
returns void as $$
declare
  target_family uuid;
  item jsonb;
  elem text;
  caller_id uuid;
begin
  if auth.uid() is null then
    raise exception 'must be authenticated';
  end if;

  select family_id into target_family from users where id = target_user_id;
  if target_family is null then
    raise exception 'user not found';
  end if;

  if target_family is distinct from current_family_id() then
    raise exception 'not a member of this user''s family';
  end if;

  if not is_family_admin(target_family) then
    raise exception 'admin permission required';
  end if;

  for item in select * from jsonb_array_elements(rule_updates) loop
    for elem in select * from jsonb_array_elements_text(item->'rotation_user_ids') loop
      if not exists (
        select 1 from users u
        where u.id = elem::uuid
          and u.family_id = target_family
          and u.removed_at is null
          and u.id <> target_user_id
      ) then
        raise exception 'invalid rotation_user_ids replacement in rule_updates';
      end if;
    end loop;
  end loop;

  for item in select * from jsonb_array_elements(entry_updates) loop
    if not exists (
      select 1 from users u
      where u.id = (item->>'responsible_user_id')::uuid
        and u.family_id = target_family
        and u.removed_at is null
        and u.id <> target_user_id
    ) then
      raise exception 'invalid responsible_user_id replacement in entry_updates';
    end if;
  end loop;

  for item in select * from jsonb_array_elements(walk_updates) loop
    if not exists (
      select 1 from users u
      where u.id = (item->>'responsible_user_id')::uuid
        and u.family_id = target_family
        and u.removed_at is null
        and u.id <> target_user_id
    ) then
      raise exception 'invalid responsible_user_id replacement in walk_updates';
    end if;
  end loop;

  for item in select * from jsonb_array_elements(rule_updates) loop
    update schedule_rules
    set rotation_user_ids = (
      select array_agg(elem::text::uuid)
      from jsonb_array_elements_text(item->'rotation_user_ids') as elem
    )
    where id = (item->>'id')::uuid
      and family_id = target_family;
  end loop;

  for item in select * from jsonb_array_elements(entry_updates) loop
    update schedule_entries
    set responsible_user_id = (item->>'responsible_user_id')::uuid
    where id = (item->>'id')::uuid
      and family_id = target_family;
  end loop;

  for item in select * from jsonb_array_elements(walk_updates) loop
    update walks
    set responsible_user_id = (item->>'responsible_user_id')::uuid,
        updated_at = now()
    where id = (item->>'id')::uuid
      and family_id = target_family;
  end loop;

  update users
  set removed_at = now()
  where id = target_user_id
    and family_id = target_family;

  select id into caller_id from users where auth_user_id = auth.uid() and family_id = target_family;
  perform log_audit_event(target_family, caller_id, 'family_member_removed', 'user', target_user_id, '{}'::jsonb);
end;
$$ language plpgsql volatile security definer set search_path = public;

create or replace function regenerate_invite_code(target_family_id uuid)
returns text as $$
declare
  new_code text;
  attempts int := 0;
  caller_id uuid;
begin
  if not is_family_admin(target_family_id) then
    raise exception 'admin permission required';
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

  select id into caller_id from users where auth_user_id = auth.uid() and family_id = target_family_id;
  perform log_audit_event(target_family_id, caller_id, 'invite_code_rotated', 'family', target_family_id, '{}'::jsonb);

  return new_code;
end;
$$ language plpgsql volatile security definer set search_path = public;

-- ----------------------------------------------------------------------------
-- 8. user_presence — lightweight "last seen" tracking, Admin-only to read
--    (kept as its OWN table rather than a users.last_seen_at column: the
--    existing "select users in own family" policy is family-wide, since
--    every member legitimately needs everyone's name/avatar for rosters and
--    walk rows — adding a presence column directly to `users` would leak it
--    to every member via that same broad policy, not just Admin, which
--    this requirement explicitly rules out ("Admin-only ... in RLS")).
-- ----------------------------------------------------------------------------

create table if not exists user_presence (
  user_id uuid primary key references users(id) on delete cascade,
  family_id uuid not null references families(id) on delete cascade,
  last_seen_at timestamptz not null default now()
);

alter table user_presence enable row level security;

drop policy if exists "read presence (admin or self)" on user_presence;
create policy "read presence (admin or self)" on user_presence
  for select using (
    family_id = current_family_id()
    and (is_family_admin(family_id) or user_id = current_profile_id())
  );
-- No insert/update/delete policy — only touch_last_seen() (below) writes
-- here, self-only, and only for the caller's own claimed profile.

create or replace function touch_last_seen()
returns void as $$
declare
  my_user_id uuid;
  my_family uuid;
begin
  if auth.uid() is null then
    return;
  end if;

  select id, family_id into my_user_id, my_family from users
  where auth_user_id = auth.uid() and family_id = current_family_id() and removed_at is null;

  if my_user_id is null then
    return; -- no active claimed profile yet (e.g. still on "pick your profile") — nothing to record
  end if;

  insert into user_presence (user_id, family_id, last_seen_at)
  values (my_user_id, my_family, now())
  on conflict (user_id) do update set last_seen_at = excluded.last_seen_at, family_id = excluded.family_id;
end;
$$ language plpgsql volatile security definer set search_path = public;

-- Admin-only activity listing. Deliberately returned via a function rather
-- than opened up as a broader SELECT policy on `users`/`family_auth_members`
-- — keeps auth_user_id itself off the wire entirely (requirement: "Do NOT
-- expose raw auth_user_id to normal users"), and self-checks admin
-- permission so this can never be called as a "current family role" oracle
-- by a non-admin device.
create or replace function admin_list_family_activity()
returns table (
  user_id uuid,
  name text,
  avatar text,
  role text,
  removed_at timestamptz,
  last_seen_at timestamptz
) as $$
begin
  if not is_family_admin(current_family_id()) then
    raise exception 'admin permission required';
  end if;

  return query
  select
    u.id,
    u.name,
    u.avatar,
    fam.role,
    u.removed_at,
    up.last_seen_at
  from users u
  left join family_auth_members fam on fam.auth_user_id = u.auth_user_id
  left join user_presence up on up.user_id = u.id
  where u.family_id = current_family_id()
  order by u.removed_at nulls first, up.last_seen_at desc nulls last, u.name;
end;
$$ language plpgsql stable security definer set search_path = public;

-- Admin-only paginated audit log reader (RLS on audit_log already restricts
-- SELECT to admins, but this keeps ordering/pagination in one server-side
-- place and validates limit/offset — "Consider pagination rather than
-- loading an unlimited history.").
create or replace function admin_list_audit_log(p_limit int default 50, p_offset int default 0)
returns table (
  id uuid,
  actor_user_id uuid,
  actor_name text,
  action text,
  target_type text,
  target_id uuid,
  metadata jsonb,
  created_at timestamptz
) as $$
begin
  if not is_family_admin(current_family_id()) then
    raise exception 'admin permission required';
  end if;
  if p_limit < 1 or p_limit > 200 then
    p_limit := 50;
  end if;
  if p_offset < 0 then
    p_offset := 0;
  end if;

  return query
  select al.id, al.actor_user_id, u.name, al.action, al.target_type, al.target_id, al.metadata, al.created_at
  from audit_log al
  left join users u on u.id = al.actor_user_id
  where al.family_id = current_family_id()
  order by al.created_at desc
  limit p_limit offset p_offset;
end;
$$ language plpgsql stable security definer set search_path = public;

-- ----------------------------------------------------------------------------
-- 9. Audit triggers — walks / schedule_rules / users.
--
-- These cover the audit events that (unlike swap/time-change requests,
-- which already go through narrow RPCs) currently happen via ordinary
-- direct table writes from the client: mark-done, add-a-spontaneous-walk,
-- schedule-rule create/edit/delete, and profile edit/claim. Rather than
-- rewriting every one of those call sites into a bespoke RPC just to get an
-- audit line, a row-level AFTER trigger observes the change itself —
-- meaning an event can only ever be logged if the change actually happened
-- (no client can "claim" an event without doing it), and the trigger
-- functions derive the actor from auth.uid()/current_profile_id() (or, for
-- profile_claimed, from the very row being claimed), NEVER from any
-- client-supplied value. This is what "prefer trustworthy server-authored
-- audit events" and "do not trust arbitrary client-supplied actor IDs"
-- mean applied to writes that were never going to become RPCs.
--
-- Every trigger function is SECURITY DEFINER (so it can call the
-- otherwise-locked-down log_audit_event()) with search_path pinned, exactly
-- like the RPCs above.
-- ----------------------------------------------------------------------------

-- 9a. walks — "spontaneous walk added" (on insert of an unplanned walk) and
-- "walk completed" (on the pending -> done transition). A spontaneous walk
-- is inserted already `status = 'done'` (see scheduleStore.addUnplannedWalk),
-- so these two conditions never both fire for the same write — no double
-- logging.
create or replace function audit_walk_change()
returns trigger as $$
begin
  if tg_op = 'INSERT' then
    if new.is_unplanned then
      perform log_audit_event(
        new.family_id, current_profile_id(), 'spontaneous_walk_added', 'walk', new.id,
        jsonb_build_object(
          'date', new.date, 'time', new.scheduled_time,
          'responsible_user_id', new.responsible_user_id,
          'had_pee', new.had_pee, 'had_poop', new.had_poop
        )
      );
    end if;
    return new;
  end if;

  if tg_op = 'UPDATE' and old.status is distinct from new.status and new.status = 'done' then
    perform log_audit_event(
      new.family_id, current_profile_id(), 'walk_completed', 'walk', new.id,
      jsonb_build_object(
        'date', new.date, 'time', new.scheduled_time,
        'completed_by_user_id', new.completed_by_user_id,
        'had_pee', new.had_pee, 'had_poop', new.had_poop
      )
    );
  end if;

  return new;
end;
$$ language plpgsql volatile security definer set search_path = public;

drop trigger if exists walks_audit on walks;
create trigger walks_audit
  after insert or update on walks
  for each row execute function audit_walk_change();

-- 9b. schedule_rules — created / edited / deleted. `current_profile_id()` is
-- still resolvable inside a DELETE trigger (it only depends on auth.uid()
-- and the users table, not on the row being deleted).
create or replace function audit_schedule_rule_change()
returns trigger as $$
declare
  fam uuid;
  actor uuid;
begin
  fam := coalesce(new.family_id, old.family_id);
  actor := current_profile_id();

  if tg_op = 'INSERT' then
    perform log_audit_event(fam, actor, 'schedule_rule_created', 'schedule_rule', new.id,
      jsonb_build_object('time', new.time, 'label', new.label));
    return new;
  elsif tg_op = 'UPDATE' then
    perform log_audit_event(fam, actor, 'schedule_rule_edited', 'schedule_rule', new.id,
      jsonb_build_object('time', new.time, 'label', new.label));
    return new;
  elsif tg_op = 'DELETE' then
    perform log_audit_event(fam, actor, 'schedule_rule_deleted', 'schedule_rule', old.id,
      jsonb_build_object('time', old.time, 'label', old.label));
    return old;
  end if;

  return null;
end;
$$ language plpgsql volatile security definer set search_path = public;

drop trigger if exists schedule_rules_audit on schedule_rules;
create trigger schedule_rules_audit
  after insert or update or delete on schedule_rules
  for each row execute function audit_schedule_rule_change();

-- 9c. users — "profile claimed" and "profile edited".
--
-- profile_claimed fires exactly when auth_user_id transitions from null to
-- non-null (claim_family_profile()'s own guarded UPDATE, or the identical
-- effect of admin-assisted claiming) — the row IS the actor here, since
-- claim_family_profile() only ever lets someone claim a profile as
-- themselves (auth_user_id is set to auth.uid()).
--
-- profile_edited fires on a genuine change to name/avatar/color/photo_url —
-- deliberately EXCLUDING a removed_at transition (admin_delete_family_member()
-- already logs 'family_member_removed' itself; logging both would be a
-- confusing duplicate for the same click) and excluding the claim itself
-- (handled above). The actor is current_profile_id() — the real,
-- currently-authenticated caller — since an edit can legitimately be made
-- either by the member themselves or by an admin editing someone else (the
-- existing "Self + Admin" RLS policy already allows both); target_user_id
-- (new.id) is who was edited, which may differ from the actor.
create or replace function audit_user_profile_change()
returns trigger as $$
begin
  if old.auth_user_id is null and new.auth_user_id is not null then
    perform log_audit_event(new.family_id, new.id, 'profile_claimed', 'user', new.id, '{}'::jsonb);
    return new;
  end if;

  if old.removed_at is null and new.removed_at is not null then
    return new; -- already logged as 'family_member_removed' by the RPC that did this
  end if;

  if old.name is distinct from new.name
     or old.avatar is distinct from new.avatar
     or old.color is distinct from new.color
     or old.photo_url is distinct from new.photo_url then
    perform log_audit_event(new.family_id, current_profile_id(), 'profile_edited', 'user', new.id,
      jsonb_build_object('name', new.name));
  end if;

  return new;
end;
$$ language plpgsql volatile security definer set search_path = public;

drop trigger if exists users_audit on users;
create trigger users_audit
  after update on users
  for each row execute function audit_user_profile_change();

-- ============================================================================
-- Storage — dog & family member photos
--
-- Upload paths are `{familyId}/dog/...` and `{familyId}/users/{userId}/...`
-- (see src/lib/uploadImage.ts) — write policies check the first path segment
-- against current_family_id() so one family can never overwrite/delete
-- another's photos. Reads stay public (the bucket itself is public=true, so
-- a photo's public URL works without auth — same as before); this SELECT
-- policy only governs authenticated API reads, not public-URL access.
-- ============================================================================
insert into storage.buckets (id, name, public)
values ('family-photos', 'family-photos', true)
on conflict (id) do nothing;

create policy "read family photos" on storage.objects
  for select using (bucket_id = 'family-photos');
create policy "upload family photos" on storage.objects
  for insert with check (
    bucket_id = 'family-photos'
    and auth.uid() is not null
    and (storage.foldername(name))[1] = current_family_id()::text
  );
create policy "update family photos" on storage.objects
  for update using (
    bucket_id = 'family-photos' and auth.uid() is not null and (storage.foldername(name))[1] = current_family_id()::text
  )
  with check (
    bucket_id = 'family-photos' and auth.uid() is not null and (storage.foldername(name))[1] = current_family_id()::text
  );
create policy "delete family photos" on storage.objects
  for delete using (
    bucket_id = 'family-photos' and auth.uid() is not null and (storage.foldername(name))[1] = current_family_id()::text
  );

-- ============================================================================
-- Real Admin QA impersonation (from migrations/0006_qa_impersonation.sql)
--
-- Everything below this line is additive on top of 0001-0005 and reflects
-- migration 0006 verbatim (impersonation_sessions, real_current_profile_id()/
-- is_real_family_admin(), active_impersonation_target(), current_profile_id()/
-- is_family_admin() redefined to be impersonation-aware, begin_impersonation()/
-- end_impersonation(), audit_log.impersonated_by_admin_user_id +
-- log_audit_event()/admin_list_audit_log() updated, whoami(), and the seven
-- request/presence RPCs re-declared so their actor resolution routes through
-- current_profile_id() — see that migration file for the full narrative,
-- including the round-2 security-review corrections (the unique
-- one-active-session-per-admin index + advisory lock, and
-- active_impersonation_target()'s family re-validation) already folded into
-- the body below. This file represents the fresh-install schema — 0001-0005
-- were NOT rewritten; see requirement 15 / the round-2 report's "schema.sql
-- sync" note for why 0006 could be folded in directly (it was never deployed,
-- unlike 0001-0005).
-- ============================================================================

-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. impersonation_sessions
--
-- One row per impersonation attempt. `ended_at is null` marks the currently
-- active session, if any, for a given admin_auth_user_id. There is no
-- client-facing RLS policy at all: the client never reads or writes this
-- table directly — every interaction goes through begin_impersonation()/
-- end_impersonation()/active_impersonation_target(), all SECURITY DEFINER,
-- which is what lets those functions see across the whole table (a SELECT
-- policy of "your own rows only" would be redundant with — and could only
-- ever be narrower than — what those functions already enforce, so it's
-- deliberately omitted rather than duplicated).
-- ----------------------------------------------------------------------------

create table if not exists impersonation_sessions (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references families(id) on delete cascade,
  -- The admin DEVICE's own anon auth identity — this is what scopes a
  -- session to "this one device, right now", the same way family_auth_members
  -- and users.auth_user_id already scope membership/claims to a device.
  admin_auth_user_id uuid not null,
  -- The admin's own claimed profile at the moment the session started, if
  -- any (nullable: an admin device that hasn't claimed a profile yet can
  -- still start a session — see begin_impersonation()'s comment). Used only
  -- for audit display, never for authorization.
  admin_user_id uuid references users(id) on delete set null,
  target_user_id uuid not null references users(id) on delete cascade,
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  ended_reason text
);

-- UNIQUE, not just indexed (CORRECTION — see final report's concurrency
-- review): the original draft used a plain, non-unique partial index here,
-- which only sped up the "find my active session" lookup but did nothing to
-- stop two overlapping begin_impersonation() calls from the same admin
-- device (a double-tap, or two requests racing after a slow network) from
-- both reading "no active session yet" and both inserting one — leaving TWO
-- rows with ended_at is null for the same admin_auth_user_id. Nothing reads
-- that row set as a set (every consumer already does `order by started_at
-- desc limit 1`, and end_impersonation() already ends ALL of an admin's
-- active rows, not just the latest — so this could not resurrect an old
-- target after the newest was ended), but two simultaneously "active" rows
-- for one admin is still an invariant violation this migration explicitly
-- promises ("at most one is ever active per admin device") and an
-- ambiguity a future reader of impersonation_sessions should never have to
-- reason about. Making the index UNIQUE turns the race into a clean,
-- guaranteed unique_violation for the losing transaction instead of a
-- silently-accepted duplicate; begin_impersonation() below additionally
-- takes a per-admin advisory lock so the ordinary case never even reaches
-- that error.
create unique index if not exists impersonation_sessions_one_active_per_admin_idx
  on impersonation_sessions (admin_auth_user_id)
  where ended_at is null;

alter table impersonation_sessions enable row level security;
-- Intentionally zero policies: RLS is enabled (so a misconfigured future
-- grant fails closed) but there is no SELECT/INSERT/UPDATE/DELETE policy
-- for role `authenticated` — all access is via the SECURITY DEFINER
-- functions below, which run with the table owner's privileges regardless
-- of RLS. This mirrors audit_log's own "no insert policy at all" pattern
-- from 0005.

-- ----------------------------------------------------------------------------
-- 2. is_real_family_admin() / real_current_profile_id() — the ORIGINAL
-- is_family_admin()/current_profile_id() logic, verbatim, kept under new
-- names before section 4 redefines the original names to be
-- impersonation-aware. Without this, begin_impersonation() checking
-- "is the caller an admin" would be checking the ALREADY-impersonation-aware
-- version — which, during an existing session, reports false for an admin
-- who legitimately needs to end (or replace) that very session. Ending your
-- own impersonation must never depend on not currently being impersonated.
-- ----------------------------------------------------------------------------

create or replace function real_current_profile_id()
returns uuid as $$
  select id from users
  where auth_user_id = auth.uid()
    and family_id = current_family_id()
    and removed_at is null
  limit 1;
$$ language sql stable security definer set search_path = public;

create or replace function is_real_family_admin(target_family_id uuid)
returns boolean as $$
  select exists (
    select 1
    from family_auth_members
    where auth_user_id = auth.uid()
      and family_id = target_family_id
      and role = 'admin'
  );
$$ language sql stable security definer set search_path = public;

-- ----------------------------------------------------------------------------
-- 3. active_impersonation_target() — resolves to the target member's id if
-- THIS auth.uid() currently has an active (ended_at is null) impersonation
-- session, re-validated on EVERY call against three independent conditions:
-- the session's own family_id still matches this device's CURRENT
-- current_family_id() (not just whatever it was when the session began);
-- the target's users.family_id still matches the session's family_id (in
-- case the target itself was ever moved between families); and the target
-- is still an active (not removed) member. Any of these failing resolves to
-- NULL — current_profile_id() then falls back to the admin's own real
-- profile — rather than an impersonation session ever resolving to a
-- removed user or a stale, no-longer-current family: fail-closed, not
-- fail-open.
--
-- CORRECTION from the original draft (see final report's security review):
-- the first draft deliberately skipped the `s.family_id = current_family_id()`
-- check, reasoning that the admin's device family "cannot change without
-- going through setFamilyId()/join_family()". That reasoning does not hold
-- up as a SERVER-side guarantee — it only describes how the CLIENT is
-- expected to behave, and this function must not rely on client behavior
-- for anything authorization-relevant (the same principle this whole
-- feature exists to enforce for the client's actor id). If this device's
-- family_auth_members row is ever repointed at a different family — by a
-- future client bug, a manual/support intervention, or any path this
-- migration didn't anticipate — while a session is active, that stale
-- session must stop resolving immediately rather than silently keep
-- authorizing the caller as a member of a family it may no longer even
-- belong to. Re-deriving current_family_id() fresh on every call (rather
-- than trusting impersonation_sessions.family_id alone) is what makes this
-- re-validation actually authoritative.
-- ----------------------------------------------------------------------------

create or replace function active_impersonation_target()
returns uuid as $$
  select s.target_user_id
  from impersonation_sessions s
  join users u on u.id = s.target_user_id
  where s.admin_auth_user_id = auth.uid()
    and s.ended_at is null
    and s.family_id = current_family_id()
    and u.family_id = s.family_id
    and u.removed_at is null
  order by s.started_at desc
  limit 1;
$$ language sql stable security definer set search_path = public;

-- ----------------------------------------------------------------------------
-- 4. current_profile_id() / is_family_admin() — redefined to be
-- impersonation-aware. Because every existing RLS policy and RPC across
-- 0002-0005 calls current_profile_id() and/or is_family_admin() BY NAME
-- (Postgres resolves a function call by name at execution time, not at the
-- caller's own CREATE time), this one change is what makes request
-- creation, swap/time-change requests, presence, and the walks/
-- schedule_entries write-authorization trigger's admin bypass all
-- automatically respect an active impersonation session — without editing
-- 0002-0005 at all.
--
-- current_family_role() (0003) is DELIBERATELY left unchanged: it is a
-- read-only, client-facing convenience (authStore.familyRole, used only to
-- decide which UI to render) and is never consulted by any RLS policy or
-- RPC's authorization check — every real check goes through
-- is_family_admin(). The client instead overlays the EFFECTIVE role
-- ('member' while impersonating) purely client-side, the same way it
-- already does for Admin Test Mode's testModeUserId (see
-- useEffectiveFamilyRole() in authStore.ts) — so the real admin's own
-- familyRole stays accurate and usable the moment they end the session.
-- ----------------------------------------------------------------------------

create or replace function current_profile_id()
returns uuid as $$
  select coalesce(active_impersonation_target(), real_current_profile_id());
$$ language sql stable security definer set search_path = public;

create or replace function is_family_admin(target_family_id uuid)
returns boolean as $$
  select case
    when active_impersonation_target() is not null then false
    else is_real_family_admin(target_family_id)
  end;
$$ language sql stable security definer set search_path = public;

-- ----------------------------------------------------------------------------
-- 5. begin_impersonation(p_target_user_id) / end_impersonation()
--
-- begin_impersonation is intentionally NOT idempotent-merge with an
-- existing session for a DIFFERENT target: starting a new session while one
-- is already active for this device first force-ends the old one
-- ('superseded'), so at most one is ever active per admin device — the
-- client is expected to call end_impersonation() explicitly when the admin
-- taps "exit", but this is a server-side backstop against ever stacking two
-- active sessions (which active_impersonation_target()'s `order by
-- started_at desc limit 1` would otherwise paper over ambiguously).
--
-- CONCURRENCY (see final report / the unique index above): two
-- begin_impersonation() calls from the same admin device racing each other
-- (double-tap, retried request) would otherwise both see "no active session
-- for me yet" and both insert one. pg_advisory_xact_lock serializes them —
-- the second caller blocks until the first's transaction commits (or rolls
-- back), by which point the first session's row is either durably there or
-- gone, so the second call always makes its UPDATE/INSERT decision against
-- an up-to-date, fully-committed view. The unique partial index is the
-- backstop if this lock is ever bypassed (e.g. a future direct SQL caller);
-- either layer alone is sufficient, together they guarantee it.
-- ----------------------------------------------------------------------------

create or replace function begin_impersonation(p_target_user_id uuid)
returns uuid as $$
declare
  fam uuid;
  admin_profile uuid;
  target_family uuid;
  target_removed_at timestamptz;
  new_id uuid;
begin
  if auth.uid() is null then
    raise exception 'must be authenticated';
  end if;

  -- Transaction-scoped advisory lock, released automatically on commit/
  -- rollback — never needs an explicit unlock. hashtext() on the admin's own
  -- auth.uid() keys the lock per-admin so unrelated admins (or the same
  -- admin's own begin/end calls made sequentially, once each prior
  -- transaction has committed) never contend with each other.
  perform pg_advisory_xact_lock(hashtext(auth.uid()::text));

  fam := current_family_id();
  if fam is null then
    raise exception 'this device is not a member of a family';
  end if;

  -- MUST be the real, impersonation-unaware admin check: this is how an
  -- admin can always start (or replace) a session regardless of whether one
  -- happens to already be active for their device.
  if not is_real_family_admin(fam) then
    raise exception 'only a family admin may start real-user QA testing';
  end if;

  select family_id, removed_at into target_family, target_removed_at
  from users
  where id = p_target_user_id;

  if target_family is null then
    raise exception 'member not found';
  end if;
  if target_family is distinct from fam then
    raise exception 'you can only test as a member of your own family';
  end if;
  if target_removed_at is not null then
    raise exception 'cannot test as a removed member';
  end if;

  admin_profile := real_current_profile_id();
  if admin_profile is not null and admin_profile = p_target_user_id then
    raise exception 'you are already this profile — nothing to test';
  end if;

  update impersonation_sessions
  set ended_at = now(), ended_reason = 'superseded'
  where admin_auth_user_id = auth.uid() and ended_at is null;

  insert into impersonation_sessions (family_id, admin_auth_user_id, admin_user_id, target_user_id)
  values (fam, auth.uid(), admin_profile, p_target_user_id)
  returning id into new_id;

  perform log_audit_event(
    fam, admin_profile, 'impersonation_started', 'user', p_target_user_id,
    jsonb_build_object('session_id', new_id)
  );

  return new_id;
end;
$$ language plpgsql volatile security definer set search_path = public;

-- end_impersonation() is deliberately a safe no-op (never raises) when there
-- is nothing to end: authStore.restoreSession() calls this unconditionally,
-- best-effort, on EVERY cold start (see section 7's comment and the final
-- report) specifically so an app restart can never leave a stale
-- server-side session silently active while the client's own in-memory
-- impersonation state (never persisted — see authStore.ts) has already
-- reset to "not impersonating". Raising here on the (extremely common)
-- "nothing active" case would turn that safety net into log noise/an error
-- the client would have to swallow anyway.
create or replace function end_impersonation()
returns void as $$
declare
  fam uuid;
  target uuid;
  admin_profile uuid;
begin
  if auth.uid() is null then
    return;
  end if;

  select family_id, target_user_id into fam, target
  from impersonation_sessions
  where admin_auth_user_id = auth.uid() and ended_at is null
  order by started_at desc
  limit 1;

  if fam is null then
    return;
  end if;

  update impersonation_sessions
  set ended_at = now(), ended_reason = coalesce(ended_reason, 'ended_by_admin')
  where admin_auth_user_id = auth.uid() and ended_at is null;

  admin_profile := real_current_profile_id();
  perform log_audit_event(fam, admin_profile, 'impersonation_ended', 'user', target, '{}'::jsonb);
end;
$$ language plpgsql volatile security definer set search_path = public;

-- ----------------------------------------------------------------------------
-- 6. AUDIT ATTRIBUTION: audit_log gains a column recording which real admin
-- (if any) was impersonating when a row was logged, so no QA action can
-- ever look indistinguishable from one genuinely performed on the member's
-- own device. Every existing call site of log_audit_event() (swap/
-- time-change create/approve/reject, the walk/schedule-rule/profile audit
-- triggers in 0005) already passes p_actor_user_id = current_profile_id()
-- unchanged — which, per section 4, now correctly resolves to the
-- IMPERSONATED member during a session — so actor_user_id keeps meaning
-- "who this action is really attributed to" (correct: the member's own
-- pending swap request should show as requested by the member, not the
-- admin, or the target member's approval routing and the admin's own
-- time-change inbox would both misroute). log_audit_event() itself
-- separately captures the TRUE admin via real_current_profile_id() when
-- active_impersonation_target() is non-null — this is the ONE place that
-- needed to change for every existing call site to get this for free.
-- ----------------------------------------------------------------------------

alter table audit_log
  add column if not exists impersonated_by_admin_user_id uuid references users(id) on delete set null;

create or replace function log_audit_event(
  p_family_id uuid,
  p_actor_user_id uuid,
  p_action text,
  p_target_type text,
  p_target_id uuid,
  p_metadata jsonb default '{}'::jsonb
)
returns void as $$
declare
  v_admin uuid;
begin
  v_admin := null;
  if active_impersonation_target() is not null then
    v_admin := real_current_profile_id();
  end if;

  insert into audit_log (family_id, actor_user_id, action, target_type, target_id, metadata, impersonated_by_admin_user_id)
  values (p_family_id, p_actor_user_id, p_action, p_target_type, p_target_id, p_metadata, v_admin);
end;
$$ language plpgsql volatile security definer set search_path = public;

-- CREATE OR REPLACE does not reset previously-granted/revoked privileges
-- (they attach to the function's OID, not its body), so 0005's `revoke all
-- ... from public` on this function already still applies — this repeats it
-- anyway, harmlessly, as a explicit safety net for a from-scratch deploy.
revoke all on function log_audit_event(uuid, uuid, text, text, uuid, jsonb) from public;

-- admin_list_audit_log()'s own permission check (is_family_admin(), see
-- section 4) already means an admin actively impersonating cannot call this
-- at all — consistent with the rest of this feature suppressing admin-only
-- powers for the duration of a session (end the session first to review the
-- log). This is a deliberate design choice, not an oversight — see the
-- final report.
drop function if exists public.admin_list_audit_log(integer, integer);
create function admin_list_audit_log(p_limit int default 50, p_offset int default 0)
returns table (
  id uuid,
  actor_user_id uuid,
  actor_name text,
  action text,
  target_type text,
  target_id uuid,
  metadata jsonb,
  created_at timestamptz,
  impersonated_by_admin_user_id uuid,
  impersonated_by_admin_name text
) as $$
begin
  if not is_family_admin(current_family_id()) then
    raise exception 'admin permission required';
  end if;
  if p_limit < 1 or p_limit > 200 then
    p_limit := 50;
  end if;
  if p_offset < 0 then
    p_offset := 0;
  end if;

  return query
  select al.id, al.actor_user_id, u.name, al.action, al.target_type, al.target_id, al.metadata, al.created_at,
         al.impersonated_by_admin_user_id, admin_u.name
  from audit_log al
  left join users u on u.id = al.actor_user_id
  left join users admin_u on admin_u.id = al.impersonated_by_admin_user_id
  where al.family_id = current_family_id()
  order by al.created_at desc
  limit p_limit offset p_offset;
end;
$$ language plpgsql stable security definer set search_path = public;

-- ----------------------------------------------------------------------------
-- 7. whoami() — ONE lightweight, client-callable round trip combining
-- everything authStore needs to (a) detect a stale/orphaned local claim
-- (see the Idan investigation in the final report: restoreSession()
-- previously trusted the locally-cached currentUserId with no server
-- round-trip at all) and (b) confirm/refresh impersonation UI state after a
-- foreground transition, in one call instead of several.
-- ----------------------------------------------------------------------------

create or replace function whoami()
returns table (
  profile_id uuid,
  real_profile_id uuid,
  family_role text,
  is_impersonating boolean,
  impersonated_user_id uuid
) as $$
declare
  v_target uuid;
begin
  v_target := active_impersonation_target();
  return query select
    coalesce(v_target, real_current_profile_id()) as profile_id,
    real_current_profile_id() as real_profile_id,
    current_family_role() as family_role,
    (v_target is not null) as is_impersonating,
    v_target as impersonated_user_id;
end;
$$ language plpgsql stable security definer set search_path = public;

-- ----------------------------------------------------------------------------
-- 8. Re-declared request/presence RPCs — see the header comment above for
-- why this section exists. Every line below is byte-identical to the
-- deployed 0005 version EXCEPT the actor-resolution block at the top of
-- each function (marked with a "-- CHANGED (0006)" comment) and this
-- section's own explanatory comments. In particular: every validation
-- rule, every raised error message/text, every table touched, and every
-- log_audit_event() call is UNCHANGED — so, for example,
-- claimErrorMessage()'s existing 'no active profile claimed on this family'
-- handling and every existing manual test's "-- expect:" assertions against
-- these functions still hold exactly as before when no impersonation
-- session is active (current_profile_id() falls back to
-- real_current_profile_id(), which IS the original inline query).
-- ----------------------------------------------------------------------------

create or replace function create_swap_request(p_walk_id uuid, p_target_user_id uuid)
returns uuid as $$
declare
  me uuid;
  my_family uuid;
  w record;
  new_id uuid;
begin
  -- CHANGED (0006): was an inline `select id, family_id into me, my_family
  -- from users where auth_user_id = auth.uid() and removed_at is null and
  -- family_id = current_family_id()`.
  me := current_profile_id();
  if me is null then
    raise exception 'no active profile claimed on this family';
  end if;
  my_family := current_family_id();

  select * into w from walks where id = p_walk_id;
  if w.id is null or w.family_id is distinct from my_family then
    raise exception 'walk not found in this family';
  end if;
  if w.status <> 'pending' then
    raise exception 'walk is no longer pending';
  end if;
  if w.responsible_user_id <> me then
    raise exception 'you can only request a swap for a walk you are responsible for';
  end if;

  if p_target_user_id = me then
    raise exception 'choose a different family member';
  end if;
  if not exists (
    select 1 from users where id = p_target_user_id and family_id = my_family and removed_at is null
  ) then
    raise exception 'target member is not an active member of this family';
  end if;

  if exists (
    select 1 from walk_swap_requests
    where walk_id = p_walk_id and status = 'pending'
  ) then
    raise exception 'a pending swap request already exists for this walk';
  end if;

  insert into walk_swap_requests (
    family_id, walk_id, requested_by_user_id, target_user_id,
    expected_responsible_user_id, expected_status, expected_scheduled_time
  ) values (
    my_family, p_walk_id, me, p_target_user_id, w.responsible_user_id, w.status, w.scheduled_time
  ) returning id into new_id;

  perform log_audit_event(my_family, me, 'swap_request_created', 'walk', p_walk_id,
    jsonb_build_object('request_id', new_id, 'target_user_id', p_target_user_id));

  return new_id;
end;
$$ language plpgsql volatile security definer set search_path = public;

create or replace function approve_swap_request(p_request_id uuid)
returns void as $$
declare
  me uuid;
  req record;
  w record;
begin
  -- CHANGED (0006): was an inline `select id into me from users where
  -- auth_user_id = auth.uid() and removed_at is null and family_id =
  -- current_family_id()`.
  me := current_profile_id();
  if me is null then
    raise exception 'no active profile claimed on this family';
  end if;

  select * into req from walk_swap_requests where id = p_request_id for update;
  if req.id is null or req.family_id is distinct from current_family_id() then
    raise exception 'request not found in this family';
  end if;
  if req.target_user_id <> me then
    raise exception 'only the requested member can approve this swap';
  end if;

  if req.status = 'approved' then
    return;
  end if;
  if req.status = 'rejected' then
    raise exception 'this request was already rejected';
  end if;

  select * into w from walks where id = req.walk_id for update;
  if w.id is null
     or w.status <> 'pending'
     or w.responsible_user_id <> req.expected_responsible_user_id
     or w.scheduled_time <> req.expected_scheduled_time then
    raise exception 'the walk has changed since this request was created and can no longer be approved';
  end if;
  if not exists (select 1 from users where id = req.target_user_id and family_id = req.family_id and removed_at is null) then
    raise exception 'you are no longer an active member of this family';
  end if;

  perform set_config('app.trusted_write', 'on', true);
  update walks
  set responsible_user_id = req.target_user_id,
      swap_original_user_id = coalesce(w.swap_original_user_id, w.responsible_user_id),
      swap_new_user_id = req.target_user_id,
      swap_swapped_at = now(),
      swap_swapped_by_user_id = req.target_user_id,
      updated_at = now()
  where id = w.id;
  perform set_config('app.trusted_write', 'off', true);

  update walk_swap_requests
  set status = 'approved', resolved_at = now(), resolved_by_user_id = me
  where id = p_request_id;

  perform log_audit_event(req.family_id, me, 'swap_request_approved', 'walk', w.id,
    jsonb_build_object('request_id', p_request_id, 'requested_by_user_id', req.requested_by_user_id));
end;
$$ language plpgsql volatile security definer set search_path = public;

create or replace function reject_swap_request(p_request_id uuid)
returns void as $$
declare
  me uuid;
  req record;
begin
  -- CHANGED (0006): was an inline `select id into me from users where
  -- auth_user_id = auth.uid() and removed_at is null and family_id =
  -- current_family_id()`.
  me := current_profile_id();
  if me is null then
    raise exception 'no active profile claimed on this family';
  end if;

  select * into req from walk_swap_requests where id = p_request_id for update;
  if req.id is null or req.family_id is distinct from current_family_id() then
    raise exception 'request not found in this family';
  end if;
  if req.target_user_id <> me then
    raise exception 'only the requested member can reject this swap';
  end if;

  if req.status = 'rejected' then
    return; -- idempotent
  end if;
  if req.status = 'approved' then
    raise exception 'this request was already approved';
  end if;

  update walk_swap_requests
  set status = 'rejected', resolved_at = now(), resolved_by_user_id = me
  where id = p_request_id;

  perform log_audit_event(req.family_id, me, 'swap_request_rejected', 'walk', req.walk_id,
    jsonb_build_object('request_id', p_request_id, 'requested_by_user_id', req.requested_by_user_id));
end;
$$ language plpgsql volatile security definer set search_path = public;

create or replace function create_time_change_request(p_walk_id uuid, p_proposed_time text)
returns uuid as $$
declare
  me uuid;
  my_family uuid;
  w record;
  new_id uuid;
begin
  if p_proposed_time !~ '^([01]\d|2[0-3]):[0-5]\d$' then
    raise exception 'invalid time format';
  end if;

  -- CHANGED (0006): was an inline `select id, family_id into me, my_family
  -- from users where auth_user_id = auth.uid() and removed_at is null and
  -- family_id = current_family_id()`.
  me := current_profile_id();
  if me is null then
    raise exception 'no active profile claimed on this family';
  end if;
  my_family := current_family_id();

  select * into w from walks where id = p_walk_id;
  if w.id is null or w.family_id is distinct from my_family then
    raise exception 'walk not found in this family';
  end if;
  if w.status <> 'pending' then
    raise exception 'walk is no longer pending';
  end if;
  if w.responsible_user_id <> me then
    raise exception 'you can only request a time change for a walk you are responsible for';
  end if;
  if p_proposed_time = w.scheduled_time then
    raise exception 'that is already this walk''s time';
  end if;

  if exists (
    select 1 from time_change_requests where walk_id = p_walk_id and status = 'pending'
  ) then
    raise exception 'a pending time-change request already exists for this walk';
  end if;

  insert into time_change_requests (family_id, walk_id, requested_by_user_id, proposed_time, expected_time)
  values (my_family, p_walk_id, me, p_proposed_time, w.scheduled_time)
  returning id into new_id;

  perform log_audit_event(my_family, me, 'time_change_request_created', 'walk', p_walk_id,
    jsonb_build_object('request_id', new_id, 'proposed_time', p_proposed_time));

  return new_id;
end;
$$ language plpgsql volatile security definer set search_path = public;

create or replace function approve_time_change_request(p_request_id uuid)
returns void as $$
declare
  me uuid;
  req record;
  w record;
begin
  -- CHANGED (0006): was an inline `select id into me from users where
  -- auth_user_id = auth.uid() and removed_at is null and family_id =
  -- current_family_id()`.
  me := current_profile_id();
  if me is null then
    raise exception 'no active profile claimed on this family';
  end if;

  select * into req from time_change_requests where id = p_request_id for update;
  if req.id is null or req.family_id is distinct from current_family_id() then
    raise exception 'request not found in this family';
  end if;
  if not is_family_admin(req.family_id) then
    raise exception 'admin permission required';
  end if;

  if req.status = 'approved' then
    return; -- idempotent
  end if;
  if req.status = 'rejected' then
    raise exception 'this request was already rejected';
  end if;

  select * into w from walks where id = req.walk_id for update;
  if w.id is null
     or w.status <> 'pending'
     or w.scheduled_time <> req.expected_time
     or w.responsible_user_id <> req.requested_by_user_id then
    raise exception 'the walk has changed since this request was created and can no longer be approved';
  end if;

  perform set_config('app.trusted_write', 'on', true);
  if w.schedule_entry_id is not null then
    if exists (
      select 1 from schedule_entries se
      where se.dog_id = w.dog_id
        and se.date = w.date
        and se.time = req.proposed_time
        and se.id <> w.schedule_entry_id
    ) then
      perform set_config('app.trusted_write', 'off', true);
      raise exception 'that time is already taken by another scheduled walk';
    end if;
    update schedule_entries set time = req.proposed_time where id = w.schedule_entry_id;
  end if;

  update walks
  set scheduled_time = req.proposed_time, updated_at = now()
  where id = w.id;
  perform set_config('app.trusted_write', 'off', true);

  update time_change_requests
  set status = 'approved', resolved_at = now(), resolved_by_user_id = me
  where id = p_request_id;

  perform log_audit_event(req.family_id, me, 'time_change_request_approved', 'walk', w.id,
    jsonb_build_object('request_id', p_request_id, 'proposed_time', req.proposed_time));
end;
$$ language plpgsql volatile security definer set search_path = public;

create or replace function reject_time_change_request(p_request_id uuid)
returns void as $$
declare
  me uuid;
  req record;
begin
  -- CHANGED (0006): was an inline `select id into me from users where
  -- auth_user_id = auth.uid() and removed_at is null and family_id =
  -- current_family_id()`.
  me := current_profile_id();
  if me is null then
    raise exception 'no active profile claimed on this family';
  end if;

  select * into req from time_change_requests where id = p_request_id for update;
  if req.id is null or req.family_id is distinct from current_family_id() then
    raise exception 'request not found in this family';
  end if;
  if not is_family_admin(req.family_id) then
    raise exception 'admin permission required';
  end if;

  if req.status = 'rejected' then
    return; -- idempotent
  end if;
  if req.status = 'approved' then
    raise exception 'this request was already approved';
  end if;

  update time_change_requests
  set status = 'rejected', resolved_at = now(), resolved_by_user_id = me
  where id = p_request_id;

  perform log_audit_event(req.family_id, me, 'time_change_request_rejected', 'walk', req.walk_id,
    jsonb_build_object('request_id', p_request_id));
end;
$$ language plpgsql volatile security definer set search_path = public;

create or replace function touch_last_seen()
returns void as $$
declare
  my_user_id uuid;
  my_family uuid;
begin
  if auth.uid() is null then
    return;
  end if;

  -- CHANGED (0006): was an inline `select id, family_id into my_user_id,
  -- my_family from users where auth_user_id = auth.uid() and family_id =
  -- current_family_id() and removed_at is null`.
  my_user_id := current_profile_id();
  my_family := current_family_id();

  if my_user_id is null then
    return; -- no active claimed profile yet (e.g. still on "pick your profile") — nothing to record
  end if;

  insert into user_presence (user_id, family_id, last_seen_at)
  values (my_user_id, my_family, now())
  on conflict (user_id) do update set last_seen_at = excluded.last_seen_at, family_id = excluded.family_id;
end;
$$ language plpgsql volatile security definer set search_path = public;

-- ============================================================================
-- Migration 0007 appended below (supabase/migrations/0007_multi_admin_roles.sql)
-- ============================================================================
-- ============================================================================
-- 0007_multi_admin_roles.sql
--
-- Round 6, Priority B2: multiple Admins per family.
--
-- Adds one new SECURITY DEFINER RPC, set_member_role(), that lets an existing
-- Admin promote a Member to Admin or demote an Admin to Member, safely:
--   - only an existing Admin of the SAME family may call it (server-side
--     check via is_family_admin(), never trusted from the client) — and,
--     per 0006, is_family_admin() already returns false for the duration of
--     an impersonation session, so an impersonated member can never reach
--     this even indirectly;
--   - the target must be an ACTIVE (not removed) member of that admin's
--     family;
--   - a change that would leave the family with ZERO Admins is rejected —
--     this covers both "the last Admin demotes themselves" and "the last
--     Admin demotes the only other Admin", by counting active Admins
--     EXCLUDING the target row and requiring at least one remain (or the
--     target's own new role to still be admin);
--   - every change is written to audit_log via the existing log_audit_event()
--     (0005/0006) — no new audit mechanism invented.
--
-- Role is stored per `family_auth_members.auth_user_id` (0003), not per
-- `users.id` — a family can in principle have more auth sessions than
-- profiles. set_member_role() takes a `users.id` (matching the existing
-- admin_delete_family_member() convention from 0004) and resolves the
-- corresponding auth_user_id server-side.
--
-- Concurrency: mirrors begin_impersonation()'s pg_advisory_xact_lock pattern
-- (0006) — two admins racing to demote each other, or an admin racing a
-- demote against another admin's self-demotion, must not both observe
-- ">= 1 admin remaining" from a stale read and jointly zero the family out.
-- The lock is keyed per-family so unrelated families never contend.
--
-- Rollback note: to remove this feature, `drop function if exists
-- set_member_role(uuid, text);` — no table/column changes to undo.
-- ============================================================================

create or replace function set_member_role(p_user_id uuid, p_role text)
returns void as $$
declare
  admin_profile uuid;
  target_family uuid;
  target_auth_user_id uuid;
  target_removed_at timestamptz;
  current_role text;
  remaining_admins int;
begin
  if p_role not in ('admin', 'member') then
    raise exception 'invalid role';
  end if;

  admin_profile := current_profile_id();
  if admin_profile is null then
    raise exception 'no active profile claimed on this family';
  end if;

  select family_id, auth_user_id, removed_at
    into target_family, target_auth_user_id, target_removed_at
  from users
  where id = p_user_id;

  if target_family is null then
    raise exception 'user not found';
  end if;

  if target_family is distinct from current_family_id() then
    raise exception 'user not found';
  end if;

  -- Server-side only — never trust a client-supplied "I am an admin" claim.
  -- Also fails closed while impersonating (is_family_admin() returns false
  -- during an impersonation session — see 0006).
  if not is_family_admin(target_family) then
    raise exception 'admin permission required';
  end if;

  if target_removed_at is not null then
    raise exception 'cannot change the role of a removed member';
  end if;

  if target_auth_user_id is null then
    raise exception 'target member has no linked auth session';
  end if;

  -- Serialize concurrent role changes within this family (see comment above).
  perform pg_advisory_xact_lock(hashtext('set_member_role:' || target_family::text));

  select role into current_role from family_auth_members where auth_user_id = target_auth_user_id;
  if current_role is null then
    raise exception 'target member has no linked auth session';
  end if;

  if current_role = p_role then
    return; -- no-op, nothing to do or audit
  end if;

  -- Zero-admin guard: count active admins in this family EXCLUDING the
  -- target's current row, then decide if the family still has >= 1 admin
  -- after applying p_role to the target.
  select count(*) into remaining_admins
  from family_auth_members fam
  join users u on u.auth_user_id = fam.auth_user_id
  where fam.family_id = target_family
    and fam.role = 'admin'
    and fam.auth_user_id <> target_auth_user_id
    and u.removed_at is null;

  if p_role = 'member' and remaining_admins = 0 then
    raise exception 'cannot demote the last admin of this family';
  end if;

  update family_auth_members
  set role = p_role
  where auth_user_id = target_auth_user_id;

  perform log_audit_event(
    target_family,
    admin_profile,
    case when p_role = 'admin' then 'member_promoted_to_admin' else 'admin_demoted_to_member' end,
    'user',
    p_user_id,
    jsonb_build_object('previous_role', current_role, 'new_role', p_role)
  );
end;
$$ language plpgsql volatile security definer set search_path = public;

-- No RLS-level grant needed beyond the default (any authenticated user may
-- attempt to call this function — it is safe to call because every actual
-- authorization check happens INSIDE it, exactly like admin_delete_family_member()).

-- ----------------------------------------------------------------------------
-- Last-admin-removal guard on admin_delete_family_member() (0004).
--
-- 0004's admin_delete_family_member() did not guard against removing the
-- family's only Admin (multi-admin didn't exist yet, so this could only ever
-- remove a Member). Now that a family can have more than one Admin, removing
-- one must be blocked the same way demoting the last one is (see
-- set_member_role() above) — following this codebase's own established
-- pattern (0006 already layers `create or replace function` redefinitions of
-- earlier migrations' functions rather than editing the immutable files
-- directly). Everything else about the function is UNCHANGED — copied
-- verbatim from 0004 with only the new guard inserted.
-- ----------------------------------------------------------------------------

create or replace function admin_delete_family_member(
  target_user_id uuid,
  rule_updates jsonb default '[]'::jsonb,
  entry_updates jsonb default '[]'::jsonb,
  walk_updates jsonb default '[]'::jsonb
)
returns void as $$
declare
  target_family uuid;
  target_auth_user_id uuid;
  item jsonb;
  elem text;
  remaining_admins int;
begin
  if auth.uid() is null then
    raise exception 'must be authenticated';
  end if;

  select family_id, auth_user_id into target_family, target_auth_user_id from users where id = target_user_id;
  if target_family is null then
    raise exception 'user not found';
  end if;

  if target_family is distinct from current_family_id() then
    raise exception 'not a member of this user''s family';
  end if;

  if not is_family_admin(target_family) then
    raise exception 'admin permission required';
  end if;

  -- NEW (0007): removing the family's last remaining Admin must be
  -- rejected, exactly like demoting them would be — a family with zero
  -- Admins can never manage roles/removals again.
  if target_auth_user_id is not null then
    perform pg_advisory_xact_lock(hashtext('set_member_role:' || target_family::text));

    select count(*) into remaining_admins
    from family_auth_members fam
    join users u on u.auth_user_id = fam.auth_user_id
    where fam.family_id = target_family
      and fam.role = 'admin'
      and fam.auth_user_id <> target_auth_user_id
      and u.removed_at is null;

    if remaining_admins = 0
      and exists (select 1 from family_auth_members where auth_user_id = target_auth_user_id and role = 'admin')
    then
      raise exception 'cannot remove the last admin of this family';
    end if;
  end if;

  -- Validate EVERY replacement user id in the client-supplied JSON before
  -- applying anything. This RPC is SECURITY DEFINER, so it runs with more
  -- privilege than RLS would otherwise grant the caller — the *_updates
  -- payloads must not be trusted just because the caller is confirmed to be
  -- an admin of this family. Each replacement responsible_user_id /
  -- rotation_user_ids entry must reference a user that: exists, belongs to
  -- target_family (never a different family), is active (removed_at is
  -- null — never a previously-removed member), and is not target_user_id
  -- itself (the member being removed can't be their own replacement).
  -- Any violation aborts the whole call (raise exception rolls back the
  -- implicit transaction) rather than partially applying a bad payload.
  for item in select * from jsonb_array_elements(rule_updates) loop
    for elem in select * from jsonb_array_elements_text(item->'rotation_user_ids') loop
      if not exists (
        select 1 from users u
        where u.id = elem::uuid
          and u.family_id = target_family
          and u.removed_at is null
          and u.id <> target_user_id
      ) then
        raise exception 'invalid rotation_user_ids replacement in rule_updates';
      end if;
    end loop;
  end loop;

  for item in select * from jsonb_array_elements(entry_updates) loop
    if not exists (
      select 1 from users u
      where u.id = (item->>'responsible_user_id')::uuid
        and u.family_id = target_family
        and u.removed_at is null
        and u.id <> target_user_id
    ) then
      raise exception 'invalid responsible_user_id replacement in entry_updates';
    end if;
  end loop;

  for item in select * from jsonb_array_elements(walk_updates) loop
    if not exists (
      select 1 from users u
      where u.id = (item->>'responsible_user_id')::uuid
        and u.family_id = target_family
        and u.removed_at is null
        and u.id <> target_user_id
    ) then
      raise exception 'invalid responsible_user_id replacement in walk_updates';
    end if;
  end loop;

  for item in select * from jsonb_array_elements(rule_updates) loop
    update schedule_rules
    set rotation_user_ids = (
      select array_agg(elem::text::uuid)
      from jsonb_array_elements_text(item->'rotation_user_ids') as elem
    )
    where id = (item->>'id')::uuid
      and family_id = target_family;
  end loop;

  for item in select * from jsonb_array_elements(entry_updates) loop
    update schedule_entries
    set responsible_user_id = (item->>'responsible_user_id')::uuid
    where id = (item->>'id')::uuid
      and family_id = target_family;
  end loop;

  for item in select * from jsonb_array_elements(walk_updates) loop
    update walks
    set responsible_user_id = (item->>'responsible_user_id')::uuid,
        updated_at = now()
    where id = (item->>'id')::uuid
      and family_id = target_family;
  end loop;

  update users
  set removed_at = now()
  where id = target_user_id
    and family_id = target_family;
end;
$$ language plpgsql volatile security definer;


-- ============================================================================
-- Migration 0018 — mutual exact-walk swap requests
-- ============================================================================
-- 0018_mutual_walk_swap_requests.sql
-- A swap request now names TWO exact pending walks. Approval exchanges the
-- responsible users on both walks and their backing schedule_entries in one
-- transaction. Existing one-sided pending requests cannot be safely inferred,
-- so they are closed as rejected during this migration; resolved history stays.

alter table walk_swap_requests
  add column if not exists expected_scheduled_time text,
  add column if not exists target_walk_id uuid references walks(id) on delete cascade,
  add column if not exists expected_target_responsible_user_id uuid,
  add column if not exists expected_target_status text,
  add column if not exists expected_target_scheduled_time text;

create index if not exists walk_swap_requests_target_walk_id_idx
  on walk_swap_requests(target_walk_id);

-- Legacy pending rows name a person but not a specific reciprocal walk.
update walk_swap_requests
set status = 'rejected', resolved_at = coalesce(resolved_at, now())
where status = 'pending' and target_walk_id is null;

-- Same SQL type signature as the old function, but the second UUID now means
-- target WALK rather than target USER. DROP is required because PostgreSQL
-- does not allow renaming an input parameter via CREATE OR REPLACE.
drop function if exists create_swap_request(uuid, uuid);

create function create_swap_request(p_walk_id uuid, p_target_walk_id uuid)
returns uuid as $$
declare
  me uuid;
  my_family uuid;
  source_w record;
  target_w record;
  new_id uuid;
begin
  me := current_profile_id();
  if me is null then
    raise exception 'no active profile claimed on this family';
  end if;
  my_family := current_family_id();

  if p_walk_id = p_target_walk_id then
    raise exception 'choose a different walk';
  end if;

  -- Deterministic lock order prevents inverse concurrent requests from
  -- deadlocking while both exact occurrences are validated.
  perform 1 from walks
  where id in (p_walk_id, p_target_walk_id)
  order by id
  for update;

  select * into source_w from walks where id = p_walk_id;
  select * into target_w from walks where id = p_target_walk_id;

  if source_w.id is null or source_w.family_id is distinct from my_family then
    raise exception 'walk not found in this family';
  end if;
  if target_w.id is null or target_w.family_id is distinct from my_family then
    raise exception 'target walk not found in this family';
  end if;
  if source_w.status <> 'pending' or target_w.status <> 'pending' then
    raise exception 'both walks must still be pending';
  end if;
  if source_w.responsible_user_id <> me then
    raise exception 'you can only request a swap for a walk you are responsible for';
  end if;
  if target_w.responsible_user_id = me then
    raise exception 'choose a walk assigned to a different family member';
  end if;
  if target_w.dog_id is distinct from source_w.dog_id then
    raise exception 'both walks must belong to the same dog';
  end if;
  if not exists (
    select 1 from users
    where id = target_w.responsible_user_id
      and family_id = my_family
      and removed_at is null
  ) then
    raise exception 'target member is not an active member of this family';
  end if;

  -- Neither exact walk may participate on either side of another pending swap.
  if exists (
    select 1 from walk_swap_requests r
    where r.status = 'pending'
      and (
        r.walk_id in (p_walk_id, p_target_walk_id)
        or r.target_walk_id in (p_walk_id, p_target_walk_id)
      )
  ) then
    raise exception 'a pending swap request already exists for one of these walks';
  end if;

  insert into walk_swap_requests (
    family_id, walk_id, target_walk_id, requested_by_user_id, target_user_id,
    expected_responsible_user_id, expected_status, expected_scheduled_time,
    expected_target_responsible_user_id, expected_target_status, expected_target_scheduled_time
  ) values (
    my_family, source_w.id, target_w.id, me, target_w.responsible_user_id,
    source_w.responsible_user_id, source_w.status, source_w.scheduled_time,
    target_w.responsible_user_id, target_w.status, target_w.scheduled_time
  ) returning id into new_id;

  perform log_audit_event(my_family, me, 'swap_request_created', 'walk', source_w.id,
    jsonb_build_object(
      'request_id', new_id,
      'source_walk_id', source_w.id,
      'target_walk_id', target_w.id,
      'target_user_id', target_w.responsible_user_id
    ));

  return new_id;
end;
$$ language plpgsql volatile security definer set search_path = public;

create or replace function approve_swap_request(p_request_id uuid)
returns void as $$
declare
  me uuid;
  req record;
  source_w record;
  target_w record;
begin
  me := current_profile_id();
  if me is null then
    raise exception 'no active profile claimed on this family';
  end if;

  select * into req from walk_swap_requests where id = p_request_id for update;
  if req.id is null or req.family_id is distinct from current_family_id() then
    raise exception 'request not found in this family';
  end if;
  if req.target_user_id <> me then
    raise exception 'only the requested member can approve this swap';
  end if;

  if req.status = 'approved' then return; end if;
  if req.status = 'rejected' then raise exception 'this request was already rejected'; end if;
  if req.target_walk_id is null then
    raise exception 'legacy swap request has no target walk and can no longer be approved';
  end if;

  perform 1 from walks
  where id in (req.walk_id, req.target_walk_id)
  order by id
  for update;

  select * into source_w from walks where id = req.walk_id;
  select * into target_w from walks where id = req.target_walk_id;

  if source_w.id is null
     or source_w.family_id is distinct from req.family_id
     or source_w.status <> 'pending'
     or source_w.responsible_user_id is distinct from req.expected_responsible_user_id
     or source_w.scheduled_time is distinct from req.expected_scheduled_time then
    raise exception 'the source walk has changed since this request was created and can no longer be approved';
  end if;

  if target_w.id is null
     or target_w.family_id is distinct from req.family_id
     or target_w.status <> 'pending'
     or target_w.responsible_user_id is distinct from req.expected_target_responsible_user_id
     or target_w.scheduled_time is distinct from req.expected_target_scheduled_time then
    raise exception 'the target walk has changed since this request was created and can no longer be approved';
  end if;

  if source_w.dog_id is distinct from target_w.dog_id then
    raise exception 'both walks must belong to the same dog';
  end if;
  if req.requested_by_user_id is distinct from source_w.responsible_user_id
     or req.target_user_id is distinct from target_w.responsible_user_id then
    raise exception 'one of the walks has changed ownership since this request was created';
  end if;
  if not exists (select 1 from users where id = req.requested_by_user_id and family_id = req.family_id and removed_at is null)
     or not exists (select 1 from users where id = req.target_user_id and family_id = req.family_id and removed_at is null) then
    raise exception 'one of the swap members is no longer active in this family';
  end if;

  perform set_config('app.trusted_write', 'on', true);

  if source_w.schedule_entry_id is not null then
    update schedule_entries
    set responsible_user_id = req.target_user_id
    where id = source_w.schedule_entry_id and family_id = req.family_id;
  end if;
  if target_w.schedule_entry_id is not null then
    update schedule_entries
    set responsible_user_id = req.requested_by_user_id
    where id = target_w.schedule_entry_id and family_id = req.family_id;
  end if;

  update walks
  set responsible_user_id = req.target_user_id,
      swap_original_user_id = coalesce(source_w.swap_original_user_id, source_w.responsible_user_id),
      swap_new_user_id = req.target_user_id,
      swap_swapped_at = now(),
      swap_swapped_by_user_id = me,
      updated_at = now()
  where id = source_w.id;

  update walks
  set responsible_user_id = req.requested_by_user_id,
      swap_original_user_id = coalesce(target_w.swap_original_user_id, target_w.responsible_user_id),
      swap_new_user_id = req.requested_by_user_id,
      swap_swapped_at = now(),
      swap_swapped_by_user_id = me,
      updated_at = now()
  where id = target_w.id;

  perform set_config('app.trusted_write', 'off', true);

  update walk_swap_requests
  set status = 'approved', resolved_at = now(), resolved_by_user_id = me
  where id = p_request_id;

  perform log_audit_event(req.family_id, me, 'swap_request_approved', 'walk', source_w.id,
    jsonb_build_object(
      'request_id', p_request_id,
      'requested_by_user_id', req.requested_by_user_id,
      'source_walk_id', source_w.id,
      'target_walk_id', target_w.id
    ));
end;
$$ language plpgsql volatile security definer set search_path = public;

-- reject_swap_request keeps the same authorization/status behavior; include
-- both walk ids in the audit record for the new mutual-swap model.
create or replace function reject_swap_request(p_request_id uuid)
returns void as $$
declare
  me uuid;
  req record;
begin
  me := current_profile_id();
  if me is null then raise exception 'no active profile claimed on this family'; end if;

  select * into req from walk_swap_requests where id = p_request_id for update;
  if req.id is null or req.family_id is distinct from current_family_id() then
    raise exception 'request not found in this family';
  end if;
  if req.target_user_id <> me then
    raise exception 'only the requested member can reject this swap';
  end if;
  if req.status = 'rejected' then return; end if;
  if req.status = 'approved' then raise exception 'this request was already approved'; end if;

  update walk_swap_requests
  set status = 'rejected', resolved_at = now(), resolved_by_user_id = me
  where id = p_request_id;

  perform log_audit_event(req.family_id, me, 'swap_request_rejected', 'walk', req.walk_id,
    jsonb_build_object(
      'request_id', p_request_id,
      'requested_by_user_id', req.requested_by_user_id,
      'source_walk_id', req.walk_id,
      'target_walk_id', req.target_walk_id
    ));
end;
$$ language plpgsql volatile security definer set search_path = public;

-- ============================================================================
-- MIGRATION 0020: MULTI-DEVICE PROFILE SESSIONS
-- ============================================================================
-- 0020_multi_device_profile_sessions.sql
-- Walkie Doggy Link: allow one family persona to be signed in on multiple
-- phones/browsers at the same time without transferring users.auth_user_id.
-- Identity remains server-derived from auth.uid(); the client never supplies
-- an actor id for authorization/audit decisions.

-- 1) One active persona selection per authenticated device/session.
create table if not exists profile_auth_sessions (
  auth_user_id uuid primary key references auth.users(id) on delete cascade,
  family_id uuid not null references families(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (auth_user_id, family_id)
);

create index if not exists profile_auth_sessions_user_id_idx
  on profile_auth_sessions(user_id);
create index if not exists profile_auth_sessions_family_id_idx
  on profile_auth_sessions(family_id);

alter table profile_auth_sessions enable row level security;
-- Intentionally no client RLS policies. All writes are through the narrow
-- SECURITY DEFINER claim RPCs below; identity reads are through helper RPCs.

-- Backfill every currently-valid legacy single-device claim so installed
-- mobile clients keep their identity immediately after this migration.
insert into profile_auth_sessions (auth_user_id, family_id, user_id)
select u.auth_user_id, u.family_id, u.id
from users u
join family_auth_members fam
  on fam.auth_user_id = u.auth_user_id
 and fam.family_id = u.family_id
where u.auth_user_id is not null
  and u.removed_at is null
on conflict (auth_user_id) do update
set family_id = excluded.family_id,
    user_id = excluded.user_id,
    updated_at = now();

-- 2) The real persona now resolves from the per-device/session mapping.
-- current_profile_id() from 0006 remains unchanged and still overlays QA
-- impersonation on top of this function.
create or replace function real_current_profile_id()
returns uuid as $$
  select u.id
  from profile_auth_sessions s
  join users u on u.id = s.user_id
  where s.auth_user_id = auth.uid()
    and s.family_id = current_family_id()
    and u.family_id = s.family_id
    and u.removed_at is null
  limit 1;
$$ language sql stable security definer set search_path = public;

-- 3) First claim remains PIN-less only while the persona has no active
-- session anywhere. Once any device is signed in as that persona, another
-- device must use the PIN path. Switching this SAME device to another
-- unclaimed persona replaces only this device's mapping; it never logs out
-- any other device.
create or replace function claim_family_profile(target_user_id uuid)
returns void as $$
declare
  target_family uuid;
  target_removed_at timestamptz;
  my_existing_user uuid;
begin
  if auth.uid() is null then
    raise exception 'must be authenticated';
  end if;

  select family_id, removed_at
    into target_family, target_removed_at
  from users
  where id = target_user_id
  for update;

  if target_family is null then
    raise exception 'user not found';
  end if;
  if target_family is distinct from current_family_id() then
    raise exception 'not a member of this user''s family';
  end if;
  if target_removed_at is not null then
    raise exception 'cannot claim a removed profile';
  end if;

  select user_id into my_existing_user
  from profile_auth_sessions
  where auth_user_id = auth.uid();

  if my_existing_user = target_user_id then
    return;
  end if;

  if exists (
    select 1 from profile_auth_sessions
    where user_id = target_user_id
      and auth_user_id <> auth.uid()
  ) then
    -- Keep the existing client-visible text: LoginScreen uses it to open
    -- the PIN modal. Under 0020 this means "already active elsewhere",
    -- not "the other device will be displaced".
    raise exception 'profile already claimed by another device';
  end if;

  insert into profile_auth_sessions (auth_user_id, family_id, user_id, updated_at)
  values (auth.uid(), target_family, target_user_id, now())
  on conflict (auth_user_id) do update
    set family_id = excluded.family_id,
        user_id = excluded.user_id,
        updated_at = now();

  perform log_audit_event(target_family, target_user_id, 'profile_claimed', 'user', target_user_id,
    jsonb_build_object('multi_device', true));
end;
$$ language plpgsql volatile security definer set search_path = public;

revoke all on function claim_family_profile(uuid) from public;
grant execute on function claim_family_profile(uuid) to authenticated;

-- 4) PIN login now ADDS this authenticated device as another session for
-- the persona. It never clears another device's mapping. Rate limiting and
-- PIN verification preserve 0016's transaction-safe behavior.
drop function if exists claim_family_profile_with_pin(uuid, text);
create function claim_family_profile_with_pin(p_target_user_id uuid, p_pin text)
returns jsonb as $$
declare
  target_family uuid;
  target_removed_at timestamptz;
  target_pin_hash text;
  v_fail_count int;
  v_locked_until timestamptz;
begin
  if auth.uid() is null then
    raise exception 'must be authenticated';
  end if;

  select family_id, removed_at, pin_hash
    into target_family, target_removed_at, target_pin_hash
  from users
  where id = p_target_user_id
  for update;

  if target_family is null then
    raise exception 'user not found';
  end if;
  if target_family is distinct from current_family_id() then
    raise exception 'not a member of this user''s family';
  end if;
  if target_removed_at is not null then
    raise exception 'cannot claim a removed profile';
  end if;

  if exists (
    select 1 from profile_auth_sessions
    where auth_user_id = auth.uid() and user_id = p_target_user_id
  ) then
    return jsonb_build_object('success', true);
  end if;

  if target_pin_hash is null then
    raise exception 'no PIN set for this profile — ask your family admin to set one, or reclaim from the original device';
  end if;

  select fail_count, locked_until
    into v_fail_count, v_locked_until
  from profile_pin_attempts
  where auth_user_id = auth.uid()
    and target_user_id = p_target_user_id
  for update;

  if v_locked_until is not null and v_locked_until > now() then
    return jsonb_build_object('success', false, 'reason', 'cooldown');
  end if;

  if p_pin is null or extensions.crypt(p_pin, target_pin_hash) is distinct from target_pin_hash then
    insert into profile_pin_attempts (auth_user_id, target_user_id, fail_count, locked_until, updated_at)
    values (auth.uid(), p_target_user_id, 1, null, now())
    on conflict (auth_user_id, target_user_id) do update
      set fail_count = case
            when profile_pin_attempts.locked_until is not null
             and profile_pin_attempts.locked_until <= now() then 1
            else profile_pin_attempts.fail_count + 1
          end,
          locked_until = case
            when (case
                    when profile_pin_attempts.locked_until is not null
                     and profile_pin_attempts.locked_until <= now() then 1
                    else profile_pin_attempts.fail_count + 1
                  end) >= 5
              then now() + interval '15 minutes'
            else null
          end,
          updated_at = now();
    return jsonb_build_object('success', false, 'reason', 'wrong_pin');
  end if;

  delete from profile_pin_attempts
  where auth_user_id = auth.uid()
    and target_user_id = p_target_user_id;

  insert into profile_auth_sessions (auth_user_id, family_id, user_id, updated_at)
  values (auth.uid(), target_family, p_target_user_id, now())
  on conflict (auth_user_id) do update
    set family_id = excluded.family_id,
        user_id = excluded.user_id,
        updated_at = now();

  perform log_audit_event(target_family, p_target_user_id, 'profile_claim_transferred', 'user', p_target_user_id,
    jsonb_build_object('multi_device', true, 'other_sessions_preserved', true));

  return jsonb_build_object('success', true);
end;
$$ language plpgsql volatile security definer set search_path = public;

revoke all on function claim_family_profile_with_pin(uuid, text) from public;
grant execute on function claim_family_profile_with_pin(uuid, text) to authenticated;

-- 5) Self profile edits must work from every valid session, not only the
-- one legacy users.auth_user_id value. Admin behavior is unchanged.
drop policy if exists "update users (self or admin, active profiles only)" on users;
create policy "update users (self or admin, active profiles only)" on users
  for update using (
    family_id = current_family_id()
    and removed_at is null
    and (id = real_current_profile_id() or is_family_admin(family_id))
  )
  with check (
    family_id = current_family_id()
    and removed_at is null
    and (id = real_current_profile_id() or is_family_admin(family_id))
  );

-- 6) PIN ownership check also follows the real persona mapping. Using
-- real_current_profile_id() deliberately prevents QA impersonation from
-- changing another person's PIN as if it were self.
create or replace function set_profile_pin(p_user_id uuid, p_pin text)
returns void as $$
declare
  target_family uuid;
  target_removed_at timestamptz;
  target_role text;
  caller_profile uuid;
begin
  if auth.uid() is null then raise exception 'must be authenticated'; end if;

  select family_id, removed_at, role
    into target_family, target_removed_at, target_role
  from users where id = p_user_id;

  if target_family is null then raise exception 'user not found'; end if;
  if target_family is distinct from current_family_id() then
    raise exception 'not a member of this user''s family';
  end if;
  if target_removed_at is not null then
    raise exception 'cannot set a PIN for a removed profile';
  end if;

  caller_profile := real_current_profile_id();
  if caller_profile is distinct from p_user_id then
    if target_role = 'admin' then
      raise exception 'an admin''s own PIN can only be set by that admin themselves';
    end if;
    if not is_family_admin(target_family) then
      raise exception 'only the profile''s own device or a family admin may set its PIN';
    end if;
  end if;

  if p_pin is null then
    perform set_config('app.trusted_write', 'on', true);
    update users set pin_hash = null where id = p_user_id;
    perform set_config('app.trusted_write', 'off', true);
    perform log_audit_event(target_family, caller_profile, 'profile_pin_cleared', 'user', p_user_id, '{}'::jsonb);
    return;
  end if;

  if p_pin !~ '^[0-9]{4,6}$' then
    raise exception 'PIN must be 4 to 6 digits';
  end if;

  perform set_config('app.trusted_write', 'on', true);
  update users set pin_hash = extensions.crypt(p_pin, extensions.gen_salt('bf')) where id = p_user_id;
  perform set_config('app.trusted_write', 'off', true);
  perform log_audit_event(target_family, caller_profile, 'profile_pin_set', 'user', p_user_id, '{}'::jsonb);
end;
$$ language plpgsql volatile security definer set search_path = public;

revoke all on function set_profile_pin(uuid, text) from public;
grant execute on function set_profile_pin(uuid, text) to authenticated;

-- No change is required to current_profile_id(), whoami(), current_family_role(),
-- is_family_admin(), request RPCs, presence, or audit triggers: all of those
-- already route through real_current_profile_id()/current_profile_id() in the
-- final schema, so they automatically pick up the multi-device identity.

