-- ============================================================================
-- manual_tests/0030_system_admin_verified_identity_acl.sql
--
-- Manual verification script for migration 0030 (BATCH 4 CORRECTION #1,
-- item 3): is_system_admin() must fail closed for an ANONYMOUS identity,
-- even when that identity's auth_user_id is present in system_admins.
--
-- WHY THIS FILE EXISTS: same reasoning as manual_tests/0004_profile_edit_acl.sql
-- — this sandbox has no live Postgres/Supabase instance, so `npm test` can
-- only verify the CLIENT side (lib/__tests__/systemAdmin.test.ts: RPC name/
-- params/error propagation). Whether Postgres itself really blocks an
-- anonymous identity can only be checked against a real Postgres/Supabase
-- project. Run this (SQL editor or `psql`) against a disposable/staging
-- project after applying migrations 0001-0030, BEFORE trusting the System
-- Admin gate in production.
--
-- Each block impersonates a device by setting the JWT claims auth.uid()/
-- auth.jwt() read (`set local role authenticated; set local
-- request.jwt.claims = ...`), matching how Supabase's PostgREST layer calls
-- into Postgres for a real request. `"is_anonymous"` in that JSON is exactly
-- the claim Supabase's own anonymous sign-in feature stamps onto a real
-- access token — this script sets it explicitly to simulate both cases.
-- ============================================================================

begin;

insert into auth.users (id, is_anonymous) values
  ('00000000-0000-0000-0000-0000000c3001', true),  -- an ordinary anonymous device, mistakenly granted system_admins anyway
  ('00000000-0000-0000-0000-0000000c3002', false), -- a genuinely verified identity, correctly granted system_admins
  ('00000000-0000-0000-0000-0000000c3003', true)   -- an anonymous device that was never granted system_admins at all
on conflict (id) do update set is_anonymous = excluded.is_anonymous;

insert into system_admins (auth_user_id) values
  ('00000000-0000-0000-0000-0000000c3001'),
  ('00000000-0000-0000-0000-0000000c3002')
on conflict (auth_user_id) do nothing;

-- ----------------------------------------------------------------------------
-- Case 1: anonymous identity IS in system_admins (the misconfiguration this
-- correction targets) — must still be denied.
-- ----------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-0000000c3001", "is_anonymous": true}';
select is_system_admin() as case1_anonymous_in_roster; -- expect: false
select am_i_system_admin() as case1_am_i_check; -- expect: false

-- ----------------------------------------------------------------------------
-- Case 2: verified (non-anonymous) identity, genuinely in system_admins —
-- must be allowed. This is the only combination that should ever pass.
-- ----------------------------------------------------------------------------
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-0000000c3002", "is_anonymous": false}';
select is_system_admin() as case2_verified_in_roster; -- expect: true
select am_i_system_admin() as case2_am_i_check; -- expect: true

-- ----------------------------------------------------------------------------
-- Case 3: anonymous identity, never in system_admins at all — must be
-- denied (baseline sanity check, unrelated to this correction).
-- ----------------------------------------------------------------------------
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-0000000c3003", "is_anonymous": true}';
select is_system_admin() as case3_anonymous_not_in_roster; -- expect: false

-- ----------------------------------------------------------------------------
-- Case 4: a token with NO "is_anonymous" claim at all (simulates a token
-- shape from before anonymous sign-ins was ever enabled on a project, or
-- any other unexpected shape) for an identity that IS in system_admins —
-- must fail closed (denied), never fail open.
-- ----------------------------------------------------------------------------
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-0000000c3002"}';
select is_system_admin() as case4_missing_claim_fails_closed; -- expect: false

-- ----------------------------------------------------------------------------
-- Case 5: no session at all (anon/unauthenticated role) — must be denied,
-- not error.
-- ----------------------------------------------------------------------------
reset role;
set local role anon;
select is_system_admin() as case5_no_session; -- expect: false (or a permission error if EXECUTE truly isn't granted to anon — either outcome is a correct denial)

rollback;
