-- ============================================================================
-- 0051_walk_gps_sessions.sql
--
-- Phase 4 kickoff (Walkie Doggy Link PRD §7, "Lifecycle של טיול ו-GPS"):
-- the data foundation for optional, foreground-only GPS distance tracking
-- during a walk. Deliberately narrow in scope — see the PRD's own phasing:
-- "בשלב ראשון GPS הוא Assistive ולא מקור אמת יחיד... בהמשך ניתן להוסיף
-- confidence score וליצור Auto-detected walk" (first stage: assistive only,
-- confidence-scored auto-detection is later) — this migration builds the
-- first stage only.
--
-- PRIVACY-BY-DESIGN, NOT JUST A LATER POLICY: the PRD requires "שמירת
-- מינימום מידע נדרש...ומדיניות מחיקה/פרטיות" (minimum data retention,
-- deletion/privacy policy) and separately flags full GPS retention policy
-- as a PRE-PRODUCTION decision still open (PRD_GAP_ANALYSIS_PHASE0.md line
-- 364-366; PRD line 248). Rather than building raw location-history storage
-- now and leaving it exposed until that policy is decided, this table
-- stores ONLY the derived AGGREGATE (distance + point count) a device
-- computes on-device from a stream of positions it never persists anywhere
-- (see src/lib/gpsTracking.ts) — there is no raw lat/lng history in this
-- schema at all yet, so there is nothing here that policy decision could
-- retroactively need to be deleted or restricted. A future increment that
-- adds an actual stored route (polyline) is a new migration, gated on that
-- policy actually being decided, not on this one.
--
-- One session per walk (unique constraint) — exactly one GPS attempt is
-- tracked per walk occurrence in this first stage; a person can re-track
-- (overwriting via upsert) if they mis-started it, but there is no history
-- of multiple attempts to reconcile. `corrected_distance_meters` is the
-- PRD's required correction flow made a first-class column rather than a
-- client-only edit: the device-computed `distance_meters` stays as the
-- original measurement, and the family's confirmed/corrected value (once
-- set) is what statistics/history should actually read — the same
-- "auto-computed, human-confirmed-or-corrected" split walks' own
-- started_at/ended_at already models for source='manual' entries.
-- ============================================================================

create table if not exists walk_gps_sessions (
  id uuid primary key default gen_random_uuid(),
  walk_id uuid not null references walks(id) on delete cascade,
  family_id uuid not null references families(id) on delete cascade,
  dog_id uuid not null references dogs(id) on delete cascade,
  -- Device-computed from an in-memory position stream (Haversine sum) —
  -- never derived from stored raw points, because none are stored. Null
  -- until the device finishes (or gives up on) tracking.
  distance_meters numeric(10,2) check (distance_meters is null or distance_meters >= 0),
  point_count int not null default 0,
  -- PRD §7 correction flow: null until a family member confirms/edits the
  -- device-computed value; once set, this is authoritative for display and
  -- future statistics — distance_meters is kept as the original reading.
  corrected_distance_meters numeric(10,2) check (corrected_distance_meters is null or corrected_distance_meters >= 0),
  corrected_by_user_id uuid references users(id) on delete set null,
  started_at timestamptz,
  ended_at timestamptz,
  -- Single source today ('device_gps' — this device's own foreground
  -- tracking). The PRD's own "Adapter/Provider... ללא תלות בספק יחיד" line
  -- (no reliance on a single collar/tracker vendor) is exactly why this is
  -- an open text/check list, not a hardcoded assumption baked into the
  -- distance-computation logic itself — a future collar adapter adds a new
  -- allowed value here, not a schema rewrite.
  source text not null default 'device_gps' check (source in ('device_gps')),
  created_by_user_id uuid references users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (walk_id)
);

create index if not exists walk_gps_sessions_family_id_idx on walk_gps_sessions (family_id);
create index if not exists walk_gps_sessions_walk_id_idx on walk_gps_sessions (walk_id);

drop trigger if exists walk_gps_sessions_set_updated_at on walk_gps_sessions;
create trigger walk_gps_sessions_set_updated_at
  before update on walk_gps_sessions
  for each row execute function set_updated_at();

alter table walk_gps_sessions enable row level security;

create policy "select walk gps sessions in own family" on walk_gps_sessions
  for select using (family_id = current_family_id());

-- INSERT/UPDATE open to any family member, matching health_tasks (0049) and
-- dogs (0042)'s established posture for this schema's non-`walks` content
-- tables — no stored raw location data here to warrant a stricter gate (see
-- this migration's own header), and the PRD names no "only the responsible
-- member" requirement for who may record/correct a distance the way it
-- does for walk completion itself.
create policy "insert walk gps sessions in own family" on walk_gps_sessions
  for insert with check (family_id = current_family_id());

create policy "update walk gps sessions in own family" on walk_gps_sessions
  for update using (family_id = current_family_id())
  with check (family_id = current_family_id());

-- Intentionally no DELETE policy — same posture as dogs (0042) and
-- health_tasks (0049): a walk's GPS summary is part of that walk's history
-- record, not something a client should be able to silently erase. (It
-- still disappears via `on delete cascade` if the walk itself is deleted,
-- exactly like every other walk-scoped table.)
