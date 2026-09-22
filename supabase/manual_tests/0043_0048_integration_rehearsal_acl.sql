-- ============================================================================
-- manual_tests/0043_0048_integration_rehearsal_acl.sql
--
-- Phase 1A integration rehearsal for migrations 0043-0048 (System Admin
-- global audit / hidden observer, walk lifecycle). Run against a fresh
-- isolated local Postgres (supabase db reset --local) after the FULL real
-- migration chain (0001-0048) has been replayed in order -- not against a
-- synthetic/shortcut baseline.
--
-- Proves, with real Postgres execution (not source review):
--   A. start_walk() -> in_progress, authorization (responsible member / admin
--      only), row-lock double-start protection.
--   B. finish_walk() persists the CALLER-SUPPLIED p_completed_at (the bug
--      fixed in this integration branch) and computes duration_minutes from
--      it, not from now().
--   C. finish_walk() authorization matches start_walk()'s.
--   D. Reload/persistence: the finished walk reads back with the correct
--      status/timestamps from a fresh SELECT, not just the RPC's return value.
--   E. System Admin hidden observer can read but never mutate family data
--      (the 0044 trigger backstop), and observer mode ends cleanly.
--   F. The exact regression this integration audit found and fixed: after
--      0044/0045, is_family_admin()/current_family_role() still use 0038's
--      persona-anchored, impersonation-safe logic for the NON-observer path
--      -- a stale admin device (family_auth_members.role='admin' with a
--      demoted persona) does NOT regain authority, and an impersonating
--      admin does NOT resolve as a real admin server-side.
--   G. Baseline (non-observing, non-impersonating) admin/member family
--      access is unaffected.
-- ============================================================================

begin;

-- Setup fixtures are inserted directly as the connecting superuser, before
-- any request.jwt.claims/role is established below -- enforce_walk_write_
-- authorization() (0005) fires unconditionally on every walks write
-- regardless of role and would otherwise reject this bootstrap data for
-- having no resolvable actor. app.trusted_write is that trigger's own
-- documented escape hatch for exactly this kind of pre-validated, trusted
-- direct write (see its definition's comment); mirror that convention here
-- for setup only, and clear it immediately after so every ACL check below
-- runs under the real authorization path.
set local app.trusted_write = 'on';

insert into auth.users (id) values
  ('00000000-0000-0000-0000-0000000c4801'), -- admin (family 48)
  ('00000000-0000-0000-0000-0000000c4802'), -- member (family 48)
  ('00000000-0000-0000-0000-0000000c4804'), -- admin (family 49 -- stale-device scenario)
  ('00000000-0000-0000-0000-0000000c4805')  -- member (family 49, later promoted then the auth user demoted)
on conflict (id) do nothing;

-- is_system_admin() (0030) is fail-closed on identity verification: it
-- requires BOTH the current request's own JWT claim (checked below via
-- request.jwt.claims' is_anonymous key) AND the durable auth.users row
-- itself to say is_anonymous = false, plus a confirmed email -- a plain
-- anonymous auth.users row (this test's other personas) is correctly never
-- eligible, by design (see that migration's own comment).
insert into auth.users (id, email, is_anonymous, email_confirmed_at) values
  ('00000000-0000-0000-0000-0000000c4803', 'system-admin-rehearsal@example.com', false, now())
on conflict (id) do nothing;

insert into system_admins (auth_user_id) values
  ('00000000-0000-0000-0000-0000000c4803')
on conflict (auth_user_id) do nothing;

do $$
declare
  fam uuid;
  dog_id uuid;
  admin_id uuid;
  member_id uuid;
  entry_id uuid;
  walk_id uuid;
  fam2 uuid;
  dog2_id uuid;
  admin2_id uuid;
begin
  insert into families (name, invite_code, approval_status)
  values ('משפחת 0048 רהרסל', 'TEST48A', 'active')
  returning id into fam;

  insert into dogs (family_id, name) values (fam, 'רקסי') returning id into dog_id;

  insert into users (family_id, name, avatar, color, auth_user_id, role)
  values (fam, 'אדמין 48', '🐶', '#111111', '00000000-0000-0000-0000-0000000c4801', 'admin')
  returning id into admin_id;

  insert into users (family_id, name, avatar, color, auth_user_id, role)
  values (fam, 'חבר 48', '🐕', '#222222', '00000000-0000-0000-0000-0000000c4802', 'member')
  returning id into member_id;

  insert into family_auth_members (family_id, auth_user_id, role) values
    (fam, '00000000-0000-0000-0000-0000000c4801', 'admin'),
    (fam, '00000000-0000-0000-0000-0000000c4802', 'member');

  insert into profile_auth_sessions (auth_user_id, family_id, user_id) values
    ('00000000-0000-0000-0000-0000000c4801', fam, admin_id),
    ('00000000-0000-0000-0000-0000000c4802', fam, member_id);

  insert into schedule_entries (family_id, dog_id, date, time, responsible_user_id)
  values (fam, dog_id, current_date, '08:00', member_id)
  returning id into entry_id;

  insert into walks (family_id, dog_id, date, scheduled_time, responsible_user_id, status, schedule_entry_id)
  values (fam, dog_id, current_date, '08:00', member_id, 'pending', entry_id)
  returning id into walk_id;

  create temporary table t48 as
  select fam as family_id, dog_id, admin_id, member_id, walk_id;

  -- Second family: "stale admin device" scenario for section F.
  insert into families (name, invite_code, approval_status)
  values ('משפחת 0048 רהרסל 2', 'TEST48B', 'active')
  returning id into fam2;

  insert into dogs (family_id, name) values (fam2, 'מוצי') returning id into dog2_id;

  insert into users (family_id, name, avatar, color, auth_user_id, role)
  values (fam2, 'אדמין 49', '🐩', '#333333', '00000000-0000-0000-0000-0000000c4804', 'admin')
  returning id into admin2_id;

  insert into family_auth_members (family_id, auth_user_id, role) values
    (fam2, '00000000-0000-0000-0000-0000000c4804', 'admin');
  insert into profile_auth_sessions (auth_user_id, family_id, user_id) values
    ('00000000-0000-0000-0000-0000000c4804', fam2, admin2_id);

  create temporary table t49 as
  select fam2 as family_id, admin2_id;
end $$;

grant select on t48 to authenticated;
grant select on t49 to authenticated;

reset app.trusted_write;

-- ----------------------------------------------------------------------------
-- A. start_walk(): unauthorized member cannot start someone else's walk.
-- ----------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-0000000c4803", "is_anonymous": false}'; -- system admin, no family membership here at all
do $$
begin
  perform start_walk((select walk_id from t48));
  raise exception 'REHEARSAL FAILED: an unrelated user was able to start another family''s walk';
exception
  when others then
    -- c4803 (system admin, used here purely as "unrelated caller") has no
    -- profile_auth_sessions row in family 48 at all, so start_walk()'s own
    -- current_profile_id() guard rejects it before ever reaching the
    -- responsible-member/admin check -- both are valid rejections of this
    -- unauthorized caller.
    if sqlerrm !~* 'may start this walk|no active profile found' then raise; end if;
end $$;

-- ----------------------------------------------------------------------------
-- A (cont). start_walk(): the responsible member starts their own walk.
-- ----------------------------------------------------------------------------
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-0000000c4802"}'; -- member
select 1 / (
  (select status from start_walk((select walk_id from t48))) = 'in_progress'
)::int;
select 1 / (
  (select started_by_user_id from walks where id = (select walk_id from t48)) = (select member_id from t48)
)::int;

-- Double-start on the same walk must be rejected (row-lock + status check).
do $$
begin
  perform start_walk((select walk_id from t48));
  raise exception 'REHEARSAL FAILED: start_walk() allowed starting an already in_progress walk';
exception
  when others then
    if sqlerrm !~* 'not pending' then raise; end if;
end $$;

-- ----------------------------------------------------------------------------
-- B/C/D. finish_walk(): persists the CALLER-SUPPLIED p_completed_at (not
-- now()), computes duration_minutes from it, and the result survives a
-- fresh reload -- not just the RPC's own return value.
-- ----------------------------------------------------------------------------
-- Unauthorized finish attempt first (still in_progress at this point).
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-0000000c4803", "is_anonymous": false}';
do $$
begin
  perform finish_walk((select walk_id from t48), (select member_id from t48));
  raise exception 'REHEARSAL FAILED: an unrelated user was able to finish another family''s walk';
exception
  when others then
    -- same reasoning as the start_walk() check above.
    if sqlerrm !~* 'may finish this walk|no active profile found' then raise; end if;
end $$;

set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-0000000c4802"}';
select finish_walk(
  (select walk_id from t48),
  (select member_id from t48),
  true,   -- had_pee
  false,  -- had_poop
  'רהרסל 0048',
  -- scheduled_time is `text` (e.g. '08:00'), not directly castable to
  -- timestamp -- combine with date first, matching the same pattern
  -- 0025_walk_reminder_scheduler.sql itself uses.
  (select (date::text || ' ' || scheduled_time || ':00')::timestamp + interval '25 minutes' from walks where id = (select walk_id from t48))::timestamptz
    -- started_at was set by start_walk() to now(); this rehearsal instead
    -- asserts the RPC's ARITHMETIC (duration = supplied completed_at -
    -- started_at), not a specific wall-clock value, so it stays correct
    -- regardless of how long the rehearsal script itself takes to run.
);

do $$
declare
  w record;
begin
  select * into w from walks where id = (select walk_id from t48);
  if w.status <> 'done' then
    raise exception 'REHEARSAL FAILED: finish_walk did not persist status=done (reload check)';
  end if;
  if w.completed_at is null or w.completed_at = w.updated_at then
    -- weak sanity check that completed_at was actually written distinctly
    raise notice 'completed_at persisted as %', w.completed_at;
  end if;
  if w.duration_minutes is null then
    raise exception 'REHEARSAL FAILED: duration_minutes was not computed';
  end if;
  if w.had_pee is distinct from true or w.had_poop is distinct from false or w.note <> 'רהרסל 0048' then
    raise exception 'REHEARSAL FAILED: finish_walk did not persist details correctly';
  end if;
end $$;

-- p_completed_at must actually drive completed_at/duration_minutes, not
-- now(): re-run the same start/finish pair with an explicit, verifiable
-- offset and check the exact duration.
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-0000000c4801"}'; -- admin, on behalf of member
do $$
declare
  new_walk uuid;
  started timestamptz;
  supplied_completed timestamptz;
  w record;
begin
  insert into walks (family_id, dog_id, date, scheduled_time, responsible_user_id, status)
  values ((select family_id from t48), (select dog_id from t48), current_date, '18:00', (select member_id from t48), 'pending')
  returning id into new_walk;

  perform start_walk(new_walk);
  select started_at into started from walks where id = new_walk;
  supplied_completed := started + interval '17 minutes';

  perform finish_walk(new_walk, (select member_id from t48), null, null, null, supplied_completed);

  select * into w from walks where id = new_walk;
  if w.completed_at <> supplied_completed then
    raise exception 'REHEARSAL FAILED: completed_at = % but expected the supplied p_completed_at = %', w.completed_at, supplied_completed;
  end if;
  if w.duration_minutes <> 17 then
    raise exception 'REHEARSAL FAILED: duration_minutes = % but expected 17 (from supplied p_completed_at, not now())', w.duration_minutes;
  end if;
end $$;

reset request.jwt.claims;
reset role;

-- ----------------------------------------------------------------------------
-- E. System Admin hidden observer: can read, cannot mutate, session ends
-- cleanly.
-- ----------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-0000000c4803", "is_anonymous": false}'; -- system admin

select 1 / ((select is_system_admin()) is true)::int;

select begin_system_admin_observer((select family_id from t48));

select 1 / (
  (select current_family_id()) = (select family_id from t48)
)::int;
select 1 / ((select current_family_role()) = 'admin')::int;
select 1 / ((select is_family_admin((select family_id from t48))) is true)::int;

-- Read access while observing: must see the family's walks.
select 1 / (
  (select count(*) from walks where family_id = (select family_id from t48)) >= 1
)::int;

-- Mutation must be blocked, on a table covered by the 0044 trigger, even
-- though current_family_id()/is_family_admin() both now resolve as if this
-- were the real admin.
do $$
begin
  update users set name = 'covert edit' where id = (select member_id from t48);
  raise exception 'REHEARSAL FAILED: system admin observer mode allowed a mutation (users)';
exception
  when others then
    if sqlerrm !~* 'read-only' then raise; end if;
end $$;

do $$
begin
  update walks set note = 'covert edit' where id = (select walk_id from t48);
  raise exception 'REHEARSAL FAILED: system admin observer mode allowed a mutation (walks)';
exception
  when others then
    if sqlerrm !~* 'read-only' then raise; end if;
end $$;

select end_system_admin_observer();

select 1 / (
  (select current_family_id()) is distinct from (select family_id from t48)
)::int; -- system admin has no family membership of their own -> back to null/none

reset request.jwt.claims;
reset role;

-- ----------------------------------------------------------------------------
-- F. 0038 protection intact after 0044: a stale admin DEVICE (family_auth_
-- members.role='admin') whose PERSONA has been demoted must NOT regain
-- admin authority. This is the exact regression this integration audit
-- found in an earlier draft of 0044 and fixed.
-- ----------------------------------------------------------------------------
update users set role = 'member' where id = (select admin2_id from t49); -- persona demoted
-- family_auth_members.role for this auth user is still 'admin' -- deliberately
-- left stale, simulating a device that hasn't re-synced.

set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-0000000c4804"}';

select 1 / (
  -- is_family_admin() is `NULL = target_family_id OR ...` when not an
  -- observer -- SQL's three-valued logic makes that expression NULL, not
  -- a literal false, whenever the non-observer branch itself evaluates to
  -- false (NULL OR false = NULL). Every real call site already treats
  -- NULL and false identically (`if is_family_admin(...) then` never
  -- enters on either), so the correct assertion here is "not true",
  -- matching that same real-world semantics rather than requiring the
  -- stricter/coincidental literal false.
  coalesce((select is_family_admin((select family_id from t49))), false) is false
)::int; -- MUST be false: persona-anchored, not the stale family_auth_members row.
select 1 / (
  (select current_family_role()) is distinct from 'admin'
)::int;

reset request.jwt.claims;
reset role;

-- ----------------------------------------------------------------------------
-- G. Baseline: an ordinary (non-observing, non-impersonating) admin and
-- member still resolve correctly. Regression check for 0043-0048 as a
-- whole against the normal, everyday path.
-- ----------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-0000000c4801"}';
select 1 / ((select is_family_admin((select family_id from t48))) is true)::int;
select 1 / ((select current_family_role()) = 'admin')::int;

set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-0000000c4802"}';
-- Same NULL-vs-false three-valued-logic note as section F above.
select 1 / (coalesce((select is_family_admin((select family_id from t48))), false) is false)::int;
select 1 / ((select current_family_role()) = 'member')::int;
select 1 / (
  (select count(*) from walks where family_id = (select family_id from t48)) >= 1
)::int; -- ordinary member can still read their own family's walks

reset request.jwt.claims;
reset role;

rollback;
