-- ============================================================================
-- manual_tests/0008_family_invites_acl.sql
--
-- Manual verification script for migrations/0008_family_invites.sql, per the
-- revised FAMILY_INVITE_DESIGN.md §12 test matrix:
--   - create_family_invite() / revoke_family_invite() / list_family_invites()
--     — admin-only, impersonation-aware (correction round 1)
--   - redeem_family_invite() — valid redemption, expiry, revocation, replay,
--     collision guard (correction round 2), explicit family-match re-check
--     (correction round 3)
--   - list_family_invites() never exposes token_hash/raw token
--     (correction round 4)
--   - regeneration supersedes the previous pending invite
--   - fixed 72-hour TTL, derived-expiry semantics (corrections round 6/7)
--   - role='member' always, never admin
--   - no raw token ever appears in audit_log metadata
--
-- Same caveat as every other manual test file in this directory
-- (0004/0005/0006/0007's own scripts): this sandbox has no live Postgres/
-- Supabase instance, so this is a plain script with "-- expect:"/raise
-- notice/raise exception assertions to run by eye (or via `psql -f`) against
-- a disposable/staging Supabase project with migrations 0001-0008 applied,
-- NOT wired into `npm test`.
--
-- CONCURRENCY NOTE (mirrors 0006 test section P's own note): a true
-- concurrent double-redemption of the same token requires two separate,
-- genuinely simultaneous database connections/transactions — not
-- expressible inside one linear script/transaction. This file instead
-- proves the two mechanisms that TOGETHER guarantee correct concurrent
-- behavior: (a) the row-level `for update` lock in redeem_family_invite()
-- (test M below shows the invariant it enforces — a second redemption
-- attempt against an already-redeemed row is always rejected, which is
-- exactly what the lock guarantees under real concurrency: the second
-- transaction blocks until the first commits, then sees this same
-- already-'redeemed' state), and (b) the guarded UPDATE + ROW_COUNT claim
-- check reused verbatim from claim_family_profile() (0004), whose own
-- concurrency behavior is already covered by the existing
-- manual_tests/0004_claim_race_test.sh companion script. A true multi-
-- session companion script for family_invites specifically (two `psql`
-- processes racing redeem_family_invite() against the same raw token,
-- built the same way 0004_claim_race_test.sh does) is recommended before
-- Round 1 is considered fully verified against a real concurrent
-- environment, but could not be authored or run in this sandbox (no live
-- Postgres connection available here).
-- ============================================================================

begin;

-- ----------------------------------------------------------------------------
-- Setup:
--   Family F1 (invites family): admin f1a, an already-claimed member f1m,
--     a removed member f1r, and several UNCLAIMED target profiles
--     (t_a .. t_l) used one-per-scenario so tests don't interfere with each
--     other's "at most one pending invite per target" invariant.
--   Family F2 (unrelated family): admin f2a, member f2m — used to prove
--     cross-family collision rejection.
--   Devices (auth.users rows): f1a_dev/f1m_dev/f1r_dev/f2a_dev/f2m_dev "own"
--     an existing profile; fresh_1 .. fresh_9 are brand-new devices with NO
--     family and NO claimed profile, used to redeem invites one at a time.
-- ----------------------------------------------------------------------------

insert into auth.users (id) values
  ('00000000-0000-0000-0000-000000080a01'), -- F1 admin (f1a)
  ('00000000-0000-0000-0000-000000080a02'), -- F1 already-claimed member (f1m)
  ('00000000-0000-0000-0000-000000080a03'), -- F1 removed member (f1r)
  ('00000000-0000-0000-0000-000000080b01'), -- F2 admin (f2a)
  ('00000000-0000-0000-0000-000000080b02'), -- F2 member (f2m)
  ('00000000-0000-0000-0000-000000080c01'), -- fresh_1 (happy path + role check)
  ('00000000-0000-0000-0000-000000080c02'), -- fresh_2 (expired invite)
  ('00000000-0000-0000-0000-000000080c03'), -- fresh_3 (revoked invite)
  ('00000000-0000-0000-0000-000000080c04'), -- fresh_4 (sequential replay)
  ('00000000-0000-0000-0000-000000080c05'), -- fresh_5 (removed-target-at-create is tested at create time, no device needed there — reserved)
  ('00000000-0000-0000-0000-000000080c06'), -- fresh_6 (target claimed after invite creation)
  ('00000000-0000-0000-0000-000000080c07'), -- fresh_7 (explicit family-match re-check)
  ('00000000-0000-0000-0000-000000080c08'), -- fresh_8 (regenerate/supersede)
  ('00000000-0000-0000-0000-000000080c09')  -- fresh_9 (raw-token-in-audit scan)
on conflict (id) do nothing;

do $$
declare
  fam1 uuid;
  fam2 uuid;
  f1a uuid;
  f1m uuid;
  f1r uuid;
  f2a uuid;
  f2m uuid;
  t_a uuid; t_b uuid; t_c uuid; t_d uuid; t_e uuid; t_f uuid;
  t_g uuid; t_h uuid; t_i uuid; t_j uuid; t_k uuid; t_l uuid;
begin
  insert into families (name, invite_code) values ('משפחה F1', 'TEST81') returning id into fam1;
  insert into families (name, invite_code) values ('משפחה F2', 'TEST82') returning id into fam2;

  insert into users (family_id, name, avatar, color, auth_user_id)
  values (fam1, 'אדמין1', '🐶', '#000', '00000000-0000-0000-0000-000000080a01') returning id into f1a;
  insert into users (family_id, name, avatar, color, auth_user_id)
  values (fam1, 'חבר-קיים', '🐕', '#111', '00000000-0000-0000-0000-000000080a02') returning id into f1m;
  insert into users (family_id, name, avatar, color, auth_user_id, removed_at)
  values (fam1, 'הוסר', '🦴', '#222', '00000000-0000-0000-0000-000000080a03', now()) returning id into f1r;

  insert into users (family_id, name, avatar, color, auth_user_id)
  values (fam2, 'אדמין2', '🐶', '#333', '00000000-0000-0000-0000-000000080b01') returning id into f2a;
  insert into users (family_id, name, avatar, color, auth_user_id)
  values (fam2, 'חבר-F2', '🐕', '#444', '00000000-0000-0000-0000-000000080b02') returning id into f2m;

  insert into family_auth_members (auth_user_id, family_id, role) values
    ('00000000-0000-0000-0000-000000080a01', fam1, 'admin'),
    ('00000000-0000-0000-0000-000000080a02', fam1, 'member'),
    ('00000000-0000-0000-0000-000000080a03', fam1, 'member'),
    ('00000000-0000-0000-0000-000000080b01', fam2, 'admin'),
    ('00000000-0000-0000-0000-000000080b02', fam2, 'member');

  -- Unclaimed target profiles, one per scenario.
  insert into users (family_id, name, avatar, color) values (fam1, 'יעד-א', '🐩', '#a1') returning id into t_a;
  insert into users (family_id, name, avatar, color) values (fam1, 'יעד-ב', '🐩', '#a2') returning id into t_b;
  insert into users (family_id, name, avatar, color) values (fam1, 'יעד-ג', '🐩', '#a3') returning id into t_c;
  insert into users (family_id, name, avatar, color) values (fam1, 'יעד-ד', '🐩', '#a4') returning id into t_d;
  insert into users (family_id, name, avatar, color) values (fam1, 'יעד-ה', '🐩', '#a5') returning id into t_e;
  insert into users (family_id, name, avatar, color) values (fam1, 'יעד-ו', '🐩', '#a6') returning id into t_f;
  insert into users (family_id, name, avatar, color) values (fam1, 'יעד-ז', '🐩', '#a7') returning id into t_g;
  insert into users (family_id, name, avatar, color) values (fam1, 'יעד-ח', '🐩', '#a8') returning id into t_h;
  insert into users (family_id, name, avatar, color) values (fam1, 'יעד-ט', '🐩', '#a9') returning id into t_i;
  insert into users (family_id, name, avatar, color) values (fam1, 'יעד-י', '🐩', '#a10') returning id into t_j;
  insert into users (family_id, name, avatar, color) values (fam1, 'יעד-יא', '🐩', '#a11') returning id into t_k;
  insert into users (family_id, name, avatar, color) values (fam1, 'יעד-יב', '🐩', '#a12') returning id into t_l;

  create temporary table t8 as
  select fam1 as family_id, fam2 as family2_id, f1a, f1m, f1r, f2a, f2m,
         t_a, t_b, t_c, t_d, t_e, t_f, t_g, t_h, t_i, t_j, t_k, t_l;
end $$;

grant select on t8 to authenticated;

-- ----------------------------------------------------------------------------
-- TEST 1: admin creates an invite for an unclaimed member — succeeds,
-- token_hash stored (not the raw token), raw token returned once, fixed
-- 72-hour TTL.
-- ----------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-000000080a01"}'; -- f1a, admin

create temporary table t8_invite_a as
select * from create_family_invite((select t_a from t8));

-- family_invites has RLS enabled with ZERO client policies by design (§1 of
-- the migration) — a direct SELECT as role `authenticated` would silently
-- return no rows rather than error, which would make the checks below
-- vacuously pass instead of actually verifying anything. `reset role`
-- (bypassing RLS as the table owner, same technique as 0006 test section
-- P) captures the real stored row into an ordinary temp table first; temp
-- tables have no RLS of their own, so the DO block below can safely read
-- it back as `authenticated`.
reset role;
create temporary table t8_invite_a_row as
select * from family_invites where id = (select id from t8_invite_a);
grant select on t8_invite_a_row to authenticated;
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-000000080a01"}';

do $$
declare
  rec record;
  stored_hash text;
  ttl_seconds numeric;
begin
  select * into rec from t8_invite_a;
  if rec.id is null or rec.raw_token is null or length(rec.raw_token) < 32 then
    raise exception 'TEST 1 FAILED: create_family_invite did not return a real token';
  end if;

  select token_hash into stored_hash from t8_invite_a_row;
  if stored_hash = rec.raw_token then
    raise exception 'TEST 1 FAILED: raw token stored verbatim as token_hash';
  end if;
  if stored_hash <> encode(digest(rec.raw_token, 'sha256'), 'hex') then
    raise exception 'TEST 1 FAILED: token_hash does not match sha-256(raw_token)';
  end if;

  ttl_seconds := extract(epoch from (rec.expires_at - now()));
  if ttl_seconds < 71 * 3600 or ttl_seconds > 73 * 3600 then
    raise exception 'TEST 1 FAILED: expires_at is not ~72h from now (got % seconds)', ttl_seconds;
  end if;

  raise notice 'TEST 1 PASSED: admin create succeeded, token hashed correctly, TTL ~72h.';
end $$;

-- ----------------------------------------------------------------------------
-- TEST 2: non-admin cannot call create_family_invite.
-- ----------------------------------------------------------------------------
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-000000080a02"}'; -- f1m, member (not admin)

do $$
begin
  perform create_family_invite((select t_b from t8));
  raise exception 'TEST 2 FAILED: non-admin was allowed to create an invite';
exception
  when others then
    if position('admin permission required' in sqlerrm) = 0 then
      raise;
    end if;
    raise notice 'TEST 2 PASSED: non-admin correctly denied (%).', sqlerrm;
end $$;

-- ----------------------------------------------------------------------------
-- TEST 3 / 4: create and revoke are both rejected while the real admin is
-- actively impersonating a member (CORRECTION ROUND 1 — server-side
-- rejection, not client-hiding).
-- ----------------------------------------------------------------------------
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-000000080a01"}'; -- f1a, admin

select begin_impersonation((select f1m from t8)) as impersonation_session;

do $$
begin
  perform create_family_invite((select t_b from t8));
  raise exception 'TEST 3 FAILED: create_family_invite succeeded while impersonating';
exception
  when others then
    if position('admin permission required' in sqlerrm) = 0 then
      raise;
    end if;
    raise notice 'TEST 3 PASSED: create_family_invite correctly rejected while impersonating (%).', sqlerrm;
end $$;

do $$
begin
  perform revoke_family_invite((select id from t8_invite_a));
  raise exception 'TEST 4 FAILED: revoke_family_invite succeeded while impersonating';
exception
  when others then
    if position('admin permission required' in sqlerrm) = 0 then
      raise;
    end if;
    raise notice 'TEST 4 PASSED: revoke_family_invite correctly rejected while impersonating (%).', sqlerrm;
end $$;

-- TEST 5: list_family_invites() also rejected while impersonating.
do $$
begin
  perform * from list_family_invites();
  raise exception 'TEST 5 FAILED: list_family_invites succeeded while impersonating';
exception
  when others then
    if position('admin permission required' in sqlerrm) = 0 then
      raise;
    end if;
    raise notice 'TEST 5 PASSED: list_family_invites correctly rejected while impersonating (%).', sqlerrm;
end $$;

select end_impersonation();

-- Confirm the admin is fully restored and TEST 1's invite is still 'pending'
-- and untouched by the rejected attempts above. (RLS bypass via reset role
-- — see the comment on t8_invite_a_row above for why.)
reset role;
create temporary table t8_invite_a_row2 as
select * from family_invites where id = (select id from t8_invite_a);
grant select on t8_invite_a_row2 to authenticated;
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-000000080a01"}';

do $$
declare
  st text;
begin
  select status into st from t8_invite_a_row2;
  if st <> 'pending' then
    raise exception 'TEST 3/4/5 SIDE EFFECT: invite status changed to % despite rejected calls', st;
  end if;
  raise notice 'TEST 3/4/5 confirmed no side effects: invite A still pending.';
end $$;

-- ----------------------------------------------------------------------------
-- TEST 6: valid fresh-device redemption — succeeds; family_auth_members +
-- users.auth_user_id both updated atomically; invite becomes 'redeemed';
-- role is 'member' (never admin, regardless of the creating admin's role).
-- ----------------------------------------------------------------------------
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-000000080c01"}'; -- fresh_1, brand new device

create temporary table t8_redeem_a as
select * from redeem_family_invite((select raw_token from t8_invite_a));

-- RLS bypass to inspect the raw invite row directly (see t8_invite_a_row's
-- comment above for why this is necessary and expected).
reset role;
create temporary table t8_invite_a_row3 as
select * from family_invites where id = (select id from t8_invite_a);
grant select on t8_invite_a_row3 to authenticated;
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-000000080c01"}';

do $$
declare
  rec record;
  claimed_auth uuid;
  member_role text;
  inv_status text;
begin
  select * into rec from t8_redeem_a;
  if rec.family_id is distinct from (select family_id from t8) or rec.target_user_id is distinct from (select t_a from t8) then
    raise exception 'TEST 6 FAILED: redeem_family_invite returned unexpected family/target';
  end if;

  select auth_user_id into claimed_auth from users where id = (select t_a from t8);
  if claimed_auth is distinct from '00000000-0000-0000-0000-000000080c01'::uuid then
    raise exception 'TEST 6 FAILED: target profile was not claimed by fresh_1';
  end if;

  select role into member_role from family_auth_members where auth_user_id = '00000000-0000-0000-0000-000000080c01'::uuid;
  if member_role <> 'member' then
    raise exception 'TEST 6 FAILED: role after redemption was % (expected member)', member_role;
  end if;

  select status into inv_status from t8_invite_a_row3;
  if inv_status <> 'redeemed' then
    raise exception 'TEST 6 FAILED: invite status is % (expected redeemed)', inv_status;
  end if;

  raise notice 'TEST 6 PASSED: fresh-device redemption succeeded atomically with role=member.';
end $$;

-- ----------------------------------------------------------------------------
-- TEST 7: expired invite rejection (derived expiry — status column stays
-- 'pending', only expires_at makes it expired; correction round 7).
-- ----------------------------------------------------------------------------
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-000000080a01"}'; -- f1a, admin

create temporary table t8_invite_expired as
select * from create_family_invite((select t_c from t8));

-- Simulate the passage of time by directly aging the row's expires_at — the
-- ONLY way this ever happens for real is time itself passing; nothing in
-- this feature ever writes a persisted 'expired' status.
reset role;
update family_invites set expires_at = now() - interval '1 minute'
where id = (select id from t8_invite_expired);

do $$
declare
  st text;
begin
  select status into st from family_invites where id = (select id from t8_invite_expired);
  if st <> 'pending' then
    raise exception 'TEST 7 SETUP FAILED: status was written as % instead of staying pending', st;
  end if;
end $$;

set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-000000080a01"}';

-- inspect_family_invite must report the DERIVED 'expired' status even
-- though the persisted column still reads 'pending'.
do $$
declare
  rec record;
begin
  select * into rec from inspect_family_invite((select raw_token from t8_invite_expired));
  if rec.status <> 'expired' then
    raise exception 'TEST 7a FAILED: inspect_family_invite reported % instead of derived expired', rec.status;
  end if;
  raise notice 'TEST 7a PASSED: inspect_family_invite derives expired correctly.';
end $$;

set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-000000080c02"}'; -- fresh_2

do $$
begin
  perform redeem_family_invite((select raw_token from t8_invite_expired));
  raise exception 'TEST 7b FAILED: redemption of an expired invite succeeded';
exception
  when others then
    if position('invite expired' in sqlerrm) = 0 then
      raise;
    end if;
    raise notice 'TEST 7b PASSED: redemption correctly rejected as expired (%).', sqlerrm;
end $$;

-- ----------------------------------------------------------------------------
-- TEST 8: revoked invite rejection.
-- ----------------------------------------------------------------------------
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-000000080a01"}'; -- f1a, admin

create temporary table t8_invite_revoked as
select * from create_family_invite((select t_d from t8));

select revoke_family_invite((select id from t8_invite_revoked));

set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-000000080c03"}'; -- fresh_3

do $$
begin
  perform redeem_family_invite((select raw_token from t8_invite_revoked));
  raise exception 'TEST 8 FAILED: redemption of a revoked invite succeeded';
exception
  when others then
    if position('invite was revoked' in sqlerrm) = 0 then
      raise;
    end if;
    raise notice 'TEST 8 PASSED: redemption correctly rejected as revoked (%).', sqlerrm;
end $$;

-- Also confirm revoke_family_invite() is idempotent (no error) when called
-- again on an already-revoked invite.
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-000000080a01"}';
select revoke_family_invite((select id from t8_invite_revoked));
-- expect: no error (idempotent)

-- ----------------------------------------------------------------------------
-- TEST 9: sequential replay rejection — redeeming an already-redeemed
-- invite a second time fails.
-- ----------------------------------------------------------------------------
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-000000080a01"}'; -- f1a, admin

create temporary table t8_invite_replay as
select * from create_family_invite((select t_e from t8));

set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-000000080c04"}'; -- fresh_4
select redeem_family_invite((select raw_token from t8_invite_replay));
-- expect: success (first redemption)

do $$
begin
  perform redeem_family_invite((select raw_token from t8_invite_replay));
  raise exception 'TEST 9 FAILED: replaying an already-redeemed invite succeeded';
exception
  when others then
    if position('invite already used' in sqlerrm) = 0 then
      raise;
    end if;
    raise notice 'TEST 9 PASSED: sequential replay correctly rejected (%).', sqlerrm;
end $$;

-- ----------------------------------------------------------------------------
-- TEST 10: removed-target rejection AT CREATE TIME — an admin cannot even
-- create an invite for a removed profile.
-- ----------------------------------------------------------------------------
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-000000080a01"}'; -- f1a, admin

do $$
begin
  perform create_family_invite((select f1r from t8)); -- removed member
  raise exception 'TEST 10 FAILED: an invite was created for a removed profile';
exception
  when others then
    if position('cannot invite a removed profile' in sqlerrm) = 0 then
      raise;
    end if;
    raise notice 'TEST 10 PASSED: create correctly rejected a removed target (%).', sqlerrm;
end $$;

-- ----------------------------------------------------------------------------
-- TEST 11: target claimed AFTER invite creation — redemption re-validates
-- the target fresh and rejects rather than taking over an already-claimed
-- profile.
-- ----------------------------------------------------------------------------
create temporary table t8_invite_race as
select * from create_family_invite((select t_f from t8));

-- Simulate a different device claiming the target directly in between
-- (e.g. via claim_family_profile from a device that separately joined the
-- family through the ordinary invite-code flow) — done here as a direct,
-- privileged write to set up the race precondition; the actual claim path
-- itself is already covered by 0004's own tests. Uses fresh_5
-- ('...080c05', reserved above for exactly this) as the simulated claiming
-- device — NOT an existing profile's auth_user_id, since
-- users_auth_user_id_idx is a real unique index and reusing f1m's id here
-- would just violate that constraint rather than simulate anything.
reset role;
update users set auth_user_id = '00000000-0000-0000-0000-000000080c05'::uuid
where id = (select t_f from t8) and auth_user_id is null;

set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-000000080c06"}'; -- fresh_6

do $$
begin
  perform redeem_family_invite((select raw_token from t8_invite_race));
  raise exception 'TEST 11 FAILED: redemption succeeded against a target claimed after invite creation';
exception
  when others then
    if position('target profile is not available for this invite' in sqlerrm) = 0 then
      raise;
    end if;
    raise notice 'TEST 11 PASSED: redemption correctly rejected (%).', sqlerrm;
end $$;

-- ----------------------------------------------------------------------------
-- TEST 12: different-family collision rejection (CORRECTION ROUND 2) — a
-- device already belonging to F2 attempts to redeem an F1 invite. Must be
-- rejected with NO reassignment; the device's F2 membership must be
-- unchanged.
-- ----------------------------------------------------------------------------
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-000000080a01"}'; -- f1a, admin
create temporary table t8_invite_g as
select * from create_family_invite((select t_g from t8));

set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-000000080b02"}'; -- f2m, already a member of F2

do $$
declare
  before_family uuid;
  after_family uuid;
begin
  select family_id into before_family from family_auth_members where auth_user_id = '00000000-0000-0000-0000-000000080b02'::uuid;

  begin
    perform redeem_family_invite((select raw_token from t8_invite_g));
    raise exception 'TEST 12 FAILED: cross-family redemption succeeded';
  exception
    when others then
      if position('account already belongs to a different family' in sqlerrm) = 0 then
        raise;
      end if;
  end;

  select family_id into after_family from family_auth_members where auth_user_id = '00000000-0000-0000-0000-000000080b02'::uuid;
  if after_family is distinct from before_family then
    raise exception 'TEST 12 FAILED: family membership was reassigned despite rejection (% -> %)', before_family, after_family;
  end if;
  if after_family is distinct from (select family2_id from t8) then
    raise exception 'TEST 12 FAILED: unexpected family membership state';
  end if;

  raise notice 'TEST 12 PASSED: cross-family redemption rejected with NO reassignment.';
end $$;

-- Also confirm the target profile itself was never claimed by the rejecting device.
do $$
declare
  claimed_by uuid;
begin
  select auth_user_id into claimed_by from users where id = (select t_g from t8);
  if claimed_by is not null then
    raise exception 'TEST 12 FAILED: target profile was claimed despite rejected redemption';
  end if;
end $$;

-- ----------------------------------------------------------------------------
-- TEST 13: existing-different-profile collision rejection (CORRECTION
-- ROUND 2) — a device that already has ITS OWN claimed profile in F1
-- attempts to redeem an invite for a DIFFERENT F1 profile. Must be
-- rejected; the original claim must be untouched.
-- ----------------------------------------------------------------------------
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-000000080a01"}'; -- f1a, admin
create temporary table t8_invite_h as
select * from create_family_invite((select t_h from t8));

set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-000000080a02"}'; -- f1m — already claimed a DIFFERENT profile

do $$
declare
  original_claim uuid;
begin
  select id into original_claim from users where auth_user_id = '00000000-0000-0000-0000-000000080a02'::uuid;

  begin
    perform redeem_family_invite((select raw_token from t8_invite_h));
    raise exception 'TEST 13 FAILED: second-profile redemption succeeded';
  exception
    when others then
      if position('account already has a claimed profile' in sqlerrm) = 0 then
        raise;
      end if;
  end;

  -- Original claim must be exactly as it was.
  if not exists (select 1 from users where id = original_claim and auth_user_id = '00000000-0000-0000-0000-000000080a02'::uuid) then
    raise exception 'TEST 13 FAILED: original claim was disturbed';
  end if;
  -- The target profile must remain unclaimed.
  if exists (select 1 from users where id = (select t_h from t8) and auth_user_id is not null) then
    raise exception 'TEST 13 FAILED: target profile was claimed despite rejection';
  end if;

  raise notice 'TEST 13 PASSED: existing-different-profile redemption rejected, original claim untouched.';
end $$;

-- ----------------------------------------------------------------------------
-- TEST 14: explicit target_user.family_id = invite.family_id protection
-- (CORRECTION ROUND 3) — simulate a target whose family_id has drifted away
-- from the invite's own family_id (the only way this could ever happen in
-- practice — a future bug or manual intervention — mirrors 0006 test Q's
-- own "simulate the drift directly" technique) and confirm redemption is
-- rejected rather than trusting the two independent foreign keys alone.
-- ----------------------------------------------------------------------------
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-000000080a01"}'; -- f1a, admin
create temporary table t8_invite_i as
select * from create_family_invite((select t_i from t8));

reset role;
update users set family_id = (select family2_id from t8) where id = (select t_i from t8);
-- The target row's family_id now points at F2, while the already-created
-- invite still has family_id = F1 — a state that should never arise via any
-- code path in this app (users.family_id is never rewritten after
-- creation), but must still be caught if it ever did.

set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-000000080c07"}'; -- fresh_7

do $$
begin
  perform redeem_family_invite((select raw_token from t8_invite_i));
  raise exception 'TEST 14 FAILED: redemption succeeded despite target/invite family mismatch';
exception
  when others then
    if position('target profile is not available for this invite' in sqlerrm) = 0 then
      raise;
    end if;
    raise notice 'TEST 14 PASSED: explicit family-match re-check correctly rejected the drifted state (%).', sqlerrm;
end $$;

-- Repair the drifted row so it doesn't confuse any later test in this file.
reset role;
update users set family_id = (select family_id from t8) where id = (select t_i from t8);

-- ----------------------------------------------------------------------------
-- TEST 15: list_family_invites() exposes neither raw token nor token_hash
-- (CORRECTION ROUND 4). Structural: the function's own return signature has
-- no such column; this also does a defensive JSON-key scan to prove it at
-- the data level, not just by reading the function definition.
-- ----------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-000000080a01"}'; -- f1a, admin

do $$
declare
  rec record;
  as_json jsonb;
begin
  for rec in select * from list_family_invites() loop
    as_json := to_jsonb(rec);
    if as_json ? 'token_hash' then
      raise exception 'TEST 15 FAILED: list_family_invites row exposed a token_hash key';
    end if;
    if as_json ? 'raw_token' then
      raise exception 'TEST 15 FAILED: list_family_invites row exposed a raw_token key';
    end if;
  end loop;
  raise notice 'TEST 15 PASSED: list_family_invites never exposes token_hash/raw_token.';
end $$;

-- ----------------------------------------------------------------------------
-- TEST 16: regeneration supersedes/revokes the previous pending invite.
-- ----------------------------------------------------------------------------
create temporary table t8_invite_j1 as
select * from create_family_invite((select t_j from t8));

create temporary table t8_invite_j2 as
select * from create_family_invite((select t_j from t8)); -- same target — must supersede j1

-- RLS bypass to inspect the raw invite rows directly (see t8_invite_a_row's
-- comment above for why this is necessary and expected).
reset role;
create temporary table t8_invites_j_rows as
select * from family_invites where target_user_id = (select t_j from t8);
grant select on t8_invites_j_rows to authenticated;
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-000000080a01"}';

do $$
declare
  j1_status text;
  j2_status text;
  pending_count int;
begin
  select status into j1_status from t8_invites_j_rows where id = (select id from t8_invite_j1);
  select status into j2_status from t8_invites_j_rows where id = (select id from t8_invite_j2);

  if j1_status <> 'revoked' then
    raise exception 'TEST 16 FAILED: first invite was not superseded (status = %)', j1_status;
  end if;
  if j2_status <> 'pending' then
    raise exception 'TEST 16 FAILED: second invite is not pending (status = %)', j2_status;
  end if;

  select count(*) into pending_count from t8_invites_j_rows
  where target_user_id = (select t_j from t8) and status = 'pending';
  if pending_count <> 1 then
    raise exception 'TEST 16 FAILED: expected exactly 1 pending invite for target, got %', pending_count;
  end if;

  raise notice 'TEST 16 PASSED: regeneration correctly superseded the previous pending invite.';
end $$;

-- The old (now-revoked) token must no longer be redeemable.
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-000000080c08"}'; -- fresh_8

do $$
begin
  perform redeem_family_invite((select raw_token from t8_invite_j1));
  raise exception 'TEST 16b FAILED: the superseded (old) token was still redeemable';
exception
  when others then
    if position('invite was revoked' in sqlerrm) = 0 then
      raise;
    end if;
    raise notice 'TEST 16b PASSED: superseded token correctly rejected as revoked (%).', sqlerrm;
end $$;

-- ----------------------------------------------------------------------------
-- TEST 17: raw tokens never appear in audit_log metadata, anywhere, for any
-- invite-related event logged during this entire script.
-- ----------------------------------------------------------------------------
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-000000080a01"}'; -- f1a, admin

do $$
declare
  leaked_count int;
  raw_tokens text[];
begin
  select array_agg(raw_token) into raw_tokens from (
    select raw_token from t8_invite_a
    union all select raw_token from t8_invite_expired
    union all select raw_token from t8_invite_revoked
    union all select raw_token from t8_invite_replay
    union all select raw_token from t8_invite_race
    union all select raw_token from t8_invite_g
    union all select raw_token from t8_invite_h
    union all select raw_token from t8_invite_i
    union all select raw_token from t8_invite_j1
    union all select raw_token from t8_invite_j2
  ) tokens;

  select count(*) into leaked_count
  from audit_log al, unnest(raw_tokens) as tok
  where al.action like 'invite_%'
    and al.metadata::text like '%' || tok || '%';

  if leaked_count > 0 then
    raise exception 'TEST 17 FAILED: % audit_log row(s) contained a raw invite token', leaked_count;
  end if;

  raise notice 'TEST 17 PASSED: no raw invite token found in any audit_log metadata.';
end $$;

-- Sanity check that invite audit events ARE actually being written (so TEST
-- 17 passing isn't vacuously true because nothing was logged at all).
do $$
declare
  invite_event_count int;
begin
  select count(*) into invite_event_count from audit_log where action like 'invite_%';
  if invite_event_count = 0 then
    raise exception 'TEST 17 SANITY FAILED: no invite_ audit_log rows were written at all';
  end if;
  raise notice 'TEST 17 sanity check: % invite_ audit_log rows present.', invite_event_count;
end $$;

-- ----------------------------------------------------------------------------
-- TEST 18: derived-expiry behavior confirmed end-to-end with no persisted
-- 'expired' status anywhere in the table, even after every test above.
-- family_invites has zero client SELECT policy (by design, §1 of the
-- migration) so this final whole-table check requires the same RLS bypass
-- used throughout this file.
-- ----------------------------------------------------------------------------
reset role;
create temporary table t8_all_invites as select * from family_invites;
grant select on t8_all_invites to authenticated;
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-000000080a01"}';

do $$
declare
  bad_count int;
begin
  select count(*) into bad_count from t8_all_invites where status = 'expired';
  if bad_count <> 0 then
    raise exception 'TEST 18 FAILED: % row(s) have a persisted status of ''expired''', bad_count;
  end if;
  raise notice 'TEST 18 PASSED: no row ever persists status=''expired'' — it is derived only.';
end $$;

rollback; -- never actually commit test data
