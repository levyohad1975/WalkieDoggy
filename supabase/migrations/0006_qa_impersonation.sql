-- ============================================================================
-- 0006_qa_impersonation.sql
--
-- 0001-0005 are already deployed to the live project — this migration does
-- NOT touch any of those files. Everything here is additive: one new table
-- (impersonation_sessions), one new column (audit_log.impersonated_by_admin_user_id),
-- and several redefined SECURITY DEFINER functions (current_profile_id(),
-- is_family_admin(), current_family_role() is left UNCHANGED — see section 3's
-- comment for why — log_audit_event(), admin_list_audit_log()). No existing
-- table's RLS policies are dropped or narrowed; is_family_admin()/
-- current_profile_id() are used BY those existing policies, so redefining
-- their bodies here is how this migration's effect reaches every existing
-- policy/RPC without editing 0001-0005 (see section 2's header comment for
-- why this is deliberate, not incidental).
--
-- ============================================================================
-- FEATURE: "בדיקה אמיתית כמשתמש" (real-user QA impersonation)
--
-- The existing Admin Test Mode (authStore.testModeUserId, see 0004/0005-era
-- client code) is a client-only UI simulation: it changes what the Home/
-- Family/Settings screens SHOW, but every mutation still runs, is
-- authorized, and is audited as the real Admin — testModeUserId never
-- reaches a server call. That is a deliberately safe, low-risk feature and
-- this migration does not touch it.
--
-- It is also insufficient for end-to-end QA: request creation, RLS
-- visibility, and RPC authorization all resolve "who is calling" via
-- current_profile_id()/is_family_admin() (auth.uid()-derived, server-side),
-- which Test Mode never influences. There is no way to see whether, say,
-- create_swap_request() or the walks-write-authorization trigger actually
-- behaves correctly for a Member without physically signing in as one.
--
-- This migration adds a SEPARATE, more powerful, more carefully audited
-- mechanism: a family Admin can start a server-tracked "impersonation
-- session" naming an active member of their own family, and — for the
-- duration of that session, on that Admin's own device only —
-- current_profile_id() and is_family_admin() resolve AS IF the caller were
-- that member, everywhere those functions are used (which is everywhere:
-- every RLS policy and every RPC in 0002-0005 calls one or both). This is
-- what "authorization-sensitive flows should behave as they would for that
-- member" actually requires — a client-side flag cannot do it, because the
-- server never trusts a client-supplied actor id for anything protected.
--
-- What this deliberately does NOT do:
--   - It never writes users.auth_user_id. The impersonated member's own
--     device (if they have one) keeps its claim untouched and can keep
--     using the app normally throughout — impersonation is purely an
--     additional, parallel resolution path keyed off the ADMIN's own
--     auth.uid(), not a takeover of the member's identity.
--   - It never changes family_auth_members. The Admin's device keeps its
--     own role row exactly as before; is_real_family_admin() (the
--     unmodified, original admin check, see section 2) still sees the
--     Admin as an admin, which is what begin_impersonation()/
--     end_impersonation() themselves need to authorize starting/stopping a
--     session in the first place — see the chicken-and-egg note there.
--   - It never accepts a client-supplied "acting as" id anywhere except as
--     the ONE validated argument to begin_impersonation(), which checks
--     same-family + active before creating the session; every subsequent
--     authorization decision re-derives the effective profile from
--     server-side session state (impersonation_sessions keyed by
--     auth.uid()), never from anything the client asserts at call time.
--
-- Sections:
--   1. impersonation_sessions table.
--   2. is_real_family_admin() / real_current_profile_id() — the ORIGINAL,
--      impersonation-UNAWARE identity checks, kept under new names so
--      begin_impersonation()/end_impersonation() (and the audit trail) can
--      always resolve the true caller regardless of any session they
--      themselves manage.
--   3. active_impersonation_target() — the single source of truth for "is
--      this auth.uid() currently impersonating someone, and whom".
--   4. current_profile_id() / is_family_admin() redefined to consult
--      active_impersonation_target() first. current_family_role() is
--      deliberately NOT redefined — see its own comment below.
--   5. begin_impersonation() / end_impersonation().
--   6. audit_log.impersonated_by_admin_user_id + log_audit_event() /
--      admin_list_audit_log() updated to record and surface it.
--   7. whoami() — one lightweight, client-callable round trip used by
--      authStore.restoreSession() to detect a stale/orphaned local claim
--      (see the Idan investigation in the final report) and to drive the
--      impersonation banner/UI state.
--   8. IMPORTANT CORRECTION, discovered while writing this migration:
--      create_swap_request()/approve_swap_request()/reject_swap_request()/
--      create_time_change_request()/approve_time_change_request()/
--      reject_time_change_request()/touch_last_seen() do NOT call
--      current_profile_id() at all — each has its OWN inline
--      `select id [, family_id] into me [, my_family] from users where
--      auth_user_id = auth.uid() and removed_at is null and family_id =
--      current_family_id()` copy of the same logic. Section 4's redefinition
--      of current_profile_id() therefore does NOT, by itself, make these
--      seven functions — which are EXACTLY "request creation... swap
--      requests... time-change requests... presence" from this feature's
--      own requirements — impersonation-aware. Since 0001-0005 cannot be
--      edited in place, section 8 re-declares these seven functions here
--      (same name/signature — Postgres resolves a CREATE OR REPLACE by
--      identity, so every existing caller/policy picks up the new body
--      automatically), changing ONLY their actor-resolution lines to route
--      through current_profile_id()/current_family_id(); every other line
--      is unchanged from the deployed 0005 version. This is the same
--      re-declare-in-a-later-migration pattern 0005 itself already used for
--      admin_delete_family_member()/regenerate_invite_code() (see that
--      migration's own section 7 comment).
--   9. SECURITY-REVIEW CORRECTIONS made before this (still undeployed)
--      migration's first deploy, in response to a review of the draft
--      above:
--        a. impersonation_sessions' "one active session per admin" index
--           was a plain (non-unique) index — see section 1's comment for
--           why that made two concurrent begin_impersonation() calls able
--           to leave two simultaneously-active rows. Now a UNIQUE partial
--           index, plus a per-admin advisory lock inside
--           begin_impersonation() so the ordinary case never even reaches
--           the constraint.
--        b. active_impersonation_target() did not re-check the session's
--           family against this device's CURRENT current_family_id(), nor
--           the target's own family against the session's — relying on the
--           CLIENT never changing a device's family mid-session. See
--           section 3's comment for why that is not an acceptable
--           server-side guarantee; it now re-derives and checks both on
--           every call, fail-closed.
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
