-- ----------------------------------------------------------------------------
-- 0027_history_statistics_server_enforcement.sql
--
-- BATCH 3 CORRECTION #1 (post-review), CORRECTED AGAIN (review #2) — closes
-- the gap the Batch 3 review flagged in
-- supabase/migrations/0023_member_permission_overrides.sql /
-- src/logic/permissions.ts: that migration only ever added the DATA MODEL
-- and admin-gated write RPCs for view_history/view_statistics; nothing
-- server-side ever READ or enforced them, and HistoryScreen.tsx/
-- StatisticsScreen.tsx's permission gate was built entirely against
-- client-loaded state. NOT YET DEPLOYED (per review #2's explicit note) —
-- this file is corrected IN PLACE rather than superseded by a 0028, since
-- nothing in it has reached a real database yet. Does not touch 0001-0026
-- at all (0022-0025 are already-deployed and off-limits; 0026 was rechecked
-- fresh against the current definitions of every function it depends on and
-- no defect was found, so it is unchanged).
--
-- review #2 corrected TWO things review #1's version of this file got
-- wrong:
--   (a) has_member_permission() used a single generic "no override row ->
--       true" fallback, which meant an unknown/typo'd permission key (e.g.
--       'view_statitics') also silently resolved to `true`. Fixed by
--       validating the key against the known set FIRST and returning
--       `false` immediately for anything else — see section 1 below.
--   (b) the walks SELECT policy included
--       `or has_member_permission('view_history') or
--        has_member_permission('view_statistics')` as an OR-fallback. That
--       let EITHER permission unlock raw-table access to ALL of the
--       other's protected data too (view_history=false + view_statistics=
--       true could still raw-query old walks and reconstruct History, and
--       the symmetric case for Statistics) — the two permissions are meant
--       to be independent capabilities, and this made them not-independent
--       at the raw-table layer. Fixed by removing BOTH has_member_permission
--       branches from the base table policy entirely — see section 2 below.
--       A regular member's raw `walks` access is now a permission-
--       INDEPENDENT operational window (what Home/Schedule genuinely need,
--       nothing more); the only way to reach EITHER permission's protected
--       historical dataset at all is through that permission's own RPC.
--
-- FINAL REVIEW CORRECTION — two further fixes on top of review #2's model
-- (which is otherwise kept exactly as approved: raw walks RLS stays
-- permission-independent, History/Statistics stay on their RPC datasets,
-- unknown keys stay fail-closed):
--   (c) the operational window's "today" boundary was `date = current_date`
--       — the DATABASE SESSION's own date, not the CURRENT FAMILY's date.
--       Batch 1 (0022_family_timezone_and_dog_sex.sql) established
--       families.timezone as the authoritative per-family IANA timezone
--       specifically for this kind of boundary (0025's due_walk_reminders()/
--       walk_reminder_context() already convert walk date+time through it).
--       Section 2a below adds current_family_local_date() — family-scoped,
--       reads the CALLER's OWN family's stored timezone (never a
--       client-supplied one), DST-safe (Postgres's own IANA tzdata
--       conversion, the same mechanism 0025 already relies on), no
--       hardcoded zone — and the policy in section 2 now uses it instead of
--       the bare `current_date`.
--   (d) src/logic/nextWalk.ts's computeLastWalk() (HomeScreen's "last walk"
--       card) lost its old fidelity once the raw walks policy stopped
--       exposing anything older than today — flagged as a disclosed,
--       deferred follow-up in review #2 rather than fixed. That regression
--       is caused directly by this batch's own security tightening, so it
--       is fixed inside this batch now: section 4 below adds
--       get_last_resolved_walk(), a narrow SECURITY DEFINER RPC that
--       returns AT MOST ONE row (the single most recently resolved walk,
--       mirroring computeLastWalk()'s own selection rule exactly) —
--       operational Home status, not a searchable history log, so it is
--       available to every family member regardless of view_history/
--       view_statistics, without reopening any bulk raw access.
--
-- Adds:
--   1. has_member_permission(p_permission_key) — the SQL mirror of
--      src/logic/permissions.ts's resolveEffectivePermission(), now with
--      explicit per-key role defaults and a fail-closed unknown-key path.
--   2a. current_family_local_date() — the caller's own family's current
--      LOCAL calendar date, derived from families.timezone (0022), never
--      the database session's date and never a client-supplied zone.
--   2. A tightened `select walks in own family` RLS policy (DROP+CREATEs
--      the policy 0005 originally defined — 0005 itself is not edited,
--      matching the established convention every later migration already
--      uses for iterative RLS tightening).
--   3. list_history_walks() / list_statistics_walks() — the two RPCs
--      HistoryScreen.tsx/StatisticsScreen.tsx now use as their actual
--      historical DATA SOURCE (not merely an allow/deny probe).
--   4. get_last_resolved_walk() — the narrow, single-row RPC that restores
--      HomeScreen's "last walk" card fidelity without reopening bulk raw
--      historical access.
-- ----------------------------------------------------------------------------

-- ----------------------------------------------------------------------------
-- 1. has_member_permission(p_permission_key)
--
-- SQL-side mirror of src/logic/permissions.ts's resolveEffectivePermission().
-- CORRECTED (review #2): the known permission set and its role default are
-- now explicit per key — a `case` that returns the specific default for
-- 'view_history'/'view_statistics' and returns `false` immediately for
-- anything else, BEFORE ever looking at member_permission_overrides or
-- current_profile_id(). This is deliberately NOT "look up an override row,
-- and if none exists, assume true" (that generic shape is exactly what let
-- an unknown/typo'd key fail open) — every known key's default is stated
-- explicitly, and there is no default case that resolves to `true`.
--
-- An explicit override row for the CALLER (current_profile_id() —
-- impersonation-aware, exactly like every other authorization check in this
-- schema) still wins over the role default for a KNOWN key. No identity to
-- check against (current_profile_id() is null — no active profile claimed)
-- also fails CLOSED (`false`).
--
-- Returning `false` for an unknown key rather than raising: this function
-- is evaluated inside RLS USING clauses (section 2) as well as called from
-- the RPCs below — an exception raised from inside an RLS predicate would
-- hard-fail every SELECT against `walks`, not just the caller's own
-- request, which is worse than the simple, safe `false` this function is
-- built around everywhere else. It is only ever invoked with hardcoded
-- literals from within this same schema (never with client-supplied text),
-- so "unknown key" can only mean a bug in THIS codebase — exactly the
-- 'view_statitics'-typo scenario the review named — and failing closed here
-- catches that as a denial rather than a silent grant, which is the
-- correct failure direction for a bug in security-relevant code.
--
-- Left at the same PUBLIC-default grant as current_family_id()/
-- is_family_admin()/current_profile_id() themselves (no explicit
-- revoke/grant here, matching that established convention for this class
-- of internal helper) — it is a plain SELECT helper for the RLS policy and
-- the two SECURITY DEFINER RPCs below to call, not something the client
-- ever calls directly.
-- ----------------------------------------------------------------------------

create or replace function has_member_permission(p_permission_key text)
returns boolean as $$
declare
  me uuid;
  v_role_default boolean;
  v_allowed boolean;
begin
  case p_permission_key
    when 'view_history' then v_role_default := true;
    when 'view_statistics' then v_role_default := true;
    else
      return false; -- unknown/typo'd key: fail CLOSED, never open.
  end case;

  me := current_profile_id();
  if me is null then
    return false;
  end if;

  select allowed into v_allowed
  from member_permission_overrides
  where user_id = me and permission_key = p_permission_key;

  if v_allowed is null then
    return v_role_default; -- no override row for this member/key -> that key's own role default
  end if;

  return v_allowed;
end;
$$ language plpgsql stable security definer set search_path = public;

comment on function has_member_permission(text) is
  'Server-side mirror of src/logic/permissions.ts''s resolveEffectivePermission() — validates p_permission_key against the known set FIRST (fails closed / returns false for anything unrecognized, e.g. a typo), then an explicit member_permission_overrides (0023) row for current_profile_id() wins, else that key''s own stated role default (true today for both view_history and view_statistics). Fails closed (false) when there is no active profile to resolve. Used by the tightened walks SELECT policy and by list_history_walks()/list_statistics_walks() below (Batch 3 correction #1/#2).';

-- ----------------------------------------------------------------------------
-- 2a. current_family_local_date() — the CALLER'S OWN family's current local
-- calendar date, derived from families.timezone (0022_family_timezone_and_
-- dog_sex.sql — the authoritative per-family IANA timezone this schema
-- already established for exactly this class of boundary; 0025's
-- due_walk_reminders()/walk_reminder_context() already convert walk
-- date+time through the same `... at time zone f.timezone` idiom).
--
-- FINAL REVIEW CORRECTION: replaces review #2's bare `current_date` (the
-- database SESSION's own clock/date, not any particular family's) in the
-- operational-window policy below. `now()` is a timestamptz (an absolute
-- instant, timezone-agnostic); `now() at time zone f.timezone` reinterprets
-- that instant as the LOCAL wall-clock timestamp in the family's own zone
-- (the same conversion direction 0025 already relies on, just inverted —
-- 0025 goes local-naive -> instant via `at time zone`, this goes
-- instant -> local-naive the same operator applied to a timestamptz), and
-- `::date` takes just the local calendar date. Postgres's zone conversion
-- is backed by the system's IANA tzdata, so this is DST-safe by
-- construction — no manual offset arithmetic, no hardcoded zone anywhere
-- in this function.
--
-- Family-scoped and NOT client-trusted: the timezone always comes from
-- `families.timezone` for current_family_id() (itself derived server-side
-- from auth.uid() via family_auth_members, never from client input) — there
-- is no parameter here for a client to ever supply a timezone through.
-- families.timezone is already constrained by is_valid_timezone() (0022),
-- so this function can never be handed a malformed/unrecognized zone name;
-- a corrupted or missing families row (should never happen — family_id is
-- a NOT NULL foreign key) simply yields NULL, which fails CLOSED wherever
-- this is compared with `=` below (NULL never equals any date), never
-- broadening access.
-- ----------------------------------------------------------------------------

create or replace function current_family_local_date()
returns date as $$
  select (now() at time zone f.timezone)::date
  from families f
  where f.id = current_family_id();
$$ language sql stable security definer set search_path = public;

comment on function current_family_local_date() is
  'The CALLER''S OWN family''s current local calendar date, derived from families.timezone (0022) via Postgres''s own IANA-backed timezone conversion (DST-safe, no hardcoded zone). Family-scoped via current_family_id() only — never a client-supplied timezone. Returns NULL (fails closed) if the caller has no resolvable family. Replaces the bare `current_date` (database session clock) previously used by the walks operational-window policy below (Batch 3 final review correction).';

-- ----------------------------------------------------------------------------
-- 2. Tightened `select walks in own family` policy — the RAW-TABLE
-- operational window, permission-INDEPENDENT.
--
-- CORRECTED (review #2): the review #1 version of this policy included
-- `or has_member_permission('view_history') or
--  has_member_permission('view_statistics')`, which let EITHER permission
-- unlock raw-table access to ALL historical rows — including the OTHER
-- permission's protected data. That made the two permissions not
-- independent at the raw-table layer, which the review correctly rejected.
--
-- The corrected model, per the review's own framing:
--   - ordinary operational data Home/Schedule need stays available through
--     this normal `walks` RLS path, for EVERY member regardless of
--     view_history/view_statistics (those permissions were never meant to
--     gate "is the dog currently due for a walk" / "was today's walk
--     already done" — see below for exactly what that operational need is).
--   - historical datasets (the searchable log behind History, the 7d/30d/
--     all aggregates behind Statistics) are exposed ONLY through their own
--     permission-gated RPC (section 3) — there is no raw-table path to
--     either one anymore, for anyone without is_family_admin().
--
-- Family isolation is unchanged (family_id = current_family_id() remains
-- the outer, non-negotiable condition — never widened).
--
-- What the operational window actually is, re-derived from the real
-- callers rather than kept as an arbitrary carve-out:
--   - status = 'pending': every pending walk, any date. This is what
--     Home's computeNextWalk()/upcomingWalks() and every rotation/swap/
--     schedule-editing flow across this app need, exactly as before this
--     migration existed — pending walks are not "history" in any sense
--     these permissions are meant to gate.
--   - date = current_family_local_date(): a walk resolved (done/skipped)
--     TODAY IN THE FAMILY'S OWN TIMEZONE (FINAL REVIEW CORRECTION — see
--     section 2a above; was the database-session-clock-based bare
--     `current_date` in review #2). ScheduleScreen's own range filter
--     (src/screens/ScheduleScreen.tsx's inRange()) never looks backward
--     past today at all (`today`/`tomorrow`/`week` are all `>= today`), so
--     "today" is its exact, complete need — nothing wider is required
--     there; it just now needs to be the FAMILY's today, not the server's.
--   - is_family_admin(family_id): unrestricted, matching the admin-bypass
--     convention used everywhere else in this schema
--     (enforce_walk_write_authorization, approve_time_change_request,
--     admin_reschedule_walk, ...).
--
-- Deliberately NOT included: a multi-day buffer "just in case", and no
-- has_member_permission(...) branch at all.
--
-- KNOWN SIDE EFFECT, NOW FIXED (was deferred in review #2, fixed in this
-- correction — see section 4 below): src/logic/nextWalk.ts's
-- computeLastWalk() (HomeScreen's "last walk" card) previously had no bound
-- at all — it found the single most recently resolved walk regardless of
-- age. This policy alone would still mean "if no walk has been resolved YET
-- today, the raw `walks` path finds nothing" — but HomeScreen's Supabase-
-- mode data flow now also calls get_last_resolved_walk() (section 4), a
-- narrow single-row RPC unrestricted by view_history/view_statistics, so
-- the "last walk" card keeps its old fidelity without this policy ever
-- needing to grant bulk raw historical access to achieve that.
--
-- This is the actual "cannot be bypassed by directly querying the
-- underlying Supabase data" fix, for EACH permission independently: neither
-- view_history nor view_statistics can be used to unlock the other's data
-- via this table anymore, because neither is referenced by this policy at
-- all. Enforced by Postgres on EVERY read of this table (the app's own
-- repository.getWalks(), or a client issuing its own raw REST/PostgREST
-- query with a real session token) — the two new RPCs below are SECURITY
-- DEFINER and therefore do not even go through this policy; they carry
-- their own explicit, independent has_member_permission() check instead.
-- ----------------------------------------------------------------------------

drop policy if exists "select walks in own family" on walks;
create policy "select walks in own family" on walks
  for select using (
    family_id = current_family_id()
    and (
      is_family_admin(family_id)
      or status = 'pending'
      or date = current_family_local_date()
    )
  );

comment on policy "select walks in own family" on walks is
  'Family-scoped as before 0027 (never widened). Raw-table access beyond that is a permission-INDEPENDENT operational window only: every pending walk (any date) and walks resolved TODAY IN THE FAMILY''S OWN TIMEZONE (current_family_local_date(), section 2a — not the database session''s date), for every family member regardless of view_history/view_statistics, plus unrestricted access for a Family Admin. Neither view_history nor view_statistics is referenced here (corrected in review #2 — an OR on either permission previously let it unlock the other''s protected data too). Bulk historical data is reachable ONLY via list_history_walks()/list_statistics_walks() below, each independently gated on its own permission; the single-row get_last_resolved_walk() (section 4) restores HomeScreen''s last-walk fidelity without widening this policy (Batch 3 correction #1/#2/final).';

-- ----------------------------------------------------------------------------
-- 3. list_history_walks() / list_statistics_walks()
--
-- The client's ACTUAL historical data source (src/lib/permissionedWalks.ts
-- -> HistoryScreen.tsx/StatisticsScreen.tsx), not merely an allow/deny
-- probe discarded after checking — CORRECTED (review #2): the review #1
-- version of the client fetched these rows only to throw them away and
-- kept rendering from the unrestricted scheduleStore.walks; now that the
-- raw table (section 2) no longer exposes bulk history to anyone, that
-- would have left the screens showing an incomplete (operational-window-
-- only) dataset even for a fully-permitted member. These RPCs' returned
-- rows are what those screens actually compute from.
--
-- SECURITY DEFINER (bypasses RLS internally, exactly like every other RPC
-- in this schema — the operational-window policy in section 2 does not
-- apply to these calls at all) but re-applies the SAME family scoping that
-- policy would apply (family_id = current_family_id(), re-derived from
-- auth.uid() on every call, never from a client-supplied id) — family
-- isolation is not weakened here. Requires an active, currently-resolvable
-- profile (current_family_id() non-null) before even checking the
-- permission, so a caller with no valid session/profile gets the same
-- explicit denial as a caller who is validly authenticated but lacks the
-- permission — never a different (potentially more revealing) failure
-- mode. Each RPC checks its OWN specific key via has_member_permission()
-- (section 1, itself fail-closed for anything but a known key — there is
-- no way for an unknown key to reach these call sites at all, since both
-- literals here are hardcoded and already validated, but the helper's own
-- fail-closed behavior is what makes that true rather than assumed). When
-- permission is actually granted, returns the FULL family dataset (no
-- operational-window narrowing — that narrowing is specific to the raw
-- table's fallback path in section 2, not to a caller who has just been
-- explicitly authorized here). When it is not granted, raises rather than
-- returning an empty/partial set, so the client gets an unambiguous denial
-- rather than something indistinguishable from "no history yet".
-- ----------------------------------------------------------------------------

create or replace function list_history_walks()
returns setof walks as $$
begin
  if current_family_id() is null then
    raise exception 'this device is not a member of a family';
  end if;
  if not has_member_permission('view_history') then
    raise exception 'view_history permission required';
  end if;

  return query select * from walks where family_id = current_family_id();
end;
$$ language plpgsql stable security definer set search_path = public;

create or replace function list_statistics_walks()
returns setof walks as $$
begin
  if current_family_id() is null then
    raise exception 'this device is not a member of a family';
  end if;
  if not has_member_permission('view_statistics') then
    raise exception 'view_statistics permission required';
  end if;

  return query select * from walks where family_id = current_family_id();
end;
$$ language plpgsql stable security definer set search_path = public;

revoke all on function list_history_walks() from public;
grant execute on function list_history_walks() to authenticated;
revoke all on function list_statistics_walks() from public;
grant execute on function list_statistics_walks() to authenticated;

comment on function list_history_walks() is
  'The authorized data source for the History screen (Batch 3 correction #1/#2) — raises ''view_history permission required'' unless has_member_permission(''view_history'') is true for the caller, else returns every walk in the caller''s own family (current_family_id(), never a client-supplied id). Called by src/lib/permissionedWalks.ts and used as HistoryScreen.tsx''s actual display/calculation dataset, not merely an access probe.';
comment on function list_statistics_walks() is
  'The authorized data source for the Statistics screen (Batch 3 correction #1/#2) — raises ''view_statistics permission required'' unless has_member_permission(''view_statistics'') is true for the caller, else returns every walk in the caller''s own family (current_family_id(), never a client-supplied id). Called by src/lib/permissionedWalks.ts and used as StatisticsScreen.tsx''s actual display/calculation dataset, not merely an access probe.';

-- ----------------------------------------------------------------------------
-- 4. get_last_resolved_walk() — FINAL REVIEW CORRECTION, item 3.
--
-- Restores src/logic/nextWalk.ts's computeLastWalk() (HomeScreen's "last
-- walk" card) to its pre-0027 fidelity — finding the single most recently
-- resolved walk regardless of how many days ago — WITHOUT reopening any
-- bulk raw historical access through the operational-window policy in
-- section 2. This is deliberately NOT gated by has_member_permission() at
-- all: showing "your family's most recent walk" as a single operational
-- status fact on Home is exactly what section 2's own comment already
-- carves out as not being what view_history/view_statistics are meant to
-- gate ("was today's walk already done" — this is that same question, just
-- not bounded to today) — it is one row of current operational status, not
-- a searchable/aggregable history log. Every family member may call it.
--
-- Mirrors computeLastWalk()'s own selection rule exactly (re-derived from
-- that function, not guessed): among walks with status IN ('done',
-- 'skipped'), the "finished" instant is completed_at when the walk is
-- 'done' (markWalkDone always sets completed_at; markWalkSkipped never
-- does, so a plain COALESCE onto the walk's own scheduled date+time,
-- interpreted in the family's own timezone exactly like section 2a/0025
-- already do, reproduces computeLastWalk()'s branch correctly with no
-- explicit status CASE needed) — excluding any "finished" instant still in
-- the future relative to now(), then taking the single most recent by that
-- instant. LIMIT 1 is enforced HERE, server-side, not left to the client to
-- self-limit — a modified/older client cannot turn this into a bulk read no
-- matter what it asks for, since the function itself never returns more
-- than one row.
--
-- SECURITY DEFINER (needed: bypasses the operational-window policy in
-- section 2, which is exactly the point — an older resolved walk would
-- otherwise not be visible to select from at all) — revoked from public,
-- granted to authenticated only, same convention as list_history_walks()/
-- list_statistics_walks() above. Family-scoped via current_family_id()
-- alone (re-derived from auth.uid() on every call, never a client-supplied
-- family id) — no cross-family leakage. current_profile_id()/
-- current_family_id() are impersonation-aware exactly as everywhere else in
-- this schema (current_family_id() itself does not change under
-- impersonation — it is keyed off the real device's auth.uid() via
-- family_auth_members regardless of which persona is active — so this
-- RPC's family scoping is already consistent with impersonation the same
-- way list_history_walks()/list_statistics_walks() are). Fails closed
-- (returns zero rows, not an error — same "quiet, not a distinct failure
-- mode" shape as an empty operational window) when current_family_id() is
-- null, i.e. no valid active family/profile for this device.
-- ----------------------------------------------------------------------------

create or replace function get_last_resolved_walk()
returns setof walks as $$
declare
  v_family_id uuid;
begin
  v_family_id := current_family_id();
  if v_family_id is null then
    return; -- no active family/profile: fail closed, zero rows.
  end if;

  return query
    select w.*
    from walks w
    join families f on f.id = w.family_id
    where w.family_id = v_family_id
      and w.status in ('done', 'skipped')
      and coalesce(
            w.completed_at,
            ((w.date::text || ' ' || w.scheduled_time || ':00')::timestamp at time zone f.timezone)
          ) <= now()
    order by coalesce(
               w.completed_at,
               ((w.date::text || ' ' || w.scheduled_time || ':00')::timestamp at time zone f.timezone)
             ) desc
    limit 1;
end;
$$ language plpgsql stable security definer set search_path = public;

revoke all on function get_last_resolved_walk() from public;
grant execute on function get_last_resolved_walk() to authenticated;

comment on function get_last_resolved_walk() is
  'Returns AT MOST ONE row: the caller''s own family''s single most recently resolved (done/skipped) walk, mirroring src/logic/nextWalk.ts''s computeLastWalk() selection rule exactly (completed_at for a done walk, else its own scheduled date+time in the family''s timezone; never a still-future instant; most recent wins). Family-scoped via current_family_id() only, never a client-supplied id. Deliberately NOT gated by has_member_permission() — a single current-status row, not bulk/searchable history — every family member may call it. Restores HomeScreen''s last-walk card fidelity after 0027''s operational-window policy (section 2) stopped exposing older resolved walks via the raw table (Batch 3 final review correction).';
