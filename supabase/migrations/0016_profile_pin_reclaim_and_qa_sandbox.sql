-- ============================================================================
-- 0016_profile_pin_reclaim_and_qa_sandbox.sql
--
-- FOUR parts, now on their SIXTH rework of this file (this "narrow bug fix"
-- pass, correcting a genuine concurrency defect in the PRIOR pass's OWN
-- rate-limit UPSERT — see claim_family_profile_with_pin()'s CONCURRENCY doc
-- comment, "CONCURRENCY — CORRECTED THIS PASS", for the full incident: the
-- prior pass's `on conflict ... do update set fail_count =
-- excluded.fail_count` overwrote with a value precomputed in PL/pgSQL
-- BEFORE the upsert ran, which could lose an increment specifically when
-- two callers raced their FIRST-EVER wrong attempt for a given
-- (caller, target) pair — no row yet existed for `select ... for update` to
-- lock. Now fixed to derive the new count from the conflicting row's OWN
-- current value at write time, and the "cooldown expired -> fresh sequence"
-- behavior is now explicit rather than ambiguous. The PRIOR rework was the
-- "final hardening pass" that introduced this rate limiter in the first
-- place — server-side brute-force protection for
-- claim_family_profile_with_pin() via the new profile_pin_attempts table.
-- The rework before THAT was a "narrow migration/security fix" pass, fixing
-- a lost-claim admin-restoration hole in Part 0's own role-derivation
-- functions — see the "LOST-CLAIM ADVERSARIAL WALKTHROUGH" comment block
-- further down and current_family_role()/is_real_family_admin()'s own
-- updated doc comments for that earlier, unrelated incident and fix):
--   Part 0 — the persona-vs-authorization fix (from the "final correction
--     pass"). Admin ROLE follows the currently-claimed PERSONA, not the
--     device's permanent family_auth_members row. THIS PASS fixes a
--     follow-on bug in this Part's own current_family_role()/
--     is_real_family_admin(): their family_auth_members.role FALLBACK was
--     gated on "no claimed persona", which is also true the instant a
--     device LOSES its claim (not just during genuine first-time
--     bootstrap) — a device that lost its claim could get admin authority
--     re-granted from its stale family_auth_members row. Now gated on a
--     real, server-verifiable bootstrap predicate instead (the family has
--     literally zero active personas yet) — see those two functions' own
--     doc comments.
--   Part 0.5 (from the "narrow security/database correction pass") —
--     column-level lockdown of users.role / users.pin_hash /
--     users.auth_user_id: RLS row policies alone do not stop an ordinary
--     member's legitimate self-edit UPDATE from smuggling a
--     role/pin_hash/auth_user_id change into the SAME statement. Closed
--     with Postgres column-level REVOKE/GRANT plus a defense-in-depth
--     BEFORE UPDATE trigger, both using the app.trusted_write GUC pattern
--     already established by migration 0005 for the walks table. UNCHANGED
--     this pass.
--   Part 1 — profile PIN reclaim. claim_family_profile_with_pin() is the
--     atomic claim-swap transaction fixed in the "narrow security/database
--     correction pass"; its claim/release mechanics (atomicity, ordering,
--     the wrong-PIN-leaves-everything-untouched guarantee) remain UNCHANGED
--     this pass — THIS pass adds a new, additive layer in front of the PIN
--     check itself (server-side attempt limiting, a new
--     profile_pin_attempts table, and a return-type change from `void` to
--     `jsonb` — see that function's own doc comment for exactly why).
--   Part 2 — QA sandbox. enter_qa_sandbox()/exit_qa_sandbox() enforce
--     server-side admin authorization (from the "narrow security/database
--     correction pass") — UNCHANGED this pass; their own admin checks now
--     benefit automatically from Part 0's corrected is_family_admin(),
--     with no code change needed in Part 2 itself (see the walkthrough
--     below, case 9, for qa_reset_full()'s fresh-onboarding bootstrap
--     case specifically).
--
-- REVISION NOTE (narrow bug fix pass — SIXTH rework of this file; all six
-- passes strictly additive/corrective on the SAME ongoing engagement, never
-- a revert): this file was rewritten in place AGAIN, still before ever being
-- applied to a live database. This pass touches ONLY the body of
-- claim_family_profile_with_pin()'s wrong-PIN accounting branch (Part 1) —
-- the profile_pin_attempts table's shape is UNCHANGED (no new columns, no
-- migration needed for anyone who already applied the prior rework's
-- version — the table definition itself did not change, only how this one
-- function writes to it), the 5-attempt/15-minute policy is UNCHANGED, the
-- RPC's jsonb return contract is UNCHANGED (still exactly {"success":true}
-- or {"success":false,"reason":"wrong_pin"|"cooldown"}), and Part 0's
-- role-derivation fix and Part 2's QA sandbox remain untouched. See the
-- HONESTY NOTE further below and this repo's "never modify an
-- ALREADY-APPLIED migration" rule, which does not apply to a migration that
-- was never declared final/applied. If an EARLIER version of this file
-- (from ANY prior pass) was, in fact, already applied to some live project,
-- DO NOT silently re-run this file — see the very bottom of this header for
-- what changed and what a live project needs to do about it.
--
-- ----------------------------------------------------------------------------
-- THE CRITICAL BUG THIS PASS FIXES (persona vs. authorization)
-- ----------------------------------------------------------------------------
-- Before this pass: `family_auth_members.role` (admin/member) is keyed
-- SOLELY by `auth_user_id` — i.e. by which DEVICE/authenticated session you
-- are, set once at create_family()/join_family() time and never touched by
-- anything else. Meanwhile `users.auth_user_id` (which PERSONA a device is
-- currently displaying/attributed as) is a COMPLETELY SEPARATE, freely
-- reclaimable pointer (claim_family_profile() / claim_family_profile_with_pin()
-- in Part 1 below). is_family_admin()/current_family_role() read ONLY
-- family_auth_members, never consulting which persona is claimed.
--
-- Consequence: Dad's device (family_auth_members.role = 'admin' for Dad's
-- auth_user_id) calls claim_family_profile_with_pin('idan-user-id', pin).
-- That UPDATEs users.auth_user_id for Idan's row to Dad's own auth.uid() —
-- the UI now shows "Idan", current_profile_id() now resolves to Idan's
-- users.id — but family_auth_members.role for THAT SAME auth.uid() is
-- COMPLETELY UNTOUCHED, still 'admin'. is_family_admin() still returns
-- true. A "Switch User" to Idan (a member) left the session with full
-- ADMIN authority server-side. That is not an acceptable Switch User — it
-- is a persona swap with no corresponding authorization change, i.e. a
-- privilege-retention bug indistinguishable from a real vulnerability the
-- moment "Switch User" is trusted to mean what it says.
--
-- THE FIX: give `users` its own per-PERSONA `role` column, and make
-- is_family_admin()/current_family_role() (and every RPC that currently
-- reads family_auth_members.role for authorization) derive from the
-- CURRENTLY CLAIMED PERSONA's users.role instead — falling back to
-- family_auth_members.role ONLY in the narrow bootstrap window before any
-- persona has ever been claimed on that device at all (the moment right
-- after create_family()/join_family(), before "add your first family
-- member" has run — see current_family_role()'s own doc comment below for
-- exactly why that fallback is still needed and is safe).
--
-- Chosen over the alternative ("move the family_auth_members row itself
-- when a claim transfers") because: (a) `users` already IS the row that
-- travels with the persona everywhere else in this schema (name, avatar,
-- pin_hash, auth_user_id) — adding role alongside auth_user_id on the SAME
-- row it's already conceptually about is the smallest, most consistent
-- change; (b) family_auth_members.auth_user_id has a UNIQUE index (one
-- row per device, full stop) that many OTHER things legitimately depend on
-- (current_family_id() bootstrap, join_family()'s re-join-keeps-admin
-- logic, the QA sandbox mechanism in Part 2) — repointing/mutating that
-- row's role on every claim transfer would entangle two independent
-- concerns (device-level family membership vs. persona-level authorization)
-- that are cleaner kept apart; (c) it actually FIXES a second, pre-existing,
-- independently-known quirk for free: set_member_role() used to update
-- family_auth_members keyed by the target's auth_user_id AT THE MOMENT OF
-- the role change, which meant a role change could become "orphaned" if the
-- persona was later reclaimed by a different device — anchoring role on
-- users.id (the persona itself, which never changes identity even as its
-- auth_user_id is reclaimed across devices) makes that impossible by
-- construction.
--
-- With this fix: Dad claims Idan's PIN -> current_profile_id() resolves to
-- Idan's users.id -> is_family_admin() reads users.role for Idan's row
-- ('member') -> false. Idan's (real) device later reclaims Dad's profile
-- with Dad's own correct PIN -> current_profile_id() resolves to Dad's
-- users.id -> users.role = 'admin' -> true. Authorization now genuinely
-- follows verified identity, not device history. See the SECURITY
-- WALKTHROUGH comments throughout this file, and the final report, for the
-- full adversarial test-case walkthrough.
--
-- HONESTY NOTE (same standard as every migration this whole engagement):
-- this file is written, reviewed, and internally consistent with the rest
-- of the schema, but has NOT been executed against a live Postgres/
-- Supabase instance from this sandbox (no `node_modules`, no live project
-- here). Apply it via the Supabase SQL editor or CLI (`supabase db push` /
-- `psql -f supabase/migrations/0016_...sql`) against a real project before
-- relying on it. Every statement is `create or replace` / `add column if
-- not exists` / `create table if not exists`, so it is safe to (re-)run
-- against a project that already has an EARLIER version of this exact file
-- applied — but READ "IF YOU ALREADY APPLIED AN EARLIER 0016" at the very
-- bottom of this file first: the users.role backfill has a real,
-- documented edge case for a family with an UNCLAIMED admin persona.
-- ============================================================================


-- ============================================================================
-- PART 0 — persona-anchored authorization (THE critical fix)
-- ============================================================================

-- ----------------------------------------------------------------------------
-- users.role — the new, authoritative source of admin/member authorization,
-- anchored to the PERSONA (this row), never to a device. Defaults to
-- 'member'; the bootstrap trigger below forces the FIRST active member ever
-- inserted for a family to 'admin' (mirroring the pre-existing product
-- expectation that the family's creator/first member starts as its admin —
-- see the trigger's own comment for why it's a trigger, not a client-
-- supplied value, even from an already-verified-admin caller).
-- ----------------------------------------------------------------------------
alter table users add column if not exists role text not null default 'member' check (role in ('admin', 'member'));

comment on column users.role is
  'Admin/member role, anchored to THIS PERSONA — not to any device. The authoritative source for is_family_admin()/current_family_role() once this persona has ever been claimed by any device. See this migration''s Part 0 header for the full persona-vs-authorization fix this column exists to close.';

-- One-time backfill for a project that already has real family_auth_members
-- rows from before this column existed: every CURRENTLY CLAIMED persona
-- inherits its claiming device's existing family_auth_members.role, so no
-- currently-active admin session loses authority the moment this migration
-- is applied. Idempotent (safe to re-run — a matching row is simply left
-- unchanged). See "IF YOU ALREADY APPLIED AN EARLIER 0016" at the bottom of
-- this file for the one real edge case this backfill cannot cover
-- (an UNCLAIMED persona that was always intended to be the family's admin).
update users u
set role = fam.role
from family_auth_members fam
where fam.auth_user_id = u.auth_user_id
  and u.auth_user_id is not null
  and u.role is distinct from fam.role;

-- ----------------------------------------------------------------------------
-- Bootstrap trigger: the FIRST active (non-removed) member ever inserted for
-- a family always becomes 'admin', regardless of what role value (if any)
-- the insert statement supplied. This is deliberately a trigger that FORCES
-- the value, not a conditional default the caller could override, because
-- the "insert users" RLS policy only requires the CALLER to already be a
-- family admin — it says nothing about the ROLE of the row being inserted,
-- and an admin crafting a raw insert with an explicit `role: 'admin'` for a
-- BRAND NEW member would otherwise be able to grant admin at creation time
-- with no audit trail at all (set_member_role() below is the only path that
-- logs a role grant). Forcing role here, unconditionally, based purely on
-- "is this the first active member of this family" closes that outright —
-- every role grant for every member after the first must go through the
-- audited set_member_role() RPC.
-- ----------------------------------------------------------------------------
create or replace function bootstrap_first_member_role()
returns trigger as $$
begin
  if exists (
    select 1 from users
    where family_id = new.family_id
      and removed_at is null
  ) then
    new.role := 'member';
  else
    new.role := 'admin';
  end if;
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_bootstrap_first_member_role on users;
create trigger trg_bootstrap_first_member_role
before insert on users
for each row execute function bootstrap_first_member_role();

-- ----------------------------------------------------------------------------
-- current_family_role() — REWORKED, and REWORKED AGAIN this pass (narrow
-- migration/security fix — the "lost-claim admin-restoration" bug). Still
-- the DEVICE's own real role (never impersonation-aware — unchanged
-- contract from before this pass; the client's authStore.familyRole has
-- always meant "this device's real role", and every call site already
-- relies on that), resolved from the CURRENTLY CLAIMED PERSONA's users.role
-- when one exists, falling back to family_auth_members.role ONLY during a
-- genuine, SERVER-VERIFIABLE bootstrap window — see the "THE BUG THIS
-- CLOSES" comment block directly above bootstrap_first_member_role() near
-- the top of this Part for the full incident walkthrough; summarized here:
--
-- THE BUG: the PREVIOUS version of this function (and of
-- is_real_family_admin() below) treated "persona_id is null" itself as the
-- bootstrap signal. That condition is also true the instant a device LOSES
-- its claim — e.g. Device A holds Dad/Admin, Device B claims Dad away via
-- claim_family_profile_with_pin() (the atomic transfer from an earlier
-- pass, itself correct and UNCHANGED by this fix). The instant that
-- commits, A's real_current_profile_id() is null again — and the OLD
-- fallback re-granted A admin authority straight from
-- family_auth_members.role, EVEN THOUGH the family has active personas and
-- A currently holds none of them. That defeats the entire fail-closed
-- lost-claim model the claim/release mechanism exists to guarantee, at the
-- SQL/RPC layer directly — independent of whatever the client's own
-- foreground revalidation (checkClaimStillValid()) has or hasn't noticed
-- yet. A direct RPC call from A in that window must fail safely regardless.
--
-- THE FIX: "no claimed persona" is NOT synonymous with "this family has
-- never had anyone claim a persona yet." The fallback is now gated on an
-- independent, SERVER-VERIFIABLE bootstrap predicate — reusing the EXACT
-- SAME condition bootstrap_first_member_role() (above) already uses to
-- decide "is this genuinely the first member ever" —
-- `not exists (select 1 from users where family_id = fam_id and
-- removed_at is null)`, i.e. the family has LITERALLY ZERO active
-- (non-removed) personas in existence. This is true right after
-- create_family()/join_family(), before "add your first family member" has
-- ever run (LoginScreen's admin-only "+ הוספת בן משפחה" button, and the
-- equivalent QA-sandbox-entry moment in Part 2, both still depend on this
-- resolving correctly with zero personas claimed yet — UNCHANGED, this
-- case still works exactly as before) — and it is ALSO true again,
-- correctly, right after qa_reset_full() deliberately wipes every persona
-- in a QA family for a fresh-onboarding restart (see qa_reset_full()'s own
-- doc comment — no special-casing needed there: this predicate is
-- evaluated fresh on every call, so a QA family that legitimately has zero
-- personas right now is legitimately back in bootstrap territory,
-- regardless of whether it had personas an hour ago). It is FALSE — the
-- fallback is CLOSED — for every device with no claim of its own the
-- moment ANY active persona exists anywhere in that family, regardless of
-- WHY that device has no claim: never claimed one yet (a newly-joined
-- device via join_family(), case 10 below), or had one and lost it (the
-- actual vulnerability this closes).
--
-- real_current_profile_id() (not current_profile_id()) is used deliberately
-- — it is NOT impersonation-aware, preserving this function's existing
-- "always the real role" contract.
-- ----------------------------------------------------------------------------
create or replace function current_family_role()
returns text as $$
declare
  persona_id uuid;
  persona_role text;
  fam_id uuid;
begin
  persona_id := real_current_profile_id();
  if persona_id is not null then
    select role into persona_role from users where id = persona_id;
    return persona_role;
  end if;

  fam_id := current_family_id();
  if fam_id is null then
    return null; -- no family membership at all yet (before create_family()/join_family())
  end if;

  -- Bootstrap-only fallback — see the doc comment above for the full
  -- reasoning. Reuses bootstrap_first_member_role()'s exact predicate.
  if exists (select 1 from users where family_id = fam_id and removed_at is null) then
    return null; -- fail closed: an active persona exists somewhere in this family, and this device holds none of them
  end if;

  return (select role from family_auth_members where auth_user_id = auth.uid() and family_id = fam_id limit 1);
end;
$$ language plpgsql stable security definer set search_path = public;

-- ----------------------------------------------------------------------------
-- is_real_family_admin(target_family_id) — REWORKED, and REWORKED AGAIN
-- this pass — same bootstrap-predicate fix, same persona-first /
-- genuinely-gated-family_auth_members-fallback shape as current_family_role()
-- above (see its doc comment for the full "lost-claim admin-restoration"
-- incident walkthrough and fix rationale — this function had the IDENTICAL
-- bug and gets the IDENTICAL fix). This is the REAL (impersonation-UNAWARE)
-- check — is_family_admin() (0006) already wraps this with `when
-- active_impersonation_target() is not null then false`, and that wrapper
-- is UNCHANGED by this migration: impersonation still always resolves to
-- "not an admin, act as the impersonated member", fully independent of
-- this rework. target_family_id is still checked explicitly (not silently
-- trusted to equal current_family_id()) exactly like before.
-- ----------------------------------------------------------------------------
create or replace function is_real_family_admin(target_family_id uuid)
returns boolean as $$
declare
  persona_id uuid;
begin
  persona_id := real_current_profile_id();
  if persona_id is not null then
    return exists (
      select 1 from users
      where id = persona_id
        and family_id = target_family_id
        and role = 'admin'
        and removed_at is null
    );
  end if;

  -- Bootstrap-only fallback — see current_family_role()'s doc comment
  -- above for the full reasoning. Reuses bootstrap_first_member_role()'s
  -- exact predicate. This is the actual fix: previously this branch was
  -- reached (and could return true) merely because persona_id was null —
  -- including the instant AFTER a legitimate persona loss (another device
  -- claimed it away via claim_family_profile_with_pin()). Now it can only
  -- ever return true here when target_family_id genuinely has zero active
  -- personas in existence yet.
  if exists (select 1 from users where family_id = target_family_id and removed_at is null) then
    return false; -- fail closed: an active persona exists somewhere in this family, and this device holds none of them
  end if;

  return exists (
    select 1 from family_auth_members
    where auth_user_id = auth.uid()
      and family_id = target_family_id
      and role = 'admin'
  );
end;
$$ language plpgsql stable security definer set search_path = public;

-- ============================================================================
-- LOST-CLAIM ADVERSARIAL WALKTHROUGH (narrow migration/security fix pass) —
-- the 10 required cases, reasoned through against the corrected
-- current_family_role()/is_real_family_admin() above (also expressed as
-- real pure-logic Jest tests wherever the reasoning is client-observable —
-- see authStore.test.ts's "lost-claim admin-restoration fix" describe
-- block):
--
-- 1. Brand-new family, zero active users: create_family() inserts the
--    family_auth_members row (role='admin') and nothing into `users` yet.
--    The bootstrap predicate (`not exists ... users where family_id = fam
--    and removed_at is null`) is TRUE. is_family_admin(fam) resolves via
--    the fallback -> true. The creator can perform the minimum legitimate
--    bootstrap action: insert the first family member (RLS's "insert users
--    (family admins only)" policy passes).
--
-- 2. First persona created: bootstrap_first_member_role() forces that row
--    to role='admin' (unchanged by this pass). The creating device
--    immediately claims it (LoginScreen's "wasFirstUser" -> signIn(),
--    unchanged). From that moment, real_current_profile_id() is non-null
--    for this device -> current_family_role()/is_real_family_admin() take
--    the PERSONA branch, never reaching the fallback at all -> correctly
--    resolves admin from users.role. The bootstrap window is closed
--    (`exists (...)` is now true for any OTHER device with no claim).
--
-- 3. Dad/Admin -> Idan/Member real switch (Device A only):
--    claim_family_profile_with_pin('idan', pin) sets A's auth.uid() onto
--    Idan's row (atomic release+claim, UNCHANGED by this pass).
--    real_current_profile_id() -> Idan's id -> current_family_role() takes
--    the PERSONA branch -> Idan's users.role = 'member'. Never reaches the
--    fallback. CONFIRMED.
--
-- 4. THE CORE FIX — Device B claims Idan away from Device A: B calls
--    claim_family_profile_with_pin('idan', pin); the atomic swap clears
--    Idan's row's auth_user_id then sets it to B's auth.uid() — A's
--    auth.uid() no longer matches ANY row. On A:
--    real_current_profile_id() -> null (no row has auth_user_id = A's
--    auth.uid() any more). current_family_role()/is_real_family_admin()
--    fall through to the bootstrap check — and the family plainly has
--    active personas (Dad, Idan, ...) — `exists (...)` is TRUE -> the
--    fallback branch is NEVER REACHED -> current_family_role() returns
--    null, is_family_admin() returns false. A gets NO role, NO admin,
--    PERIOD — regardless of what A's family_auth_members.role still says
--    (still 'admin' from A's original create_family() call, and that is
--    now correctly irrelevant). THIS is the exact scenario the previous
--    version of these two functions got wrong (old condition: "persona_id
--    is null" -> true here too -> old fallback incorrectly re-granted A
--    admin from family_auth_members.role). Fixed.
--
-- 5. Before any UI revalidation runs on A — enforced at the SQL/RPC layer,
--    NOT client timing: every admin-only RPC (set_member_role(),
--    admin_delete_family_member(), admin_list_family_activity(),
--    enter_qa_sandbox(), exit_qa_sandbox(), qa_reset_data()/qa_reset_full(),
--    regenerate_invite_code(), ...) calls is_family_admin()/
--    is_real_family_admin() itself, server-side, on EVERY invocation —
--    there is no cached/session-level admin flag anywhere in this schema.
--    The instant B's claim transfer commits, A's VERY NEXT direct RPC call
--    (whether or not A's own client-side checkClaimStillValid() has run,
--    whether or not A's app is even in the foreground) re-evaluates from
--    scratch and is denied by case 4's reasoning above. Client-side
--    revalidation (authStore.ts, unchanged) is a UX nicety that surfaces
--    this to the person promptly — it is never what actually enforces it.
--
-- 6. A reclaims Dad with the correct Dad PIN:
--    claim_family_profile_with_pin('dad', correctPin) — PIN verified
--    against Dad's row, atomic release(A's current null-claim, a no-op)
--    +claim. real_current_profile_id() on A -> Dad's id -> persona branch
--    -> Dad's users.role = 'admin'. Admin correctly restored, via the
--    SAME verified-claim mechanism as any other switch — no special case
--    needed.
--
-- 7. A reclaims Idan (instead): same mechanism, resolves to
--    Idan's users.role = 'member'. CONFIRMED.
--
-- 8. Local stale currentUserId after a lost claim: authStore's
--    currentUserId (client cache) is never read by any RLS policy or RPC —
--    every one of them derives identity server-side from
--    `users.auth_user_id = auth.uid()` (case 4) alone. A's client showing
--    a stale "Dad" locally changes nothing about what case 4/5 above
--    already deny at the server. No server privilege is ever restored by
--    local state, by construction.
--
-- 9. QA full reset leaves a QA family with zero personas: qa_reset_full()
--    (Part 2, unchanged mechanism, still admin-gated on ENTRY exactly as
--    before) deletes every users row for that QA family. Immediately
--    after, the bootstrap predicate re-evaluates TRUE for that family
--    (zero active personas, dynamically, no caching) -> the SAME "add your
--    first member" bootstrap flow that worked at real case 1 above works
--    identically inside the now-empty QA family — no special-casing
--    required in qa_reset_full() itself; this falls out of the predicate
--    being re-evaluated fresh on every call rather than being some
--    one-time "has this family EVER had a member" flag.
--
-- 10. Joining an existing family (with active personas) that this device
--     has not yet claimed a profile in: join_family() (unchanged) already
--     sets family_auth_members.role = 'member' for a genuinely new join
--     (only preserves 'admin' when RE-joining the SAME family where this
--     exact device was already admin) — so this was never an admin-grant
--     vector even under the old code. Under the fix, it is airtight
--     either way: the target family already has active personas, so the
--     bootstrap predicate is false and the fallback is closed entirely —
--     current_family_role() returns null (not even 'member') until this
--     device actually claims a persona, and is_family_admin() is false
--     regardless of whatever family_auth_members.role holds. No accidental
--     admin, confirmed structurally impossible by the predicate alone
--     (independent of join_family()'s own already-correct role choice).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- set_member_role(p_user_id, p_role) — REWORKED to write users.role for the
-- PERSONA directly, rather than family_auth_members keyed by whichever
-- device currently holds that persona's claim. This also lifts the old
-- "target member has no linked auth session" restriction — an admin can now
-- promote/demote an UNCLAIMED persona too (there is no longer any reason
-- not to: role lives on the persona itself, independent of any claim).
-- Last-admin guard now counts ACTIVE PERSONAS with role='admin' in the
-- family (excluding the target), not family_auth_members rows — correct
-- under the new model, since a family could in principle have more admin
-- PERSONAS than currently-claimed devices (an unclaimed admin persona still
-- counts as "an admin of this family" for the purpose of never reaching
-- zero).
-- ----------------------------------------------------------------------------
create or replace function set_member_role(p_user_id uuid, p_role text)
returns void as $$
declare
  admin_profile uuid;
  target_family uuid;
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

  select family_id, removed_at, role
    into target_family, target_removed_at, current_role
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
  -- during an impersonation session — see 0006, unchanged by this rework).
  if not is_family_admin(target_family) then
    raise exception 'admin permission required';
  end if;

  if target_removed_at is not null then
    raise exception 'cannot change the role of a removed member';
  end if;

  if current_role = p_role then
    return; -- no-op, nothing to do or audit
  end if;

  -- Serialize concurrent role changes within this family (unchanged).
  perform pg_advisory_xact_lock(hashtext('set_member_role:' || target_family::text));

  -- Zero-admin guard: count active ADMIN PERSONAS in this family excluding
  -- the target, then decide if the family still has >= 1 admin afterward.
  select count(*) into remaining_admins
  from users u
  where u.family_id = target_family
    and u.role = 'admin'
    and u.id <> p_user_id
    and u.removed_at is null;

  if p_role = 'member' and remaining_admins = 0 then
    raise exception 'cannot demote the last admin of this family';
  end if;

  -- Part 0.5: role is a protected column at the database level now — flag
  -- this write as trusted, transaction-locally, immediately around it.
  perform set_config('app.trusted_write', 'on', true);
  update users
  set role = p_role
  where id = p_user_id;
  perform set_config('app.trusted_write', 'off', true);

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

-- ----------------------------------------------------------------------------
-- admin_delete_family_member() — REWORKED last-admin guard: same
-- users.role-based count as set_member_role() above, and — importantly —
-- no longer gated on "target_auth_user_id is not null" (an unclaimed
-- persona can now hold role='admin' too, and removing it must be blocked
-- exactly the same way). Everything else about this function (the
-- rotation/schedule/walk replacement-id validation, the actual delete
-- itself) is UNCHANGED — copied verbatim, only the guard block replaced.
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
  target_role text;
  item jsonb;
  elem text;
  remaining_admins int;
begin
  if auth.uid() is null then
    raise exception 'must be authenticated';
  end if;

  select family_id, role into target_family, target_role from users where id = target_user_id;
  if target_family is null then
    raise exception 'user not found';
  end if;

  if target_family is distinct from current_family_id() then
    raise exception 'not a member of this user''s family';
  end if;

  if not is_family_admin(target_family) then
    raise exception 'admin permission required';
  end if;

  -- Removing the family's last remaining Admin persona must be rejected,
  -- exactly like demoting them would be — a family with zero Admin
  -- personas can never manage roles/removals again.
  if target_role = 'admin' then
    perform pg_advisory_xact_lock(hashtext('set_member_role:' || target_family::text));

    select count(*) into remaining_admins
    from users u
    where u.family_id = target_family
      and u.role = 'admin'
      and u.id <> target_user_id
      and u.removed_at is null;

    if remaining_admins = 0 then
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
$$ language plpgsql volatile security definer set search_path = public;

-- ----------------------------------------------------------------------------
-- admin_list_family_activity() — REWORKED to read u.role directly instead of
-- joining family_auth_members (which, under the OLD model, showed null for
-- an unclaimed persona and — this is the actual bug fix relevant here —
-- showed the CLAIMING DEVICE's role rather than the persona's own role once
-- claimed, i.e. FamilyScreen's role badges were reading the exact same
-- buggy source this whole migration corrects). Everything else unchanged.
-- ----------------------------------------------------------------------------
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
    u.role,
    u.removed_at,
    up.last_seen_at
  from users u
  left join user_presence up on up.user_id = u.id
  where u.family_id = current_family_id()
  order by u.removed_at nulls first, up.last_seen_at desc nulls last, u.name;
end;
$$ language plpgsql stable security definer set search_path = public;

-- ============================================================================
-- SECURITY WALKTHROUGH — the exact adversarial test cases required for this
-- pass, reasoned through against the SQL above (also expressed as literal
-- Jest tests against a mocked RPC layer — see authStore.test.ts):
--
-- 1. "Member locally sets currentUserId to Dad's id -> must not gain admin."
--    The client's currentUserId is never read by any RLS policy or RPC —
--    every one of them calls current_profile_id()/is_family_admin(), which
--    derive entirely from `users.auth_user_id = auth.uid()` (a value the
--    server alone sets, via claim_family_profile()/..._with_pin(), never
--    trusted from the client) and `users.role` on THAT row. A client
--    mutating its own in-memory currentUserId changes what the SCREEN
--    displays and nothing else — the very next server call re-resolves
--    identity from scratch and ignores it entirely.
--
-- 2. "Dad verifies Idan's PIN -> server permissions become Idan's (not
--    Dad's) — the core fix." claim_family_profile_with_pin() (Part 1) sets
--    users.auth_user_id = auth.uid() on IDAN's row. current_profile_id()
--    now resolves to Idan's users.id. is_real_family_admin() (Part 0) reads
--    real_current_profile_id() -> Idan's users.id -> users.role for THAT
--    row = 'member' -> false. Any admin-only RPC (set_member_role,
--    admin_delete_family_member, admin_list_family_activity,
--    create_family_invite, begin_impersonation, qa_reset_data/qa_reset_full
--    in Part 2, ...) now rejects this session with 'admin permission
--    required' / the RPC's own admin-only message. FIXED.
--
-- 3. "Idan verifies Dad's PIN -> admin only because the verified identity is
--    actually Dad." Same mechanism, symmetric: users.auth_user_id for
--    Dad's row becomes this device's auth.uid(); is_real_family_admin()
--    resolves Dad's users.role = 'admin' -> true. Critically, this ONLY
--    happens because claim_family_profile_with_pin() independently verified
--    Dad's actual bcrypt PIN hash (Part 1) — there is no path to Dad's
--    admin authority that does not go through that verification.
--
-- 4. "Wrong PIN -> no role/claim change at all." claim_family_profile_with_pin()
--    raises 'incorrect PIN' BEFORE the UPDATE statement that moves
--    auth_user_id runs (see Part 1) — no row is touched, users.auth_user_id
--    and every persona's users.role are exactly as they were.
--
-- 5. "Lost claim -> old device cannot continue operating with old
--    authority." The moment a transfer succeeds, the OLD device's cached
--    currentUserId no longer satisfies `users.auth_user_id = auth.uid()`
--    for that row (a DIFFERENT device's auth.uid() now occupies it) — every
--    subsequent write from the old device is rejected by RLS/RPC identity
--    checks regardless of what it has cached client-side. The client-side
--    checkClaimStillValid()/revalidateClaim() mechanism (authStore.ts,
--    unchanged by this pass) detects this via whoami() and clears the
--    stale local session — see Deliverable 1E below for the full
--    walkthrough re-verified against this corrected model.
--
-- 6. "Impersonation -> admin actor stays identifiable separately from
--    real-switch." UNCHANGED by this migration, and this is exactly why:
--    begin_impersonation()/active_impersonation_target()/is_family_admin()'s
--    impersonation wrapper (0006) never touch users.auth_user_id or
--    users.role at all — impersonation is a SEPARATE session table
--    (impersonation_sessions) layered on top, re-validated per call,
--    leaving the REAL claim (and now the real per-persona role) completely
--    untouched underneath. is_family_admin() short-circuits to false while
--    impersonating (server-side authorization correctly narrows to the
--    impersonated member) while is_real_family_admin() — used by
--    log_audit_event() via real_current_profile_id() for the
--    impersonated_by_admin_user_id column — still correctly resolves the
--    REAL admin underneath. actor (impersonated_by_admin_user_id) stays
--    distinct from persona (actor_user_id) by construction, exactly as
--    before. A REAL switch-user (Part 1's PIN transfer), by contrast,
--    changes which persona auth_user_id itself points at — there is no
--    "underneath" to preserve, which is the entire point: it is a REAL
--    identity change, not a UI simulation.
--
-- 7. "QA family can't reach real-family data" / "QA reset can't target the
--    real family" — see Part 2 below.
-- ============================================================================


-- ============================================================================
-- PART 0.5 (NEW, narrow security/database correction pass) — lock down
-- users.role / users.pin_hash / users.auth_user_id at the DATABASE level,
-- not just via RLS row policies.
--
-- THE GAP THIS CLOSES: the "update users (self or admin, active profiles
-- only)" RLS policy (schema.sql) controls which ROWS an authenticated client
-- may UPDATE (its own row, or any row if it's an admin) — it says NOTHING
-- about which COLUMNS a permitted UPDATE may touch. Before this section, an
-- ordinary member, editing their OWN row (which the policy freely allows —
-- it IS their own profile), could issue a direct PostgREST call like
-- `update users set name = 'x', role = 'admin' where id = <self>` and it
-- would pass RLS cleanly: it's their own row, self-edit is allowed, and
-- nothing previously stopped `role` (or `pin_hash`, or `auth_user_id`) from
-- riding along in the SAME statement's SET list. That is a real, direct
-- self-promotion-to-admin path that has nothing to do with any RPC.
--
-- TWO independent layers, either of which alone would close the gap, both
-- applied for defense-in-depth:
--
-- LAYER A — Postgres column-level privileges (the primary fix). Postgres
-- supports GRANT/REVOKE UPDATE on a specific column list; an UPDATE whose
-- SET list includes ANY column the caller lacks privilege on is rejected in
-- full (not partially applied) at the privilege-check stage, before RLS
-- policies or triggers even run. This repo's schema.sql has NO blanket
-- `grant ... to authenticated` statements anywhere — it relies entirely on
-- Supabase's default privilege model (the `authenticated` role gets full
-- table DML by default, RLS is the only gate). So closing this requires an
-- EXPLICIT revoke first, then a narrower grant naming only the columns a
-- direct client UPDATE/INSERT is legitimate for.
--
-- Verified against the ACTUAL client code (src/data/supabaseRepository.ts)
-- before choosing the column list: fromUser() — used by BOTH upsertUser()'s
-- UPDATE and its insert-fallback/createUser()'s INSERT — builds exactly
-- {id, family_id, name, avatar, photo_url, color, reminders_enabled,
-- removed_at}, NEVER role/pin_hash/auth_user_id. updateUserReminderSetting()
-- touches only {reminders_enabled}. So this grant list is a precise match
-- for existing behavior — zero client-side breakage, nothing to split.
-- id/family_id are included only because a client-side INSERT (createUser())
-- must supply them; family_id on UPDATE is never actually changed by the
-- client (fromUser() always echoes the row's own family_id back), but
-- column privileges cannot distinguish "same value" from "changed value" —
-- only RLS's `with check (family_id = current_family_id() ...)` clause does
-- that distinguishing, and it still fully applies underneath this layer.
--
-- SECURITY DEFINER functions (set_member_role, set_profile_pin,
-- claim_family_profile[_with_pin], enter_qa_sandbox, exit_qa_sandbox, ...)
-- are COMPLETELY UNAFFECTED by this revoke/grant — a SECURITY DEFINER
-- function's internal statements run as the function's OWNER role, which
-- always has full table privileges regardless of what `authenticated` is
-- granted. Column privileges only ever gate a DIRECT client REST call
-- issued as `authenticated` — exactly the vector this closes.
-- ----------------------------------------------------------------------------
revoke update on public.users from authenticated;
grant update (name, avatar, photo_url, color, reminders_enabled, removed_at)
  on public.users to authenticated;

revoke insert on public.users from authenticated;
grant insert (id, family_id, name, avatar, photo_url, color, reminders_enabled, removed_at)
  on public.users to authenticated;

-- ----------------------------------------------------------------------------
-- LAYER B — enforce_users_protected_columns() trigger (defense-in-depth).
-- Belt-and-suspenders in case a FUTURE client change ever needs to grant
-- broader column privileges for some other legitimate field (at which point
-- Layer A's protection would erode unless someone remembers to keep
-- role/pin_hash/auth_user_id carved out by hand) — this trigger is a SECOND,
-- independent backstop that catches an attempt to change any of the three
-- protected columns regardless of what table-level privileges say, UNLESS
-- the write is flagged as trusted via the SAME `app.trusted_write` GUC
-- pattern already established by migration 0005's
-- enforce_walk_write_authorization() for the `walks` table. Every RPC in
-- this schema that legitimately writes one of these three columns wraps its
-- protected UPDATE with `perform set_config('app.trusted_write', 'on',
-- true);` / `... 'off' ...` immediately before/after — see set_member_role(),
-- set_profile_pin(), claim_family_profile(), claim_family_profile_with_pin(),
-- enter_qa_sandbox(), exit_qa_sandbox() below, all updated in this pass.
-- set_config(..., true) is transaction-LOCAL, so an exception anywhere
-- inside the wrapped block rolls back the GUC change together with
-- everything else — no try/finally needed, matching 0005's own idiom
-- exactly, and PostgREST already wraps each RPC call in its own transaction.
-- ----------------------------------------------------------------------------
create or replace function enforce_users_protected_columns()
returns trigger as $$
begin
  if coalesce(current_setting('app.trusted_write', true), '') = 'on' then
    return new;
  end if;

  if new.role is distinct from old.role then
    raise exception 'users.role can only be changed via set_member_role()';
  end if;

  if new.pin_hash is distinct from old.pin_hash then
    raise exception 'users.pin_hash can only be changed via set_profile_pin()';
  end if;

  if new.auth_user_id is distinct from old.auth_user_id then
    raise exception 'users.auth_user_id can only be changed via claim_family_profile() / claim_family_profile_with_pin() / enter_qa_sandbox() / exit_qa_sandbox()';
  end if;

  return new;
end;
$$ language plpgsql security definer set search_path = public;

drop trigger if exists users_protected_columns on users;
create trigger users_protected_columns
  before update on users
  for each row execute function enforce_users_protected_columns();

comment on function enforce_users_protected_columns() is
  'Defense-in-depth backstop (see Part 0.5 doc comment above) alongside the column-privilege REVOKE/GRANT on public.users: blocks any UPDATE that changes role, pin_hash, or auth_user_id unless app.trusted_write=on for the current transaction, a flag set only by this schema''s own authorized RPCs immediately around their own protected writes.';

-- ----------------------------------------------------------------------------
-- ADVERSARIAL PROOF (Part 0.5, required by this pass) — reasoned through
-- against the SQL above, also expressed as literal Jest tests wherever
-- expressible without a live database (see authStore.test.ts):
--
-- A. "Member's direct UPDATE setting role='admin' on their OWN row" ->
--    DENIED at the privilege-check stage (Layer A: `authenticated` has no
--    UPDATE privilege on the `role` column at all — the statement is
--    rejected before RLS or any trigger runs) AND, even if Layer A were
--    somehow absent, DENIED again by Layer B (enforce_users_protected_columns
--    sees NEW.role <> OLD.role with app.trusted_write unset -> raises).
--
-- B. "Member's direct UPDATE of ordinary editable fields (name, avatar,
--    photo_url, color, reminders_enabled) on their own row" -> STILL WORKS:
--    Layer A explicitly grants these columns; RLS's existing "self" branch
--    still applies underneath; Layer B's trigger only inspects
--    role/pin_hash/auth_user_id and returns NEW unchanged for everything
--    else.
--
-- C. "Member's direct UPDATE of pin_hash on their own row" -> DENIED, same
--    two-layer reasoning as A (pin_hash is excluded from Layer A's grant;
--    Layer B raises on NEW.pin_hash <> OLD.pin_hash).
--
-- D. "set_member_role() called by an authorized admin" -> WORKS: the
--    function is SECURITY DEFINER (bypasses Layer A entirely, runs as owner)
--    and now wraps its `update users set role = ...` with
--    app.trusted_write='on' (bypasses Layer B). Its own is_family_admin()
--    check (unchanged) is what actually gates WHO may call it successfully —
--    Part 0.5 does not touch that authorization logic, only the
--    column-protection layer underneath it.
--
-- E. "set_member_role() called by a non-admin member" -> DENIED, same as
--    before this pass — is_family_admin(target_family) raises 'admin
--    permission required' before the UPDATE is ever reached. Unaffected by
--    Part 0.5 (that check was already there; Part 0.5 only adds protection
--    for the case where a caller bypasses the RPC entirely and goes
--    straight at the table).
--
-- F. "set_profile_pin() through its authorized path (self, or admin
--    resetting a non-admin member's PIN)" -> WORKS, same reasoning as D:
--    SECURITY DEFINER bypasses Layer A, app.trusted_write bypasses Layer B,
--    the function's own pre-existing eligibility checks are what actually
--    gate the call.
-- ============================================================================


-- ============================================================================
-- PART 1 — profile PIN reclaim (Part F1)
-- ============================================================================

-- ----------------------------------------------------------------------------
-- users.pin_hash — bcrypt hash only, NEVER plaintext. Nullable: a profile
-- with no PIN set simply has no reclaim path (claim_family_profile_with_pin
-- below refuses with a clear error telling the member to ask their family
-- admin, rather than silently doing nothing or falling back to something
-- weaker). Setting a PIN is opt-in, via set_profile_pin() below.
--
-- RATE-LIMITING / BRUTE-FORCE EXPOSURE (documented per this pass's explicit
-- requirement, NOT implemented here): claim_family_profile_with_pin() below
-- has no attempt counter, cooldown, or lockout — an attacker who is already
-- an authenticated member of the SAME family (this RPC is family-scoped;
-- current_family_id() must already match) could script repeated calls
-- against a 4-6 digit PIN. A 4-digit PIN has only 10,000 possibilities;
-- Postgres can evaluate bcrypt (deliberately slow, ~50-100ms per check with
-- a reasonable cost factor) fast enough that an unthrottled loop is a real,
-- practical risk over a period of hours, not a theoretical one. A real
-- deployment should add: (a) a per-target-profile attempt counter with an
-- escalating cooldown or hard lockout after e.g. 5 wrong attempts within a
-- window, stored server-side (a new small table, checked at the top of
-- claim_family_profile_with_pin() before the bcrypt comparison), and/or (b)
-- Supabase's own rate-limiting/Edge-Function-fronting for this RPC
-- specifically. Out of scope to implement blind in this sandbox (no live
-- database to tune cooldown thresholds against), but this is a real,
-- specific gap, not a hand-wave — track it before a production launch.
-- ----------------------------------------------------------------------------
alter table users add column if not exists pin_hash text;

comment on column users.pin_hash is
  'bcrypt hash (pgcrypto crypt()/gen_salt(''bf'')) of an optional short PIN, used ONLY by claim_family_profile_with_pin() to let a member''s second device reclaim their own already-claimed profile. Never plaintext. Null = no PIN set = no reclaim path for this profile. See this migration''s rate-limiting exposure note above.';

-- ----------------------------------------------------------------------------
-- set_profile_pin(p_user_id, p_pin)
--
-- Sets (or changes, or — with p_pin null — clears) a profile's PIN.
-- Callable by:
--   (a) the profile's own CURRENT claim holder (auth_user_id = auth.uid()) —
--       ALWAYS allowed, for any profile including an admin's own, or
--   (b) a family admin (is_family_admin — now persona-anchored, Part 0), for
--       resetting a member's PIN when they're locked out — BUT ONLY when
--       the target profile is NOT currently an admin persona. PRODUCT
--       CHOICE (explicit, per this pass's instruction to state it): one
--       admin resetting ANOTHER admin's PIN is blocked outright, with no
--       exception found in this codebase's existing product docs/comments
--       that would justify allowing it — the risk (silently reset another
--       admin's PIN, then reclaim their profile, then act under their name
--       in the audit log) outweighs the convenience, and there is always a
--       safe fallback (that admin resets their own PIN themselves, or, if
--       truly locked out of every device, a DIRECT database/dashboard
--       action by whoever holds the Supabase project's own credentials —
--       the same "break glass" tier already relied on for is_qa). "Is the
--       target currently an admin" is now checked directly via
--       users.role — Part 0's fix, simpler and more robust than the
--       previous version's family_auth_members lookup (which required the
--       target to currently be CLAIMED to even evaluate correctly; an
--       unclaimed admin persona is unambiguous now: users.role is a
--       property of the persona itself, claimed or not).
-- ----------------------------------------------------------------------------
create or replace function set_profile_pin(p_user_id uuid, p_pin text)
returns void as $$
declare
  target_family uuid;
  target_auth_user_id uuid;
  target_removed_at timestamptz;
  target_role text;
  caller_profile uuid;
begin
  if auth.uid() is null then
    raise exception 'must be authenticated';
  end if;

  select family_id, auth_user_id, removed_at, role
    into target_family, target_auth_user_id, target_removed_at, target_role
  from users
  where id = p_user_id;

  if target_family is null then
    raise exception 'user not found';
  end if;

  if target_family is distinct from current_family_id() then
    raise exception 'not a member of this user''s family';
  end if;

  if target_removed_at is not null then
    raise exception 'cannot set a PIN for a removed profile';
  end if;

  if target_auth_user_id is distinct from auth.uid() then
    -- Not self — must be a family admin, AND the target must not itself
    -- currently be an admin persona (see the doc comment above).
    if target_role = 'admin' then
      raise exception 'an admin''s own PIN can only be set by that admin themselves';
    end if;

    if not is_family_admin(target_family) then
      raise exception 'only the profile''s own device or a family admin may set its PIN';
    end if;
  end if;

  caller_profile := current_profile_id();

  if p_pin is null then
    -- Part 0.5: pin_hash is a protected column at the database level now.
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
  update users
  set pin_hash = extensions.crypt(p_pin, extensions.gen_salt('bf'))
  where id = p_user_id;
  perform set_config('app.trusted_write', 'off', true);

  perform log_audit_event(target_family, caller_profile, 'profile_pin_set', 'user', p_user_id, '{}'::jsonb);
end;
$$ language plpgsql volatile security definer set search_path = public;

revoke all on function set_profile_pin(uuid, text) from public;
grant execute on function set_profile_pin(uuid, text) to authenticated;

-- ----------------------------------------------------------------------------
-- profile_pin_attempts — server-side PIN brute-force protection (added this
-- "final hardening pass"). THE GAP THIS CLOSES: claim_family_profile_with_pin()
-- previously had NO attempt limiting at all — a 4-digit PIN has only 10,000
-- possibilities, and nothing server-side stopped an unlimited number of
-- guesses against it.
--
-- Keyed by (auth_user_id, target_user_id) — the CALLING DEVICE and the
-- PROFILE it is trying to claim — never by IP and never by target alone: a
-- wrong guess by device A against profile X must never lock out a
-- legitimate attempt against profile X by device B, or against a DIFFERENT
-- profile by device A. Stores no PIN material of any kind — only a failure
-- counter and a cooldown deadline.
--
-- RLS: enabled, ZERO policies for any role — the same default-deny pattern
-- already used for family_membership_snapshots/audit_log/
-- impersonation_sessions elsewhere in this schema. No ordinary client call
-- can read or write this table directly; only
-- claim_family_profile_with_pin() (SECURITY DEFINER, `set search_path =
-- public` below) ever touches it, and only ever the row for (auth.uid(),
-- whichever target it was just called with) — never trusting anything
-- client-supplied beyond the target id itself, and server-verifying family
-- membership on that target exactly as it already did before this pass.
-- ----------------------------------------------------------------------------
create table if not exists profile_pin_attempts (
  auth_user_id uuid not null references auth.users(id) on delete cascade,
  target_user_id uuid not null references users(id) on delete cascade,
  fail_count int not null default 0,
  locked_until timestamptz,
  updated_at timestamptz not null default now(),
  primary key (auth_user_id, target_user_id)
);

alter table profile_pin_attempts enable row level security;

comment on table profile_pin_attempts is
  'Server-side PIN brute-force protection: one row per (calling device, target profile) pair with a wrong-attempt counter and an optional cooldown deadline. No PIN material stored. No RLS policies defined for any role (default-deny) — accessed only by claim_family_profile_with_pin(), SECURITY DEFINER, and only ever for auth.uid()''s own attempts.';

-- ----------------------------------------------------------------------------
-- claim_family_profile_with_pin(p_target_user_id, p_pin) — REWRITTEN this
-- pass for full atomicity. THE BUG THIS FIXES: the previous version's single
-- `update users set auth_user_id = auth.uid() where id = p_target_user_id`
-- never first cleared auth.uid() from whatever OTHER profile row it might
-- currently occupy. Since users.auth_user_id is UNIQUE
-- (users_auth_user_id_idx), a same-device switch (e.g. Dad's device, still
-- holding Dad's own claim, verifying Idan's PIN to switch to Idan) could hit
-- a unique-constraint violation outright, or — worse, if the two statements
-- had been split across separately-failable steps — leave the device
-- claimed on NEITHER profile if the second step failed after the first
-- succeeded.
--
-- THE FIX — one atomic transaction, correctly ordered, exactly per this
-- pass's required steps:
--   1. Validate target exists, is in caller's family, is active/claimable
--      (unchanged eligibility checks, now run against a LOCKED row — see 3).
--   2. Verify PIN BEFORE any mutation (unchanged position, now explicit).
--   3. `select ... for update` on the target row — takes a row lock so two
--      concurrent claim attempts against the SAME target cannot interleave;
--      the second waits for the first's transaction to fully commit or roll
--      back before it even evaluates eligibility, and then sees the FIRST
--      caller's committed result, never a half-applied one.
--   4. Release auth.uid() from whatever profile it currently holds (own
--      row's auth_user_id -> null) — Step 4 and Step 5 are two statements
--      inside the SAME function invocation, i.e. the SAME implicit
--      transaction PostgREST wraps this RPC call in; there is no
--      commit/rollback boundary between them. If step 5 raises for any
--      reason (its own WHERE guard matched 0 rows), the exception propagates
--      out of the function with NO explicit exception handler catching it —
--      Postgres therefore rolls back the ENTIRE transaction, including
--      step 4's release, together. The device that started this call still
--      holding profile X and this call fails ends this call still holding
--      profile X. Nothing is ever left "claimed nowhere."
--   5. Claim the target (auth_user_id = auth.uid()).
--   6. Both writes share `app.trusted_write='on'` (Part 0.5) around them —
--      required now that auth_user_id is a protected column.
--   7. A transfer FROM another device (B claiming a profile A currently
--      holds) needs no separate "revoke A's claim" statement: A's row and
--      the target row are different rows (A is a different profile than the
--      target, by definition of "A currently holds the target" meaning
--      target.auth_user_id = A's auth.uid() — B's own step-4 release only
--      touches B's OWN row, never A's). Step 5's UPDATE simply overwrites
--      the target row's auth_user_id from A's auth.uid() to B's — A no
--      longer satisfies `auth_user_id = auth.uid()` for that row the
--      instant this commits, which IS A's revocation (same reasoning as the
--      original function's comment, preserved: no separate revoke needed,
--      the UPDATE that moves the column IS the revocation).
--   8. Re-claiming a profile you ALREADY hold is an explicit, early,
--      pre-PIN-check no-op (see "already the current holder" below) — safe
--      and idempotent, never an error.
--
-- ADVERSARIAL TEST CASES (required by this pass, reasoned through against
-- the SQL below; also expressed as literal Jest tests against a mocked RPC
-- layer wherever expressible without a live database — see
-- authStore.test.ts):
--
-- * Dad -> Idan, same device: Dad's device currently holds Dad's row
--   (target_family=ok, PIN for Idan verified). Step 4 clears Dad's OWN row's
--   auth_user_id (WHERE auth_user_id = auth.uid() — matches Dad's row only).
--   Step 5 sets Idan's row's auth_user_id to this device's auth.uid(). Final
--   state: Dad's row auth_user_id = null, Idan's row = this device. No
--   unique-constraint collision (Dad's row is cleared FIRST, in the same
--   transaction, before Idan's row is ever touched).
-- * Idan -> Dad, same device (symmetric): same mechanism, reversed roles.
-- * A (device 1) -> B (device 2) transfer of one profile: see point 7 above
--   — B's step 4 only touches B's own current row (whatever B currently
--   holds, if anything — unrelated to the profile being transferred); step
--   5 overwrites the target row from A's auth.uid() to B's. A's claim on
--   that SPECIFIC profile is gone the instant this commits; A's claim on
--   whatever OTHER profile it might separately hold (if any) is completely
--   untouched — this function never touches any row A holds other than the
--   one being transferred.
-- * Wrong PIN leaves the original claim completely unchanged: the PIN check
--   (now hoisted before the row lock is even taken further, and certainly
--   before either UPDATE) raises immediately on mismatch — execution never
--   reaches step 4 or step 5, so NOTHING is written, and the exception rolls
--   back the (empty, in terms of writes) transaction. The caller's existing
--   claim, whatever it was, is bit-for-bit as it was before the call.
-- * Concurrent claim attempts on the SAME target: the `select ... for
--   update` serializes them — the second caller's SELECT blocks until the
--   first's transaction ends. If BOTH callers present the CORRECT PIN (a
--   legitimate scenario — the PIN, not "first come first served", is this
--   function's authorization model, exactly as the original function's own
--   design already established: "any current claim holder ... is
--   legitimately superseded once the PIN matches"), both succeed in turn,
--   deterministically, and the LAST to commit ends up holding the profile —
--   this is intentional PIN-based-transfer semantics, not corruption: the
--   final database state is fully consistent (exactly one device holds the
--   target row, exactly per that device's own prior claim untouched
--   elsewhere). If instead the target becomes ineligible between the first
--   caller's commit and the second caller's (now-unblocked) re-check — e.g.
--   removed_at got set concurrently — the second caller's step-5 WHERE guard
--   matches 0 rows, updated_count=0, and it raises a clean, specific error
--   ('claim failed — ...'); Postgres rolls back that second transaction in
--   full, including its own step-4 release, leaving the second caller's
--   prior claim (if any) untouched — never "claimed nowhere."
-- * Failure at any step rolls back fully: covered throughout above — every
--   write in this function happens inside the single implicit transaction
--   PostgREST opens for the RPC call, with no internal exception handler, so
--   ANY `raise exception` (eligibility, PIN mismatch, or the post-UPDATE
--   row-count guard) unwinds every write this invocation made.
--
-- ----------------------------------------------------------------------------
-- PIN ATTEMPT LIMITING (added this "final hardening pass") — RETURN SHAPE
-- CHANGED: was `returns void`, now `returns jsonb`. Read this section before
-- the function body below; it explains why the return type had to change.
--
-- THE TRANSACTION/ROLLBACK TRAP (reasoned through explicitly, as required):
-- a wrong PIN must (a) be recorded server-side — increment the
-- (caller, target) fail counter, and set a cooldown once the threshold is
-- hit — AND (b) still be rejected to the caller. The obvious-looking
-- approach — write the counter, then `raise exception 'incorrect PIN'` as
-- before — is WRONG: this function runs inside the single implicit
-- transaction PostgREST opens for the RPC call, with no internal exception
-- handler anywhere in it (already established above, point 4/"Failure at
-- any step rolls back fully"). An uncaught `raise exception` unwinds the
-- WHOLE transaction, silently discarding the counter write right along with
-- it — the rate limiter would record nothing, ever, making it a complete
-- no-op. `dblink`/a second connection (the standard way to "write outside
-- the current transaction") is not available/appropriate here — no such
-- extension is set up anywhere in this schema, and reaching for one just for
-- a single counter table would be disproportionate.
--
-- THE FIX CHOSEN: for the two EXPECTED-and-recoverable failure paths this
-- pass adds bookkeeping around — wrong PIN, and "cooldown currently active"
-- — this function now does a normal `return` (a structured jsonb result),
-- NOT a `raise exception`. A normal RETURN commits the transaction exactly
-- like a success does, so the attempt-counter write made earlier in the SAME
-- invocation survives. Every OTHER failure path (not authenticated, target
-- not found, cross-family, removed profile, no PIN configured at all) is
-- UNCHANGED — those still `raise exception` exactly as before, because none
-- of them write anything that needs to survive the rejection. Reserving
-- `raise exception` for "nothing to preserve, and/or a genuinely
-- unexpected/programming-error condition" and a structured return for
-- "expected failure that must persist its own bookkeeping" is exactly this
-- distinction.
--
-- Return shape — always exactly one of:
--   {"success": true}
--   {"success": false, "reason": "wrong_pin"}
--   {"success": false, "reason": "cooldown"}
-- (never both a raised exception AND a false-success object for the same
-- call.) src/lib/supabase.ts's claimFamilyProfileWithPin() inspects this and
-- throws the SAME distinct error text this function used to raise directly
-- for the wrong-PIN case ('incorrect PIN') — so from signInWithPin()'s point
-- of view and every existing caller/test/error-mapping rule built on "this
-- call rejects with a distinct message for a wrong PIN", nothing observable
-- changes; the cooldown case is genuinely new behavior with its own new
-- distinct client-side message.
--
-- CONCURRENCY — CORRECTED THIS PASS ("narrow bug fix" pass; the prior
-- pass's own claim below was WRONG and is corrected here explicitly rather
-- than silently, per instruction):
--
-- THE BUG THE PRIOR PASS ACTUALLY SHIPPED: it computed the incremented
-- fail_count in PL/pgSQL (`v_new_count := coalesce(v_fail_count, 0) + 1`,
-- read from the earlier `select ... for update`) and then wrote it via
-- `insert ... on conflict (...) do update set fail_count =
-- excluded.fail_count, ...` — i.e. the CONFLICT branch overwrote with a
-- value PRECOMPUTED BEFORE the upsert ran, not a value derived from the
-- row's state AT THE MOMENT of the conflicting write. For the "row already
-- exists" case this happened to be safe in practice (see below — the
-- earlier `select ... for update` genuinely holds that row's lock for the
-- rest of THIS transaction, so no concurrent writer could have changed it
-- out from under the precomputed value). But for the "no row exists yet"
-- case — the very first wrong attempt ever recorded for a given
-- (caller, target) pair — `select ... for update` matches ZERO rows and
-- therefore takes NO LOCK AT ALL. Two transactions racing their FIRST-ever
-- wrong attempt for the same pair can both read "no row" / fail_count=0,
-- both independently compute v_new_count=1 in PL/pgSQL BEFORE either one's
-- INSERT runs, then serialize on the unique index (the second blocks on the
-- first's row lock, as documented) — but the second's DO UPDATE SET then
-- writes `excluded.fail_count`, which is still the STALE PRE-COMPUTED
-- LITERAL 1 from PL/pgSQL, not "1 + whatever the first transaction just
-- committed." Two genuinely concurrent wrong attempts collapsed into a
-- persisted fail_count of 1, not 2 — the rate limiter silently undercounted
-- exactly the scenario it exists to catch (a script firing attempts in
-- parallel rather than one at a time). This is now fixed; see below.
--
-- THE FIX: the DO UPDATE SET clause below no longer references `excluded`
-- (the would-have-been-inserted, PL/pgSQL-precomputed row) for either
-- column. It instead references `profile_pin_attempts.fail_count` and
-- `profile_pin_attempts.locked_until` directly — i.e. THE CONFLICTING ROW'S
-- OWN CURRENT ON-DISK VALUE, evaluated by Postgres AT THE MOMENT this
-- specific UPDATE actually executes (after it has acquired that row's
-- lock). This is the standard, well-established Postgres pattern for an
-- atomic counter increment under concurrency (`set count = count + 1`,
-- generalized here to an UPSERT): when two INSERT ... ON CONFLICT
-- statements collide on the same key, the second BLOCKS on the first's row
-- lock until the first commits, and only THEN evaluates its own DO UPDATE
-- SET expressions — against the NOW-CURRENT, post-first-commit row, not a
-- stale snapshot from before it started waiting and not a value computed
-- before the wait began. So five genuinely concurrent wrong-PIN calls for a
-- brand-new pair now correctly serialize into a persisted fail_count
-- sequence of 1, 2, 3, 4, 5 — never a collapsed/undercounted value. (Jest
-- cannot prove this — it mocks the RPC boundary entirely, never touching
-- real Postgres locking/MVCC — see the manual Supabase integration-test
-- checklist in this pass's MANIFEST.txt for how to actually verify it
-- against a live database, repeated multiple times, since a single passing
-- run does not by itself rule out a race.)
--
-- Both `fail_count` and `locked_until`'s DO UPDATE SET expressions
-- independently re-derive the same "new count" via an identical CASE
-- expression (see below) — Postgres does NOT let one SET-list expression
-- reference another assignment's freshly-computed value by name within the
-- same UPDATE (`table.column` on the right-hand side of any SET expression
-- always means the OLD, pre-this-statement row, never a sibling
-- assignment's new value), so there is no way to compute the new count once
-- and reuse it across two separate column assignments without either (a) a
-- CTE-based upsert, (b) a `returning ... into` follow-up read, or (c)
-- simply duplicating the same deterministic expression in both places.
-- Chosen here: (c) — both expressions read only `profile_pin_attempts.
-- fail_count`/`profile_pin_attempts.locked_until` (the OLD row, fixed for
-- the duration of this one statement) so they are guaranteed to agree with
-- each other every time; a CTE/RETURNING round trip would be more
-- ceremony for no additional correctness here, since this statement makes
-- exactly one write either way.
--
-- EXPIRED-COOLDOWN RESET (also fixed/clarified this pass — previously
-- ambiguous, now explicit): the ORIGINAL intent, stated plainly, is that
-- once a cooldown expires, the NEXT wrong attempt starts a FRESH sequence
-- (count -> 1), not an ever-growing count layered on top of the expired
-- lockout. The DO UPDATE SET CASE expression below checks
-- `profile_pin_attempts.locked_until is not null and
-- profile_pin_attempts.locked_until <= now()` (i.e. a cooldown was set AND
-- it has already passed) and, if true, resets to 1 instead of incrementing
-- the stale count; otherwise it increments normally. This is evaluated
-- against the SAME on-disk row the increment logic reads, so it is exactly
-- as race-free as the increment itself — there is no separate, out-of-band
-- "is it expired" read that could disagree with what actually gets written.
--
-- The cooldown CHECK earlier in the function (before the PIN is even
-- verified) additionally takes an explicit `select ... for update` on any
-- EXISTING row for this pair — mirroring this function's own already-
-- established "select target row for update" idiom above. For the
-- "row already exists" case this means THIS transaction already holds that
-- row's lock for its own remaining duration, so its own later UPSERT below
-- is race-free by construction (no other transaction could have modified it
-- in between); the fix above is specifically what closes the gap for the
-- "row does not exist yet" case, where that earlier SELECT takes no lock at
-- all and the INSERT/DO-UPDATE below is the ONLY serialization point.
--
-- ADVISORY LOCK — CONSIDERED, NOT USED: a transaction-scoped
-- `pg_advisory_xact_lock()` keyed on a hash of (auth.uid(), p_target_user_id)
-- was considered as an alternative/additional guard. Not adopted: (a) the
-- DO UPDATE SET fix above is already fully correct and atomic on its own —
-- Postgres's own row-level locking during the conflicting UPDATE is the
-- actual correctness mechanism, not a convenience an advisory lock would be
-- standing in for; a lock taken only as "defense in depth" around an
-- already-atomic single statement adds real complexity (a deterministic
-- 64-bit key derived from two uuids via hashing — e.g.
-- `hashtextextended(auth.uid()::text || ':' || p_target_user_id::text, 0)`
-- — and the collision implications of two DIFFERENT (caller, target) pairs
-- hashing to the same bigint key, which would serialize two otherwise-
-- unrelated pairs against each other for no correctness benefit) for zero
-- additional correctness benefit here; (b) this table has exactly one
-- write statement in exactly one code path that ever touches a given row
-- for the increment, so there is no multi-statement read-modify-write
-- sequence anywhere in this function left needing an external lock to
-- bridge — the single atomic UPSERT statement already IS the critical
-- section.
--
-- RATE-LIMIT POLICY: max 5 incorrect attempts, then a 15-minute cooldown.
-- DEVIATION FROM A TRUE SLIDING/ROLLING TIME WINDOW, stated explicitly as
-- required: this uses a FIXED window that resets only on (a) a successful
-- claim for this pair, or (b) the cooldown itself expiring — not a
-- continuously-decaying counter. A true sliding window (timestamping every
-- individual attempt and counting how many fall in the trailing N minutes)
-- is straightforward for a single global limiter but adds real schema/query
-- complexity here for no meaningful benefit against this specific threat
-- model — a private multi-device family app, a 4-digit PIN keyed per
-- caller+target pair, not a public multi-tenant login endpoint. 5 wrong
-- attempts still triggers the exact same hard 15-minute lock either way; the
-- only behavioral difference a sliding window would add is exactly when the
-- counter starts decaying DURING an ongoing run of failures short of 5 — not
-- a materially different security property for this endpoint. Kept
-- intentionally simple and auditable.
-- ----------------------------------------------------------------------------
create or replace function claim_family_profile_with_pin(p_target_user_id uuid, p_pin text)
returns jsonb as $$
declare
  target_family uuid;
  target_removed_at timestamptz;
  target_pin_hash text;
  target_auth_user_id uuid;
  updated_count int;
  v_fail_count int;
  v_locked_until timestamptz;
begin
  if auth.uid() is null then
    raise exception 'must be authenticated';
  end if;

  -- Step 1 + Step 3: validate AND lock in one shot — select the target row
  -- FOR UPDATE so a concurrent claim attempt against this same target
  -- cannot interleave with this one (see "concurrent claim attempts" above).
  select family_id, removed_at, pin_hash, auth_user_id
    into target_family, target_removed_at, target_pin_hash, target_auth_user_id
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

  -- Idempotency (required step 8): already the current holder of this exact
  -- profile -> safe no-op, no PIN check needed (you already legitimately
  -- hold it), no rate-limit check either (this is not a guess), nothing to
  -- write, nothing to audit-log twice.
  if target_auth_user_id = auth.uid() then
    return jsonb_build_object('success', true);
  end if;

  if target_pin_hash is null then
    -- Unchanged from the prior pass, and deliberately still a RAISE (not a
    -- structured return): this path never touches profile_pin_attempts at
    -- all (see below — a target with no PIN configured must not
    -- consume/count as a wrong-PIN attempt), so there is nothing here a
    -- rollback could discard, and every existing caller already expects
    -- this exact distinct exception text.
    raise exception 'no PIN set for this profile — ask your family admin to set one, or reclaim from the original device';
  end if;

  -- RATE-LIMIT CHECK (new this pass) — must run, and must reject, BEFORE
  -- the PIN is verified at all. Required behavior: a CORRECT PIN presented
  -- during an active cooldown must ALSO be rejected, with the SAME
  -- "cooldown" reason a wrong PIN during cooldown gets — this endpoint must
  -- never be usable as an oracle to distinguish "right PIN, just locked"
  -- from "wrong PIN" while locked.
  select fail_count, locked_until
    into v_fail_count, v_locked_until
  from profile_pin_attempts
  where auth_user_id = auth.uid()
    and target_user_id = p_target_user_id
  for update;

  if v_locked_until is not null and v_locked_until > now() then
    -- No write in this branch: rejecting an attempt made DURING an active
    -- cooldown must not itself extend or otherwise change the cooldown —
    -- the existing locked_until/fail_count are left exactly as they are.
    -- There is therefore no rollback concern for this branch either way; a
    -- plain RETURN (rather than RAISE) is used purely for consistency with
    -- the wrong-PIN branch below (both are "expected, not exceptional"
    -- outcomes for this function to signal).
    return jsonb_build_object('success', false, 'reason', 'cooldown');
  end if;

  -- Step 2: verify PIN BEFORE any claim/release mutation (unchanged
  -- position/guarantee from the prior pass). Nothing below this line runs
  -- on a mismatch — see "wrong PIN" adversarial case above.
  if p_pin is null or extensions.crypt(p_pin, target_pin_hash) is distinct from target_pin_hash then
    -- PIN-ATTEMPT ACCOUNTING: record the failure, then RETURN (never RAISE)
    -- so this write survives — see "THE TRANSACTION/ROLLBACK TRAP" above.
    --
    -- ATOMICITY FIX (this pass — see the CONCURRENCY doc comment above this
    -- function for the full incident/correction): the new fail_count and
    -- locked_until are NOT precomputed in PL/pgSQL from `v_fail_count`/
    -- `v_locked_until` (those two are read-only inputs to the EARLIER
    -- cooldown check above, and — for the "no row exists yet" race — can be
    -- stale by the time this statement actually runs). Instead, both DO
    -- UPDATE SET expressions below derive the new value directly from
    -- `profile_pin_attempts.fail_count` / `profile_pin_attempts.
    -- locked_until` — the CONFLICTING ROW'S OWN value, evaluated by
    -- Postgres at the moment this specific UPDATE executes, after it has
    -- acquired that row's lock. This is what makes concurrent conflicting
    -- upserts serialize correctly: the second of two racing calls sees the
    -- first's already-committed count and increments THAT, never a stale
    -- precomputed literal. On a genuine first-ever INSERT for this pair
    -- (no conflict at all) the plain VALUES clause supplies fail_count=1,
    -- locked_until=null directly — correct by construction, nothing to
    -- derive.
    --
    -- Both DO UPDATE SET expressions repeat the same CASE (see the doc
    -- comment above for why it must be duplicated rather than computed
    -- once): if the existing row's OWN locked_until is set AND has already
    -- passed, this is the first wrong attempt of a FRESH sequence after a
    -- prior cooldown expired -> reset to 1 (see "EXPIRED-COOLDOWN RESET"
    -- above); otherwise increment the existing row's own fail_count by 1.
    -- locked_until is then set from THAT SAME resulting count (>= 5 ->
    -- lock for 15 minutes; otherwise null, including explicitly clearing
    -- any leftover value on the fresh-sequence-reset branch, where it is
    -- always < 5 immediately after a reset to 1).
    insert into profile_pin_attempts (auth_user_id, target_user_id, fail_count, locked_until, updated_at)
    values (auth.uid(), p_target_user_id, 1, null, now())
    on conflict (auth_user_id, target_user_id) do update
      set fail_count = case
            when profile_pin_attempts.locked_until is not null
              and profile_pin_attempts.locked_until <= now()
              then 1
            else profile_pin_attempts.fail_count + 1
          end,
          locked_until = case
            when (case
                    when profile_pin_attempts.locked_until is not null
                      and profile_pin_attempts.locked_until <= now()
                      then 1
                    else profile_pin_attempts.fail_count + 1
                  end) >= 5
              then now() + interval '15 minutes'
            else null
          end,
          updated_at = now();

    return jsonb_build_object('success', false, 'reason', 'wrong_pin');
  end if;

  -- Correct PIN: clear/reset this pair's failure state (required behavior —
  -- "successful verification clears/resets the caller+target failure
  -- state"). DELETE rather than zeroing is equivalent here (a later wrong
  -- attempt just re-INSERTs at count 1) and keeps the table from
  -- accumulating a permanent row for every pair that ever had one wrong
  -- guess. NOTE (edge case, not a security concern): if the claim itself
  -- then fails below (updated_count = 0 — e.g. the target changed family or
  -- was removed concurrently between the PIN check and the write), the
  -- `raise exception` on that path rolls back this DELETE too, along with
  -- everything else in this invocation — so a correct-PIN-but-ultimately-
  -- failed claim leaves the failure counter exactly as it was, which is the
  -- correct outcome (the claim did not actually succeed).
  delete from profile_pin_attempts
  where auth_user_id = auth.uid()
    and target_user_id = p_target_user_id;

  perform set_config('app.trusted_write', 'on', true);

  -- Step 4: release auth.uid() from whatever profile it CURRENTLY holds (if
  -- any). THE FIX for the non-atomic-swap bug — this must happen, and must
  -- happen BEFORE step 5, in the SAME transaction as step 5, or a
  -- same-device switch can collide with the UNIQUE constraint on
  -- auth_user_id (the old bug) or leave the device claimed nowhere (the
  -- worse hypothetical of splitting these across separately-failable
  -- statements — see the "Step 4/5 atomicity" note in the doc comment
  -- above for exactly why a single shared transaction with no internal
  -- exception handler is what guarantees this can never happen here).
  update users set auth_user_id = null where auth_user_id = auth.uid();

  -- Step 5: claim the target. WHERE guard re-validates against the state at
  -- write time (defense-in-depth alongside the FOR UPDATE lock above).
  update users
  set auth_user_id = auth.uid()
  where id = p_target_user_id
    and family_id = target_family
    and removed_at is null;

  get diagnostics updated_count = row_count;

  perform set_config('app.trusted_write', 'off', true);

  if updated_count = 0 then
    -- Raises here rolls back BOTH this statement's (zero) effect AND step
    -- 4's release AND the attempt-state DELETE above, in the same
    -- transaction — see "concurrent claims", "failure at any step", and the
    -- NOTE above.
    raise exception 'claim failed — profile may have been removed or changed family; try again';
  end if;

  perform log_audit_event(target_family, p_target_user_id, 'profile_claim_transferred', 'user', p_target_user_id, '{}'::jsonb);

  return jsonb_build_object('success', true);
end;
$$ language plpgsql volatile security definer set search_path = public;

revoke all on function claim_family_profile_with_pin(uuid, text) from public;
grant execute on function claim_family_profile_with_pin(uuid, text) to authenticated;

-- ----------------------------------------------------------------------------
-- claim_family_profile(target_user_id) — REDEFINED this pass. This function
-- originates in already-shipped migration 0004 and is otherwise UNCHANGED —
-- every line of logic below is copied verbatim from schema.sql's current
-- version (re-verified directly against that file before writing this,
-- specifically to avoid reconstructing it from memory). The ONLY change is
-- wrapping its existing auth_user_id UPDATE with the same
-- `app.trusted_write` GUC Part 0.5 now requires around any write to that
-- column — without this, Part 0.5's enforce_users_protected_columns()
-- trigger would block this function's own UPDATE outright, since it is a
-- direct write to a newly-protected column. This is this repo's own
-- established convention for correcting an earlier, already-shipped
-- migration's function: `create or replace function` it again from a LATER
-- migration file (e.g. 0006 already redefines 0002's is_family_admin() /
-- current_profile_id() this same way; Part 0 above already redefines
-- current_family_role()/is_real_family_admin() from earlier migrations the
-- same way, inside this very file).
-- ----------------------------------------------------------------------------
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

  -- Part 0.5: auth_user_id is a protected column at the database level now.
  perform set_config('app.trusted_write', 'on', true);
  update users
  set auth_user_id = auth.uid()
  where id = target_user_id
    and family_id = target_family
    and removed_at is null
    and (auth_user_id is null or auth_user_id = auth.uid());
  perform set_config('app.trusted_write', 'off', true);

  get diagnostics updated_count = row_count;

  if updated_count = 0 then
    raise exception 'claim failed — profile may have been removed or changed family; try again';
  end if;
end;
$$ language plpgsql volatile security definer set search_path = public;


-- ============================================================================
-- PART 2 — QA sandbox (Part G), REWORKED to be genuinely reversible
-- ============================================================================

-- ----------------------------------------------------------------------------
-- families.is_qa — marks a family row as a QA/testing sandbox rather than a
-- real household. Every RLS policy in this schema already scopes strictly
-- by `family_id = current_family_id()` (or an equivalent join) — a QA
-- family is ALREADY fully isolated from the real family and from every
-- OTHER QA family purely by being a different family_id. is_qa is a MARKER
-- for UI/reset-scoping only, exactly as required — it is never itself the
-- security boundary; family_id always is.
--
-- CONFIRMED (unchanged from the prior pass's finding, re-verified):
-- `families` has RLS enabled with only a SELECT policy — no INSERT/UPDATE/
-- DELETE policy exists for any role, so no ordinary client call can ever
-- set is_qa=true on an existing family. The only ways it can become true
-- are direct database access, or enter_qa_sandbox() below (sets it only on
-- a row it itself just inserted).
-- ----------------------------------------------------------------------------
alter table families add column if not exists is_qa boolean not null default false;

comment on column families.is_qa is
  'True only for a QA/testing sandbox family, never a real household. qa_reset_data()/qa_reset_full() refuse to run against any family where this is false. Marker only — family_id remains the actual RLS security boundary.';

-- ----------------------------------------------------------------------------
-- family_membership_snapshots — THE reversibility mechanism (Deliverable 2).
--
-- THE PROBLEM this table solves: family_auth_members has exactly ONE row
-- per device (auth_user_id is its primary key) — a device can only ever be
-- "a member of" one family at a time, by design (this is also what
-- create_family()/join_family()'s own `on conflict (auth_user_id) do
-- update` already relies on, unrelated to QA). So entering a QA sandbox
-- MUST repoint that one row at the QA family — there is no way to hold two
-- simultaneous "real" family_auth_members rows without a much larger schema
-- change (letting one device belong to N families at once, with a further
-- concept of which one is "active" right now — considered and rejected for
-- THIS pass: it would touch current_family_id()'s definition, which
-- everything in this schema transitively depends on, for a benefit this
-- app doesn't need — a device is never simultaneously IN both its real
-- family and a QA sandbox from the user's point of view, only sequentially).
--
-- THE FIX: before repointing, SNAPSHOT the device's real membership (family,
-- role, and which persona it had claimed) into this table. Exiting QA
-- restores from the snapshot and deletes it — fully automatic, no invite
-- code, no manual DB edit, no reinstall. Entering QA again WHILE ALREADY in
-- a QA context (Deliverable 2's "start another fresh QA family") does NOT
-- overwrite an existing snapshot — see enter_qa_sandbox()'s own comment —
-- so exiting always returns to the TRUE original real family regardless of
-- how many fresh-QA-family cycles happened in between.
--
-- RLS: enabled, ZERO policies for any role (the same "enabled, no policy =
-- default-deny" pattern already used for audit_log/impersonation_sessions
-- in this schema) — no ordinary client call can read or write this table
-- directly. Only enter_qa_sandbox()/exit_qa_sandbox() (SECURITY DEFINER)
-- ever touch it, and only ever the CALLING device's own row (auth.uid()).
-- ----------------------------------------------------------------------------
create table if not exists family_membership_snapshots (
  auth_user_id uuid primary key references auth.users(id) on delete cascade,
  family_id uuid not null references families(id) on delete cascade,
  role text not null check (role in ('admin', 'member')),
  claimed_user_id uuid references users(id) on delete set null,
  saved_at timestamptz not null default now()
);

alter table family_membership_snapshots enable row level security;

comment on table family_membership_snapshots is
  'One row per device that has ever entered a QA sandbox while it had a real (non-QA) family membership — its pre-QA family_auth_members state, restored by exit_qa_sandbox(). No RLS policies defined for any role (default-deny) — accessed only by enter_qa_sandbox()/exit_qa_sandbox(), both SECURITY DEFINER, and only ever for auth.uid()''s own row.';

-- ----------------------------------------------------------------------------
-- enter_qa_sandbox(p_family_name)
--
-- Creates a fresh, empty, is_qa=true family and switches this device into
-- it as its admin — mirrors create_family()'s "creator becomes admin" shape
-- exactly, MINUS the optional dog_name (a QA sandbox should start genuinely
-- empty so the app's existing onboarding flow can be exercised from its
-- true starting state).
--
-- REVERSIBILITY (the actual Deliverable 2 fix): if this device currently
-- has a REAL (non-QA) family_auth_members row, that row's family_id/role —
-- and whichever persona this device currently has claimed, if any — are
-- snapshotted into family_membership_snapshots BEFORE anything is touched.
-- If this device is ALREADY inside a QA context (its current family_id's
-- own is_qa is already true), the existing snapshot is left untouched —
-- entering "another fresh QA family" from within QA must not overwrite the
-- true original real-family snapshot. If this device has no family at all
-- yet (a brand-new install that goes straight into QA, never having joined
-- a real family), there is nothing to snapshot — exit_qa_sandbox() then
-- has nothing to restore to, which is documented there as an accepted,
-- expected edge case (not a data-loss bug: nothing real ever existed).
--
-- The device's currently-claimed persona (if any) is released
-- (users.auth_user_id set to null) before the switch — it cannot remain set
-- once family_id moves (real_current_profile_id() filters by
-- family_id = current_family_id(), so it would stop resolving anyway; this
-- makes the release explicit rather than merely incidental, and is exactly
-- what gets re-claimed by exit_qa_sandbox() from the snapshot).
--
-- AUTHORIZATION (narrow security/database correction pass, NEW this pass):
-- previously this function only checked `auth.uid() is not null` — i.e. ANY
-- authenticated device could call it directly (it is SECURITY DEFINER,
-- reachable via PostgREST regardless of what the Settings UI shows or
-- hides), completely bypassing the Settings screen's admin-only gating.
-- THE RULE, stated exactly: entering an existing QA sandbox, or creating a
-- fresh one, is allowed ONLY for the current REAL family's admin — i.e. the
-- device must be admin of whatever family it is CURRENTLY in when it calls
-- this (real or QA), checked via is_family_admin(current_family_id()), the
-- now-persona-corrected (Part 0) admin derivation. This single check
-- correctly covers BOTH cases this function handles:
--   (a) entering QA from a real family: must be that real family's admin.
--   (b) starting "another fresh QA family" while ALREADY inside QA: must be
--       admin of the CURRENT QA family — which is guaranteed true by
--       construction (a QA family's only member is ever its own creator,
--       who became admin via this same function or create_family()'s
--       identical "creator becomes admin" pattern), so this in practice
--       never rejects (b) in any reachable state — it is still checked
--       explicitly rather than assumed, for defense-in-depth and clarity.
-- This also correctly leverages Part 0's bootstrap-fallback in
-- current_family_role()/is_family_admin(): a device that just ran
-- create_family() but has not yet claimed any persona still resolves as
-- admin via the family_auth_members fallback for that brief window, so a
-- brand-new family's creator can still reach QA immediately without first
-- claiming a persona.
-- ----------------------------------------------------------------------------
create or replace function enter_qa_sandbox(p_family_name text)
returns table (id uuid, name text, invite_code text) as $$
declare
  cur_family uuid;
  cur_role text;
  cur_is_qa boolean;
  cur_persona uuid;
  new_family_id uuid;
  new_code text;
  attempts int := 0;
begin
  if auth.uid() is null then
    raise exception 'must be authenticated to create a family';
  end if;
  if p_family_name is null or length(trim(p_family_name)) = 0 then
    raise exception 'family_name is required';
  end if;

  select fam.family_id, fam.role, f.is_qa
    into cur_family, cur_role, cur_is_qa
  from family_auth_members fam
  join families f on f.id = fam.family_id
  where fam.auth_user_id = auth.uid();

  -- Authorization (see doc comment above): must be admin of whichever
  -- family this device is CURRENTLY in, real or QA. A device with no
  -- family_auth_members row at all (cur_family null) has no family to be
  -- admin of and is rejected here too — there is no legitimate "create a QA
  -- sandbox before ever joining any real family" path in this app.
  if cur_family is null or not is_family_admin(cur_family) then
    raise exception 'only a family admin may enter or create a QA sandbox';
  end if;

  -- Snapshot the real membership ONLY if one exists and isn't itself a QA
  -- context already (see doc comment above).
  if coalesce(cur_is_qa, false) = false then
    select id into cur_persona from users where auth_user_id = auth.uid();
    insert into family_membership_snapshots (auth_user_id, family_id, role, claimed_user_id, saved_at)
    values (auth.uid(), cur_family, cur_role, cur_persona, now())
    on conflict (auth_user_id) do update set
      family_id = excluded.family_id,
      role = excluded.role,
      claimed_user_id = excluded.claimed_user_id,
      saved_at = excluded.saved_at;
  end if;

  -- Release whatever persona this device currently holds (real or a
  -- previous QA persona) before repointing family membership. auth_user_id
  -- is a protected column (Part 0.5) — flag this write as trusted.
  perform set_config('app.trusted_write', 'on', true);
  update users set auth_user_id = null where auth_user_id = auth.uid();
  perform set_config('app.trusted_write', 'off', true);

  loop
    new_code := generate_invite_code();
    attempts := attempts + 1;
    begin
      insert into families (name, invite_code, is_qa) values (trim(p_family_name), new_code, true)
      returning families.id into new_family_id;
      exit;
    exception when unique_violation then
      if attempts > 20 then
        raise exception 'could not generate a unique invite_code';
      end if;
    end;
  end loop;

  insert into family_auth_members (auth_user_id, family_id, role)
  values (auth.uid(), new_family_id, 'admin')
  on conflict (auth_user_id) do update set family_id = excluded.family_id, role = 'admin';

  perform log_audit_event(new_family_id, null, 'qa_sandbox_entered', 'family', new_family_id, '{}'::jsonb);

  return query select f.id, f.name, f.invite_code from families f where f.id = new_family_id;
end;
$$ language plpgsql volatile security definer set search_path = public;

revoke all on function enter_qa_sandbox(text) from public;
grant execute on function enter_qa_sandbox(text) to authenticated;

-- ----------------------------------------------------------------------------
-- exit_qa_sandbox()
--
-- Restores this device's real family_auth_members row (family_id + role)
-- from family_membership_snapshots, re-claims whichever persona it had
-- claimed before entering QA (best-effort — if that persona was since
-- removed, simply leaves it unclaimed; the ordinary LoginScreen "pick your
-- profile" flow handles that gracefully, it is not an error), and deletes
-- the snapshot (one-shot restore).
--
-- Guards: must currently BE inside a QA family (current family's is_qa must
-- be true) — cannot "exit" a real family by mistake. Must have a snapshot
-- to restore — a device with no snapshot (see enter_qa_sandbox()'s "brand
-- new install, no real family" case) gets a clear, distinct error rather
-- than silently doing nothing.
--
-- AUTHORIZATION (NEW this pass): must also be admin of the CURRENT QA
-- family, checked explicitly via is_family_admin(cur_family) rather than
-- assumed. In practice this can never currently be false — a QA family's
-- only ever member is its own creator (see enter_qa_sandbox()'s
-- authorization note above), so no non-admin QA member can exist to call
-- this in the first place — but it is checked explicitly here per this
-- pass's requirement to state exactly who may exit a QA sandbox, and as
-- defense-in-depth against any future change that lets a QA family gain a
-- second (non-admin) member.
-- ----------------------------------------------------------------------------
create or replace function exit_qa_sandbox()
returns table (id uuid, name text) as $$
declare
  cur_family uuid;
  cur_is_qa boolean;
  snap record;
begin
  if auth.uid() is null then
    raise exception 'must be authenticated';
  end if;

  select fam.family_id, f.is_qa into cur_family, cur_is_qa
  from family_auth_members fam
  join families f on f.id = fam.family_id
  where fam.auth_user_id = auth.uid();

  if cur_family is null or coalesce(cur_is_qa, false) = false then
    raise exception 'not currently in a QA sandbox';
  end if;

  if not is_family_admin(cur_family) then
    raise exception 'only a family admin may exit a QA sandbox';
  end if;

  select * into snap from family_membership_snapshots where auth_user_id = auth.uid();
  if snap is null then
    raise exception 'no real family to return to on this device — it entered QA with no prior real family membership';
  end if;

  perform log_audit_event(cur_family, null, 'qa_sandbox_exited', 'family', cur_family, '{}'::jsonb);

  -- Release the QA persona (if any) before repointing family membership.
  -- auth_user_id is a protected column (Part 0.5) — flag both writes below
  -- as trusted around this whole release-then-restore sequence.
  perform set_config('app.trusted_write', 'on', true);

  update users set auth_user_id = null where auth_user_id = auth.uid();

  update family_auth_members
  set family_id = snap.family_id, role = snap.role
  where auth_user_id = auth.uid();

  -- Best-effort re-claim of the original persona — a removed/missing
  -- persona is not an error, just leaves this device unclaimed on the
  -- restored family (LoginScreen's ordinary "pick your profile" covers it).
  if snap.claimed_user_id is not null then
    update users
    set auth_user_id = auth.uid()
    where id = snap.claimed_user_id
      and family_id = snap.family_id
      and removed_at is null
      and auth_user_id is null;
  end if;

  perform set_config('app.trusted_write', 'off', true);

  delete from family_membership_snapshots where auth_user_id = auth.uid();

  return query select f.id, f.name from families f where f.id = snap.family_id;
end;
$$ language plpgsql volatile security definer set search_path = public;

revoke all on function exit_qa_sandbox() from public;
grant execute on function exit_qa_sandbox() to authenticated;

-- ----------------------------------------------------------------------------
-- current_family_is_qa() — tiny read-only helper so the client can show an
-- obvious "you are in a QA sandbox" indicator and gate QA-only UI actions,
-- without exposing the whole `families` row or its is_qa column through a
-- broader SELECT policy than already exists.
-- ----------------------------------------------------------------------------
create or replace function current_family_is_qa()
returns boolean as $$
  select coalesce(is_qa, false) from families where id = current_family_id();
$$ language sql stable security definer set search_path = public;

revoke all on function current_family_is_qa() from public;
grant execute on function current_family_is_qa() to authenticated;

-- ----------------------------------------------------------------------------
-- qa_reset_data(p_family_id, p_confirm) — "איפוס נתוני QA": resets
-- OPERATIONAL data only (walks, schedule, requests, audit, push/
-- notifications) while KEEPING the QA family's dog and member/persona
-- structure intact, for retesting normal day-to-day operation without
-- redoing onboarding every time.
--
-- Guards, in order (UNCHANGED from the prior pass's already-correct
-- version): must be authenticated; caller must be an admin of THIS family
-- (is_family_admin — now persona-anchored, Part 0 — impersonation-aware,
-- so an admin impersonating a member correctly CANNOT reset while
-- impersonating); target family must have is_qa = true, full stop,
-- regardless of who calls it; p_confirm must be the literal string
-- 'RESET'.
-- ----------------------------------------------------------------------------
create or replace function qa_reset_data(p_family_id uuid, p_confirm text)
returns void as $$
declare
  fam_is_qa boolean;
begin
  if auth.uid() is null then
    raise exception 'must be authenticated';
  end if;

  if not is_family_admin(p_family_id) then
    raise exception 'only a family admin may reset this family';
  end if;

  select is_qa into fam_is_qa from families where id = p_family_id;
  if fam_is_qa is null then
    raise exception 'family not found';
  end if;
  if not fam_is_qa then
    raise exception 'refusing to reset a non-QA family';
  end if;

  if p_confirm is distinct from 'RESET' then
    raise exception 'confirmation required — pass p_confirm = ''RESET''';
  end if;

  delete from request_push_events
  where (kind = 'swap' and request_id in (select id from walk_swap_requests where family_id = p_family_id))
     or (kind = 'timeChange' and request_id in (select id from time_change_requests where family_id = p_family_id));

  delete from walk_swap_requests where family_id = p_family_id;
  delete from time_change_requests where family_id = p_family_id;
  delete from push_tokens where family_id = p_family_id;
  delete from audit_log where family_id = p_family_id;
  delete from walks where family_id = p_family_id;
  delete from schedule_entries where family_id = p_family_id;
  delete from schedule_rules where family_id = p_family_id;
  delete from notifications where family_id = p_family_id;
  -- Dog and users/personas are DELIBERATELY left intact — see this
  -- function's own doc comment. Use qa_reset_full() for a true blank slate.

  perform log_audit_event(p_family_id, current_profile_id(), 'qa_data_reset', 'family', p_family_id, '{}'::jsonb);
end;
$$ language plpgsql volatile security definer set search_path = public;

revoke all on function qa_reset_data(uuid, text) from public;
grant execute on function qa_reset_data(uuid, text) to authenticated;

-- ----------------------------------------------------------------------------
-- qa_reset_full(p_family_id, p_confirm) — "התחל סביבת QA חדשה": everything
-- qa_reset_data() does, PLUS deletes the dog and every member/persona —
-- a genuine blank slate, "no configured family in this QA context",
-- identical to the state right after enter_qa_sandbox() itself. The tester
-- goes through create-family-equivalent onboarding again from zero: add
-- first member (bootstrap trigger makes them admin again — Part 0), add a
-- dog, add members, set up rotation — using the app's EXISTING onboarding
-- screens, unmodified.
--
-- Operational data is deleted FIRST (same order as qa_reset_data()) so that
-- deleting users afterward never violates the `on delete restrict` FK from
-- walks/schedule_entries.responsible_user_id — by the time users are
-- deleted, nothing references them any more. The family_auth_members row
-- itself (this device's own admin membership of the QA family) is
-- UNTOUCHED — only its DATA is wiped, exactly like create_family() leaves a
-- freshly-created family with no dog/members yet but the creator already
-- admin.
--
-- Same guards as qa_reset_data(): admin-of-this-QA-family-only, is_qa=true
-- hard guard, p_confirm='RESET' tripwire.
-- ----------------------------------------------------------------------------
create or replace function qa_reset_full(p_family_id uuid, p_confirm text)
returns void as $$
declare
  fam_is_qa boolean;
begin
  if auth.uid() is null then
    raise exception 'must be authenticated';
  end if;

  if not is_family_admin(p_family_id) then
    raise exception 'only a family admin may reset this family';
  end if;

  select is_qa into fam_is_qa from families where id = p_family_id;
  if fam_is_qa is null then
    raise exception 'family not found';
  end if;
  if not fam_is_qa then
    raise exception 'refusing to reset a non-QA family';
  end if;

  if p_confirm is distinct from 'RESET' then
    raise exception 'confirmation required — pass p_confirm = ''RESET''';
  end if;

  delete from request_push_events
  where (kind = 'swap' and request_id in (select id from walk_swap_requests where family_id = p_family_id))
     or (kind = 'timeChange' and request_id in (select id from time_change_requests where family_id = p_family_id));

  delete from walk_swap_requests where family_id = p_family_id;
  delete from time_change_requests where family_id = p_family_id;
  delete from push_tokens where family_id = p_family_id;
  delete from audit_log where family_id = p_family_id;
  delete from walks where family_id = p_family_id;
  delete from schedule_entries where family_id = p_family_id;
  delete from schedule_rules where family_id = p_family_id;
  delete from notifications where family_id = p_family_id;
  delete from dogs where family_id = p_family_id;
  -- Users last, now that nothing references them (operational data above
  -- is already gone) — a true blank slate, same as right after
  -- enter_qa_sandbox() itself.
  delete from users where family_id = p_family_id;

  -- Logged AFTER the wipe (audit_log for this family was just cleared as
  -- part of the wipe above) so this one row survives as the record that a
  -- full reset happened, with a null actor (every persona was just deleted).
  perform log_audit_event(p_family_id, null, 'qa_family_fully_reset', 'family', p_family_id, '{}'::jsonb);
end;
$$ language plpgsql volatile security definer set search_path = public;

revoke all on function qa_reset_full(uuid, text) from public;
grant execute on function qa_reset_full(uuid, text) to authenticated;

-- ----------------------------------------------------------------------------
-- qa_reset_family(p_family_id, p_confirm) — BACKWARD-COMPAT SHIM ONLY.
-- The prior pass's single reset RPC is kept as a thin wrapper around
-- qa_reset_data() (the closer of the two new operations to its old
-- behavior, MINUS deleting the dog — see qa_reset_data()'s own doc comment
-- for why the dog is now deliberately preserved by the "keep structure"
-- reset). Not called by this pass's own client code (SettingsScreen now
-- calls qa_reset_data()/qa_reset_full() directly) — kept only so a
-- database that already has an EARLIER 0016 applied and any external
-- tooling built against the old name does not break outright. New code
-- should call qa_reset_data() or qa_reset_full() directly.
-- ----------------------------------------------------------------------------
create or replace function qa_reset_family(p_family_id uuid, p_confirm text)
returns void as $$
begin
  perform qa_reset_data(p_family_id, p_confirm);
end;
$$ language plpgsql volatile security definer set search_path = public;

revoke all on function qa_reset_family(uuid, text) from public;
grant execute on function qa_reset_family(uuid, text) to authenticated;

-- ----------------------------------------------------------------------------
-- create_qa_family(p_family_name) — BACKWARD-COMPAT SHIM ONLY, same
-- rationale as qa_reset_family() above. The prior pass's version of this
-- function REPOINTED the device's family_auth_members row with NO way back
-- except an invite code — that was Deliverable 2's bug. This shim now
-- simply delegates to enter_qa_sandbox() (the reversible version) so any
-- external caller of the old name gets the FIXED, reversible behavior
-- automatically rather than silently keeping the old, irreversible one.
-- New code should call enter_qa_sandbox() directly.
-- ----------------------------------------------------------------------------
create or replace function create_qa_family(p_family_name text)
returns table (id uuid, name text, invite_code text) as $$
begin
  return query select * from enter_qa_sandbox(p_family_name);
end;
$$ language plpgsql volatile security definer set search_path = public;

revoke all on function create_qa_family(text) from public;
grant execute on function create_qa_family(text) to authenticated;

-- ============================================================================
-- QA SECURITY WALKTHROUGH (adversarial test cases, Deliverable 2 / Part 6):
--
-- "QA family can't reach real-family data": every table's RLS policy scopes
-- by family_id = current_family_id() (or a join back to it) — while a
-- device is inside a QA family, current_family_id() resolves to the QA
-- family_id (that IS what family_auth_members.family_id was repointed to),
-- so every ordinary query/RLS check is scoped there, structurally unable to
-- see the real family's rows, exactly like any two unrelated real families
-- already can't see each other's data today. No QA-specific RLS carve-out
-- was needed or added — is_qa never appears in a single RLS policy
-- definition, only inside the *_reset* RPCs' own guard checks.
--
-- "QA reset can't target the real family": qa_reset_data()/qa_reset_full()
-- both hard-fail with 'refusing to reset a non-QA family' the instant
-- is_qa is false for p_family_id — checked with a plain SELECT against the
-- families row itself, not trusted from any client-supplied flag.
--
-- "QA family A can't read/write QA family B": same family_id scoping as
-- above — A and B are just two different, unrelated family_id values,
-- indistinguishable in the RLS/RPC layer from two unrelated real families.
-- is_family_admin(p_family_id) for the reset RPCs also means a device that
-- is CURRENTLY the admin of QA family A cannot reset QA family B even
-- though both are is_qa=true — family_auth_members.family_id (or, once a
-- persona is claimed, current_family_role()'s persona-role fallback) must
-- ALSO match B specifically, which it cannot while this device belongs to A.
-- ============================================================================


-- ============================================================================
-- IF YOU ALREADY APPLIED AN EARLIER VERSION OF 0016 TO A LIVE PROJECT
-- ============================================================================
-- This file is safe to re-apply in full (every statement is create-or-
-- replace / add-column-if-not-exists / create-table-if-not-exists) — but
-- read this first:
--
-- 1. users.role's backfill (Part 0) copies role from whichever
--    family_auth_members row currently claims each persona. If any family
--    on your project has an INTENTIONALLY-admin persona that is currently
--    UNCLAIMED (no device has ever claimed it, or it was released), the
--    backfill has no family_auth_members row to copy from and that persona
--    will default to 'member'. This is a real, narrow edge case — after
--    applying, check for it directly:
--      select u.id, u.name, u.family_id from users u
--      where u.auth_user_id is null and u.removed_at is null
--        and not exists (
--          select 1 from users u2
--          where u2.family_id = u.family_id and u2.role = 'admin' and u2.removed_at is null
--        );
--    Any row returned is a family with NO admin persona at all post-
--    migration — an existing claimed admin on that family must promote it
--    via set_member_role() (or, if truly no admin persona exists/is
--    claimable, this needs a direct one-time SQL UPDATE by whoever holds
--    the project's own credentials: `update users set role = 'admin' where
--    id = '<the intended admin persona's id>'`).
-- 2. If the OLD create_qa_family() was already called for real against
--    your project (i.e. some device's family_auth_members row was already
--    repointed to a QA family with no snapshot, under the prior pass's
--    irreversible version), that device has NO snapshot row to restore
--    from — exit_qa_sandbox() will correctly refuse with "no real family
--    to return to on this device" rather than silently failing. Recovery
--    for that ONE already-affected device is still the old manual path:
--    rejoin the real family via its invite code. This migration cannot
--    retroactively create a snapshot for a switch that already happened
--    before it existed — only prevents the problem going forward.
-- 3. (NEW this pass) After this migration is applied, a DIRECT manual SQL
--    UPDATE against users.role, users.pin_hash, or users.auth_user_id (e.g.
--    the recovery UPDATE in point 1 above, run from the Supabase SQL editor
--    or psql as a superuser/table-owner role) is UNAFFECTED by Part 0.5's
--    REVOKE/GRANT (table owners and superusers are never subject to
--    ordinary column privileges) but WILL be blocked by Part 0.5's
--    enforce_users_protected_columns() trigger, which fires for ANY role
--    unless app.trusted_write='on' for that transaction — a plain
--    superuser UPDATE is not exempt. Wrap any such manual fix like this:
--      select set_config('app.trusted_write', 'on', true);
--      update users set role = 'admin' where id = '<...>';
--      select set_config('app.trusted_write', 'off', true);
--    (all three statements in the SAME transaction/session — e.g. the same
--    SQL editor "run" — since set_config(..., true) is transaction-local).
-- ============================================================================
