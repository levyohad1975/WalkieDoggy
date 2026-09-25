-- ============================================================================
-- 0052_gamification_achievements.sql
--
-- Phase 5 kickoff (Walkie Doggy Link PRD §9 "Gamification — גביעים ועידוד
-- משפחתי"). Goal per the PRD: encourage responsibility/cooperation, not
-- toxic competition — personal AND family achievements, moderate streaks,
-- trophies, with an off-switch; family achievements are preferred over
-- aggressive kid-vs-kid ranking; on unlock the mascot shows a short
-- celebration; show clear progress toward the next goal; no dark patterns
-- or punishment for missing one.
--
-- ----------------------------------------------------------------------------
-- Part A — gamification_enabled off-switch (PRD: "עם אפשרות לכיבוי").
-- Per-user/device, same self-service-toggle shape as reminders_enabled
-- (0001) — not a family-wide admin setting, since this is about a specific
-- person opting out of celebration UI for themselves, not the family
-- disabling data collection. Mirrors reminders_enabled's own column-grant
-- pattern (0016 Layer A): `authenticated` gets UPDATE on exactly this one
-- new column, additive to the existing narrower grant list from 0016 (a
-- second GRANT UPDATE naming different columns on the same table/role
-- extends, rather than replaces, the privilege set — 0016's own REVOKE is
-- untouched, so its protected-column posture for role/pin_hash/auth_user_id
-- is completely unaffected by this addition).
-- ----------------------------------------------------------------------------
alter table users add column if not exists gamification_enabled boolean not null default true;

grant update (gamification_enabled) on public.users to authenticated;

-- ----------------------------------------------------------------------------
-- Part B — achievement_unlocks: an immutable unlock ledger, not a mutable
-- "achievement state" table. The achievement catalog itself (thresholds,
-- Hebrew copy, celebration mapping) lives in client code
-- (src/logic/achievements.ts), not here — this table only records WHEN a
-- given (family, achievement_key, scope, user) combination was first
-- crossed, so a client never re-shows the same celebration twice across
-- reloads/devices. Built multi-dog-safe implicitly: achievements are scoped
-- to family/user, never to a specific dog, so they naturally apply across
-- however many dogs a family has without any dog_id column.
--
-- dedupe_key is a STORED generated column, not a plain text column the
-- client writes: 'family'-scope rows always coalesce to the same value
-- ('<key>:') regardless of which device/request creates them, giving a
-- single unique constraint that dedupes BOTH scopes correctly (a 'personal'
-- row for user A and a 'family' row with the same achievement_key are
-- different dedupe_key values, and two attempts to unlock the same
-- family-wide achievement collide on the same one) without a partial index
-- or two separate unique constraints.
-- ----------------------------------------------------------------------------
create table if not exists achievement_unlocks (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references families(id) on delete cascade,
  achievement_key text not null,
  scope text not null check (scope in ('personal', 'family')),
  user_id uuid references users(id) on delete cascade,
  dedupe_key text generated always as (achievement_key || ':' || coalesce(user_id::text, '')) stored,
  unlocked_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  -- A 'personal' unlock must name who earned it; a 'family' one must not
  -- (it belongs to everyone, not a specific member) — same shape as
  -- health_tasks' own due_date/completed_at "never neither" constraint.
  constraint achievement_unlocks_scope_user check (
    (scope = 'personal' and user_id is not null) or (scope = 'family' and user_id is null)
  ),
  unique (family_id, dedupe_key)
);

create index if not exists achievement_unlocks_family_id_idx on achievement_unlocks (family_id);

alter table achievement_unlocks enable row level security;

create policy "select achievement unlocks in own family" on achievement_unlocks
  for select using (family_id = current_family_id());

-- INSERT open to any family member, matching health_tasks' (0049) own
-- established default for family-scoped content without an explicit
-- admin-only requirement — an achievement unlock is a natural side effect
-- of ordinary walk activity any member can trigger, not an admin action.
create policy "insert achievement unlocks in own family" on achievement_unlocks
  for insert with check (family_id = current_family_id());

-- Intentionally no UPDATE/DELETE policy — an immutable unlock ledger, same
-- posture as health_tasks (0049) and dogs (0042): once earned, an
-- achievement's unlock record is a family history fact, never something a
-- client can silently edit or erase (that would let a device re-trigger the
-- same celebration, or erase a family's actual earned history).
