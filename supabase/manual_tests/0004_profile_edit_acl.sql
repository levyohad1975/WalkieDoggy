-- ============================================================================
-- manual_tests/0004_profile_edit_acl.sql
--
-- Manual verification script for:
--   - the "Self + Admin" profile-edit RLS policy on `users`
--   - the claim_family_profile() RPC (including the anti-takeover fix)
--   - admin_delete_family_member()'s replacement-user-id validation
-- all added/hardened in migrations/0004_*.sql.
--
-- WHY THIS FILE EXISTS: this project's sandbox has no live Postgres/Supabase
-- instance, so `npm test` can only verify the CLIENT side of these features
-- (see src/lib/__tests__/supabaseFamily.test.ts — RPC name/params, error
-- propagation). The actual RLS/RPC enforcement — whether Postgres itself
-- really blocks a Member from updating another member's row, or really
-- rejects a profile takeover / an invalid deletion payload — can only be
-- checked against a real Postgres/Supabase project. Run this script (via
-- the SQL editor in the Supabase Dashboard, or `psql`) against a
-- disposable/staging project after applying migrations 0001-0004, BEFORE
-- trusting this feature in production. It is not wired into `npm test` and
-- is not pgTAP; it is a plain script with `-- expect:` comments to check by
-- eye (or adapt into pgTAP/assert statements if you have that extension
-- available).
--
-- Each block impersonates a device by setting the JWT claims Supabase's
-- `auth.uid()` reads (via `set local role authenticated; set local
-- request.jwt.claims = ...`), matching how Supabase's PostgREST layer calls
-- into Postgres for a real request.
--
-- NOTE ON SCHEMA: `families` has NO `dog_name` column — the dog lives in
-- its own `dogs` table, referencing `family_id`. An earlier draft of this
-- script incorrectly did `insert into families (name, dog_name, ...)`,
-- which cannot run against the current schema; fixed below.
-- ============================================================================

begin;

-- ----------------------------------------------------------------------------
-- Setup: two families. Family A has: an admin, a member, an unclaimed
-- active profile, and an already-removed profile. Family B exists only to
-- test that a profile can never be claimed/edited across families.
-- ----------------------------------------------------------------------------

-- Auth identities standing in for devices' anonymous sessions.
insert into auth.users (id) values
  ('00000000-0000-0000-0000-00000000a001'), -- family A: admin device
  ('00000000-0000-0000-0000-00000000a002'), -- family A: member device
  ('00000000-0000-0000-0000-00000000a003'), -- family A: a second, unrelated device (attempts a takeover)
  ('00000000-0000-0000-0000-00000000b001')  -- family B: admin device
on conflict (id) do nothing;

do $$
declare
  fam_a uuid;
  fam_b uuid;
  admin_user_id uuid;
  member_user_id uuid;
  removed_user_id uuid;
  unclaimed_user_id uuid;
  other_family_user_id uuid;
begin
  insert into families (name, invite_code) values ('משפחת בדיקה', 'TEST01') returning id into fam_a;
  insert into families (name, invite_code) values ('משפחה אחרת', 'TEST02') returning id into fam_b;

  insert into dogs (family_id, name) values (fam_a, 'טופי');
  insert into dogs (family_id, name) values (fam_b, 'ריקי');

  insert into users (family_id, name, avatar, color, auth_user_id)
  values (fam_a, 'אדמין', '🐶', '#000000', '00000000-0000-0000-0000-00000000a001')
  returning id into admin_user_id;

  insert into users (family_id, name, avatar, color, auth_user_id)
  values (fam_a, 'חבר', '🐕', '#111111', '00000000-0000-0000-0000-00000000a002')
  returning id into member_user_id;

  insert into users (family_id, name, avatar, color, removed_at)
  values (fam_a, 'הוסר', '🦴', '#222222', now())
  returning id into removed_user_id;

  -- Active, but nobody has claimed it yet (auth_user_id is null) — e.g. a
  -- family member added by an admin who hasn't picked up a phone yet.
  insert into users (family_id, name, avatar, color)
  values (fam_a, 'לא נתבע', '🐾', '#333333')
  returning id into unclaimed_user_id;

  insert into users (family_id, name, avatar, color, auth_user_id)
  values (fam_b, 'אדמין ב', '🐩', '#444444', '00000000-0000-0000-0000-00000000b001')
  returning id into other_family_user_id;

  insert into family_auth_members (family_id, auth_user_id, role) values
    (fam_a, '00000000-0000-0000-0000-00000000a001', 'admin'),
    (fam_a, '00000000-0000-0000-0000-00000000a002', 'member'),
    (fam_a, '00000000-0000-0000-0000-00000000a003', 'member'),
    (fam_b, '00000000-0000-0000-0000-00000000b001', 'admin');

  -- Stash ids where the rest of this script (run in the same session/tx) can
  -- find them, since PL/pgSQL variables don't survive across statements.
  create temporary table test_ids as
  select fam_a as family_id, fam_b as other_family_id, admin_user_id, member_user_id,
         removed_user_id, unclaimed_user_id, other_family_user_id;
end $$;

-- ----------------------------------------------------------------------------
-- 1. Member edits self -> allowed
-- ----------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-00000000a002"}';

update users set name = 'חבר מעודכן'
where id = (select member_user_id from test_ids);
-- expect: UPDATE 1 (no error)

-- ----------------------------------------------------------------------------
-- 2. Member edits another member -> rejected
-- ----------------------------------------------------------------------------
update users set name = 'נחטף'
where id = (select admin_user_id from test_ids);
-- expect: UPDATE 0 (RLS silently filters the row — no rows match the policy)

-- ----------------------------------------------------------------------------
-- 4. Member attempts to modify/clear removed_at -> rejected
--    (both directions: trying to soft-delete someone, and trying to
--    "undelete" the already-removed row)
-- ----------------------------------------------------------------------------
update users set removed_at = now()
where id = (select member_user_id from test_ids);
-- expect: UPDATE 0 — WITH CHECK requires removed_at is null on the NEW row

update users set removed_at = null
where id = (select removed_user_id from test_ids);
-- expect: UPDATE 0 — USING requires removed_at is null on the OLD row, and
-- the removed row isn't visible to this policy at all

-- ----------------------------------------------------------------------------
-- claim_family_profile() — case 1: normal unclaimed claim -> success
-- ----------------------------------------------------------------------------
select claim_family_profile((select unclaimed_user_id from test_ids));
-- expect: success (no error) — auth_user_id was null, now set to a003

-- ----------------------------------------------------------------------------
-- claim_family_profile() — case 2: same-auth re-claim -> success (idempotent)
-- ----------------------------------------------------------------------------
select claim_family_profile((select unclaimed_user_id from test_ids));
-- expect: success (no error) — re-claiming your own already-claimed profile
-- is a no-op success, not a takeover

-- ----------------------------------------------------------------------------
-- claim_family_profile() — case 3: already claimed by a DIFFERENT auth user
-- -> rejected. This is the profile-takeover check: device a002 (the member)
-- tries to steal the profile that a003 just claimed above.
-- ----------------------------------------------------------------------------
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-00000000a002"}';
select claim_family_profile((select unclaimed_user_id from test_ids));
-- expect: error "profile already claimed by another device"

-- Also: a member must not be able to steal an already-claimed COLLEAGUE's
-- profile either (not just a formerly-unclaimed one).
select claim_family_profile((select admin_user_id from test_ids));
-- expect: error "profile already claimed by another device"

-- ----------------------------------------------------------------------------
-- claim_family_profile() — removed profile -> rejected
-- ----------------------------------------------------------------------------
select claim_family_profile((select removed_user_id from test_ids));
-- expect: error "cannot claim a removed profile"

-- ----------------------------------------------------------------------------
-- claim_family_profile() — profile in another family -> rejected
-- ----------------------------------------------------------------------------
select claim_family_profile((select other_family_user_id from test_ids));
-- expect: error "not a member of this user's family"

-- ----------------------------------------------------------------------------
-- claim_family_profile() — case 4: simulated/concurrent stale-read race.
--
-- See "Concurrent / stale-read race simulation" further down in this file
-- (and 0004_claim_race_test.sh) for the actual reproduction — it needs two
-- real concurrent connections, which a single sequential script like this
-- one cannot produce on its own. That section is what verifies the fix:
-- when two devices both read auth_user_id as null and race to claim the
-- same profile, the guarded UPDATE's own row-count check (GET DIAGNOSTICS
-- ROW_COUNT) — not the earlier SELECT-based check — is what guarantees
-- exactly one of them succeeds and the other is rejected, never both
-- succeeding and never a silent no-op "success".
-- ----------------------------------------------------------------------------

-- ----------------------------------------------------------------------------
-- 3 & 6. Admin edits another member -> allowed; admin-only add/remove
--         behavior (admin_delete_family_member) still admin-gated
-- ----------------------------------------------------------------------------
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-00000000a001"}';

update users set name = 'חבר, שונה ע"י אדמין'
where id = (select member_user_id from test_ids);
-- expect: UPDATE 1

-- ----------------------------------------------------------------------------
-- Valid active profile can still be claimed on a joined device
-- ----------------------------------------------------------------------------
-- Simulate a brand-new device (a fresh auth.users row with no matching
-- family_auth_members entry yet is unrealistic here; in the real flow the
-- device already joined the family via join_family() before reaching the
-- profile-pick screen). Re-claim the admin's own profile from the admin
-- device's own session as the simplest same-family, active-user smoke test:
select claim_family_profile((select admin_user_id from test_ids));
-- expect: success (no error) — active user, same family, same auth_user_id

-- ----------------------------------------------------------------------------
-- admin_delete_family_member() — replacement-user-id validation
-- All three payloads below are exercised as the family-A admin (a001).
-- ----------------------------------------------------------------------------

-- Reject: replacement responsible_user_id is a REMOVED user.
select admin_delete_family_member(
  (select member_user_id from test_ids),
  '[]'::jsonb,
  jsonb_build_array(jsonb_build_object('id', gen_random_uuid(), 'responsible_user_id', (select removed_user_id from test_ids))),
  '[]'::jsonb
);
-- expect: error "invalid responsible_user_id replacement in entry_updates"

-- Reject: replacement responsible_user_id belongs to a DIFFERENT family.
select admin_delete_family_member(
  (select member_user_id from test_ids),
  '[]'::jsonb,
  '[]'::jsonb,
  jsonb_build_array(jsonb_build_object('id', gen_random_uuid(), 'responsible_user_id', (select other_family_user_id from test_ids)))
);
-- expect: error "invalid responsible_user_id replacement in walk_updates"

-- Reject: rotation_user_ids replacement is the member being removed
-- themselves.
select admin_delete_family_member(
  (select member_user_id from test_ids),
  jsonb_build_array(jsonb_build_object('id', gen_random_uuid(), 'rotation_user_ids', jsonb_build_array((select member_user_id from test_ids)))),
  '[]'::jsonb,
  '[]'::jsonb
);
-- expect: error "invalid rotation_user_ids replacement in rule_updates"

-- Accept: a valid payload referencing only active, same-family,
-- not-the-removed-member replacements actually soft-deletes the target.
select admin_delete_family_member((select unclaimed_user_id from test_ids));
select removed_at from users where id = (select unclaimed_user_id from test_ids);
-- expect: success, removed_at is now set (no schedule/walk updates needed
-- for this brand-new member with zero history)

-- ----------------------------------------------------------------------------
-- Concurrent / stale-read race simulation for claim_family_profile()
--
-- This exercises the exact race the GET DIAGNOSTICS ROW_COUNT check exists
-- to close: two devices both read auth_user_id as null inside the
-- function's internal SELECT, both pass the early "not claimed by someone
-- else" check, and then both run the guarded UPDATE — only ONE of those
-- UPDATEs can actually affect a row, and the LOSING call must be rejected,
-- not silently report success.
--
-- A single sequential psql script (like the rest of this file) cannot
-- interleave two backends mid-function — everything above runs serially in
-- one connection/transaction. To reproduce the race deterministically, this
-- section defines a TEST-ONLY copy of the function with a pg_sleep()
-- inserted between its SELECT and its UPDATE, widening the race window wide
-- enough to hit reliably with two real concurrent connections. The
-- production claim_family_profile() has no sleep in it — this copy exists
-- purely to make the already-present timing window reproducible on demand;
-- it must never be left in a real project (see the DROP at the bottom).
--
-- HOW TO RUN:
--   1. Commit (don't rollback) a setup identical to the block at the top of
--      this file against a disposable/staging database — you need the
--      unclaimed_user_id row to still exist when the concurrent step below
--      runs from separate connections.
--   2. Create claim_family_profile_test_race() (defined below) in that
--      database.
--   3. Run 0004_claim_race_test.sh (same directory), pointing it at that
--      database and that unclaimed user's id — it fires two claims for the
--      SAME profile from two simulated devices (a002, a003) at nearly the
--      same instant and prints both results.
--   4. Expect: exactly ONE of the two calls succeeds; the other raises
--      'profile already claimed by another device'. Never both succeeding.
-- ----------------------------------------------------------------------------

create or replace function claim_family_profile_test_race(target_user_id uuid, sleep_seconds numeric default 0.5)
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

  -- TEST-ONLY: widen the SELECT-to-UPDATE race window so two concurrent
  -- connections reliably interleave here instead of racing in microseconds
  -- like the real (unmodified) function would.
  perform pg_sleep(sleep_seconds);

  update users
  set auth_user_id = auth.uid()
  where id = target_user_id
    and family_id = target_family
    and removed_at is null
    and (auth_user_id is null or auth_user_id = auth.uid());

  get diagnostics updated_count = row_count;

  if updated_count = 0 then
    raise exception 'profile already claimed by another device';
  end if;
end;
$$ language plpgsql volatile security definer;

-- Cleanup — this test-only function must never linger in a real project:
-- drop function if exists claim_family_profile_test_race(uuid, numeric);

rollback; -- never commits; this script only inspects behavior
