-- ============================================================================
-- 0049_health_grooming_foundation.sql
--
-- Phase 3 kickoff (Walkie Doggy Link PRD §10 "בריאות וטיפוח" / Health &
-- Grooming). Built multi-dog-first from day one: dog_id is NOT NULL, exactly
-- like schedule_rules/schedule_entries/walks — this schema has been N-dog-
-- capable at the DB layer since dogs was first created (no uniqueness
-- constraint on dogs.family_id; see 0042_dogs_no_client_delete.sql), and the
-- PRD itself (§11) requires every health/grooming record to be attributed to
-- a specific dog once a family has more than one.
--
-- A single `health_tasks` table unifies the two shapes the PRD describes
-- (§10: "זהו יומן וניהול משימות" — a JOURNAL and TASK management) rather than
-- splitting into two tables up front:
--   - a completed LOG entry (e.g. "gave the heartworm pill today", "weighed
--     8.4kg") — created with completed_at already set, due_date null.
--   - a scheduled/DUE task (e.g. "next vet visit", "nail trim due") —
--     created with due_date set, completed_at null until marked done.
-- This mirrors how `walks` already unifies planned vs. unplanned entries in
-- this schema (is_unplanned) rather than introducing a new pattern.
--
-- Deliberately NOT built here: recurrence (auto-regenerating the next due
-- task once one is completed). The PRD's own Phase 3 breakdown lists
-- "recurring tasks" AFTER "data model, repository, Supabase/RLS/RPC,
-- reminders, screens, timeline" (WALKIE_DOGGY_LINK_PRD.md line 216), and a
-- family can already log/track every core category one entry at a time
-- without it. Also not built here: category-specific reminder scheduling
-- (PRD §10's "תזכורות בריאות/טיפוח") — layers on top of due_date the same
-- way 0025's walk_reminder_scheduler layers on top of schedule_entries, once
-- this foundation and its screens exist to validate the shape against.
-- ============================================================================

create table if not exists health_tasks (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references families(id) on delete cascade,
  dog_id uuid not null references dogs(id) on delete cascade,
  category text not null check (category in (
    'vaccination', 'parasite_prevention', 'medication', 'vet_visit',
    'weight', 'allergy', 'food', 'grooming', 'bath', 'nails', 'teeth',
    'ears', 'other'
  )),
  title text not null,
  notes text,
  -- Weight-log entries record their value here; null for every other
  -- category. Kept on the same row rather than a separate table — one more
  -- unify-not-fragment call, consistent with this table's whole design.
  weight_kg numeric(5,2) check (weight_kg is null or weight_kg > 0),
  due_date date,
  completed_at timestamptz,
  completed_by_user_id uuid references users(id) on delete set null,
  responsible_user_id uuid references users(id) on delete set null,
  created_by_user_id uuid references users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Every row is a log entry, a due task, or both — never neither (that
  -- would be a record with nothing to show up under on any screen).
  constraint health_tasks_due_or_completed check (due_date is not null or completed_at is not null)
);

create index if not exists health_tasks_family_id_idx on health_tasks (family_id);
create index if not exists health_tasks_dog_id_idx on health_tasks (dog_id, due_date);

drop trigger if exists health_tasks_set_updated_at on health_tasks;
create trigger health_tasks_set_updated_at
  before update on health_tasks
  for each row execute function set_updated_at();

alter table health_tasks enable row level security;

create policy "select health tasks in own family" on health_tasks
  for select using (family_id = current_family_id());

-- INSERT/UPDATE open to any family member, matching this schema's own
-- established default for family-scoped content without an explicit
-- admin-only requirement (dogs: 0042; schedule_entries' one-off edits: 0004
-- reserves admin-only for RULES specifically, not every family record). The
-- PRD's "מנהלים יכולים ליצור/לערוך; הרשאות בני משפחה ניתנות להגדרה" (admins
-- can create/edit; member permissions are configurable) describes a
-- CONFIGURABLE default, not a hard admin-only gate — this app already has a
-- per-member permission-override system (0023_member_permission_overrides)
-- for exactly this kind of refinement, deliberately not wired in here (a
-- client-side-only gate would not be a real security boundary without a
-- matching RLS check anyway, and that check needs its own migration once
-- the actual permission key/screen exist to validate against).
create policy "insert health tasks in own family" on health_tasks
  for insert with check (family_id = current_family_id());

create policy "update health tasks in own family" on health_tasks
  for update using (family_id = current_family_id())
  with check (family_id = current_family_id());

-- Intentionally no DELETE policy — same posture as dogs (0042) and users
-- (0003): a health/grooming record is a family history record (was this dog
-- vaccinated? when?), not something a client should ever be able to
-- silently erase.
