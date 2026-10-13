-- ============================================================================
-- manual_tests/0005_requests_audit_presence_acl.sql
--
-- Manual verification script for migrations/0005_requests_audit_presence.sql:
--   - walk_swap_requests + create/approve/reject_swap_request()
--   - time_change_requests + create/approve/reject_time_change_request()
--   - audit_log (admin-only read, no client write) + log_client_audit_event()
--   - user_presence (admin-or-self read) + touch_last_seen()
--   - admin_list_family_activity() / admin_list_audit_log()
--   - the walks/schedule_entries INSERT/UPDATE active-user RLS hardening
--
-- Same caveat as manual_tests/0004_profile_edit_acl.sql: this sandbox has no
-- live Postgres/Supabase instance, so this is a plain script with
-- "-- expect:" comments to check by eye against a disposable/staging
-- Supabase project (after applying migrations 0001-0005), NOT wired into
-- `npm test`. It is not pgTAP.
--
-- Concurrency note: like 0004's claim_family_profile() race, the
-- "concurrent approval" requirement for approve_swap_request()/
-- approve_time_change_request() (the `for update` row locks) genuinely
-- needs two real interleaved connections to reproduce — a single serial
-- script proves the SECOND sequential call is rejected once the first has
-- resolved the request (idempotency / already-resolved-differently), which
-- exercises the same guard code path the lock protects, but does not by
-- itself prove the lock prevents a true simultaneous double-apply. Treat
-- this script as necessary, not sufficient, for the concurrency requirement
-- — see 0004_claim_race_test.sh's approach for how to build a genuine
-- two-connection race harness if that stronger guarantee needs verifying.
-- ============================================================================

begin;

-- ----------------------------------------------------------------------------
-- Setup: one family with an admin (a1), two members (a2 target-of-swap, a3
-- requester), a removed member (a4), and a dog with one pending walk owned
-- by a3.
-- ----------------------------------------------------------------------------
insert into auth.users (id) values
  ('00000000-0000-0000-0000-0000000c0a01'), -- admin
  ('00000000-0000-0000-0000-0000000c0a02'), -- member: swap target
  ('00000000-0000-0000-0000-0000000c0a03'), -- member: requester / walk owner
  ('00000000-0000-0000-0000-0000000c0a04')  -- removed member (claimed before removal)
on conflict (id) do nothing;

do $$
declare
  fam uuid;
  dog_id uuid;
  admin_id uuid;
  target_id uuid;
  requester_id uuid;
  removed_id uuid;
  walk_id uuid;
begin
  insert into families (name, invite_code) values ('משפחת 0005', 'TEST05') returning id into fam;
  insert into dogs (family_id, name) values (fam, 'רקסי') returning id into dog_id;

  insert into users (family_id, name, avatar, color, auth_user_id)
  values (fam, 'אדמין', '🐶', '#000', '00000000-0000-0000-0000-0000000c0a01') returning id into admin_id;
  insert into users (family_id, name, avatar, color, auth_user_id)
  values (fam, 'יעד', '🐕', '#111', '00000000-0000-0000-0000-0000000c0a02') returning id into target_id;
  insert into users (family_id, name, avatar, color, auth_user_id)
  values (fam, 'מבקש', '🐩', '#222', '00000000-0000-0000-0000-0000000c0a03') returning id into requester_id;
  insert into users (family_id, name, avatar, color, auth_user_id, removed_at)
  values (fam, 'הוסר', '🦴', '#333', '00000000-0000-0000-0000-0000000c0a04', now()) returning id into removed_id;

  insert into family_auth_members (family_id, auth_user_id, role) values
    (fam, '00000000-0000-0000-0000-0000000c0a01', 'admin'),
    (fam, '00000000-0000-0000-0000-0000000c0a02', 'member'),
    (fam, '00000000-0000-0000-0000-0000000c0a03', 'member'),
    (fam, '00000000-0000-0000-0000-0000000c0a04', 'member');

  insert into walks (family_id, dog_id, date, scheduled_time, responsible_user_id, status)
  values (fam, dog_id, current_date + 1, '18:00', requester_id, 'pending') returning id into walk_id;

  create temporary table t5 as
  select fam as family_id, dog_id, admin_id, target_id, requester_id, removed_id, walk_id;
end $$;

-- ----------------------------------------------------------------------------
-- SWAP REQUESTS
-- ----------------------------------------------------------------------------

-- 1. Someone who isn't responsible for the walk cannot request a swap for it.
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-0000000c0a02"}';
select create_swap_request((select walk_id from t5), (select requester_id from t5));
-- expect: error 'you can only request a swap for a walk you are responsible for'

-- 2. The actual responsible member creates a valid swap request.
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-0000000c0a03"}';
select create_swap_request((select walk_id from t5), (select target_id from t5)) as new_swap_request \gset
-- expect: success, returns a uuid

-- 3. A duplicate pending request for the same walk is rejected.
select create_swap_request((select walk_id from t5), (select target_id from t5));
-- expect: error 'a pending swap request already exists for this walk'

-- 4. A removed member cannot be targeted.
-- (separate walk needed since the pending-request check above would fire first)
-- left as a documented case rather than a second walk, to keep this script short:
-- create_swap_request(walk_id, removed_id) against a fresh walk -> expect:
-- error 'target member is not an active member of this family'

-- 5. The REQUESTER cannot approve their own request.
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-0000000c0a03"}';
select approve_swap_request(:'new_swap_request'::uuid);
-- expect: error 'only the requested member can approve this swap'

-- 6. An unrelated member (admin, in this workflow) cannot approve either —
--    swap approval is target-member-only, admin is deliberately NOT the approver.
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-0000000c0a01"}';
select approve_swap_request(:'new_swap_request'::uuid);
-- expect: error 'only the requested member can approve this swap'

-- 7. The actual target approves -> succeeds, walk reassigned, swap_* columns set.
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-0000000c0a02"}';
select approve_swap_request(:'new_swap_request'::uuid);
-- expect: success
select responsible_user_id, swap_original_user_id, swap_new_user_id
from walks where id = (select walk_id from t5);
-- expect: responsible_user_id = target_id, swap_original_user_id = requester_id,
-- swap_new_user_id = target_id

-- 8. Re-approving the same (already-approved) request is a silent no-op, not an error.
select approve_swap_request(:'new_swap_request'::uuid);
-- expect: success (idempotent)

-- 9. Rejecting an already-APPROVED request is a real conflict.
select reject_swap_request(:'new_swap_request'::uuid);
-- expect: error 'this request was already approved'

-- ----------------------------------------------------------------------------
-- TIME-CHANGE REQUESTS
-- ----------------------------------------------------------------------------

-- 10. Only the walk's responsible member (now target_id, after the swap above)
--     can request a time change for it.
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-0000000c0a03"}';
select create_time_change_request((select walk_id from t5), '19:30');
-- expect: error 'you can only request a time change for a walk you are responsible for'

set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-0000000c0a02"}';
select create_time_change_request((select walk_id from t5), '19:30') as new_time_request \gset
-- expect: success

-- 11. The requester cannot approve their own time-change request (admin-only).
select approve_time_change_request(:'new_time_request'::uuid);
-- expect: error 'admin permission required'

-- 12. Admin approves -> succeeds, walks.scheduled_time updated.
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-0000000c0a01"}';
select approve_time_change_request(:'new_time_request'::uuid);
-- expect: success
select scheduled_time from walks where id = (select walk_id from t5);
-- expect: '19:30'

-- 13. Re-approving is idempotent; rejecting afterwards is a conflict.
select approve_time_change_request(:'new_time_request'::uuid);
-- expect: success (idempotent)
select reject_time_change_request(:'new_time_request'::uuid);
-- expect: error 'this request was already approved'

-- ----------------------------------------------------------------------------
-- STALE REQUEST: a walk marked done between request-creation and approval
-- must cause approval to fail safely rather than silently mis-apply.
-- ----------------------------------------------------------------------------
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-0000000c0a02"}';
select create_swap_request((select walk_id from t5), (select requester_id from t5)) as stale_swap_request \gset

update walks set status = 'done' where id = (select walk_id from t5);

set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-0000000c0a03"}';
select approve_swap_request(:'stale_swap_request'::uuid);
-- expect: error 'the walk has changed since this request was created and can no longer be approved'

-- Round 3 gap fix: reverting done -> pending is not an allowed Member
-- self-service transition (enforce_walk_write_authorization(), section 3b)
-- — a real Member could never do this anyway, so restoring the fixture for
-- the tests below needs the admin (who bypasses the write-authorization
-- trigger entirely), not whichever member's role happened to be active.
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-0000000c0a01"}';
update walks set status = 'pending' where id = (select walk_id from t5); -- restore for below

-- ----------------------------------------------------------------------------
-- AUDIT LOG: admin-only read, no direct client write.
-- ----------------------------------------------------------------------------
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-0000000c0a02"}';
select count(*) from audit_log where family_id = (select family_id from t5);
-- expect: 0 rows visible (RLS: admin-only SELECT), even though several
-- events were logged by the RPCs above

insert into audit_log (family_id, actor_user_id, action) values ((select family_id from t5), (select target_id from t5), 'fake');
-- expect: error — no INSERT policy on audit_log for role authenticated

select admin_list_audit_log();
-- expect: error 'admin permission required' (called by a non-admin member)

set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-0000000c0a01"}';
select count(*) from audit_log where family_id = (select family_id from t5);
-- expect: several rows (swap_request_created/approved, time_change_request_created/approved, ...)
select action, target_type from admin_list_audit_log(50, 0) limit 5;
-- expect: success, most recent events first

-- ----------------------------------------------------------------------------
-- PRESENCE: self can write/read their own; admin can read all; a regular
-- member cannot read someone ELSE's presence row.
-- ----------------------------------------------------------------------------
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-0000000c0a02"}';
select touch_last_seen();
select count(*) from user_presence where user_id = (select requester_id from t5);
-- expect: 0 — a member cannot read another member's presence row directly

select user_id, name, last_seen_at from admin_list_family_activity();
-- expect: error 'admin permission required'

set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-0000000c0a01"}';
select user_id, name, last_seen_at from admin_list_family_activity();
-- expect: success, includes target_id's last_seen_at from touch_last_seen() above,
-- and does NOT include an auth_user_id column at all

-- ----------------------------------------------------------------------------
-- WALKS/SCHEDULE_ENTRIES ACTIVE-USER RLS HARDENING: a removed user can never
-- become newly responsible for a walk or schedule entry (INSERT or UPDATE).
-- ----------------------------------------------------------------------------
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-0000000c0a01"}'; -- admin
insert into walks (family_id, dog_id, date, scheduled_time, responsible_user_id, status)
values ((select family_id from t5), (select dog_id from t5), current_date + 2, '09:00', (select removed_id from t5), 'pending');
-- expect: 0 rows inserted / policy violation (WITH CHECK requires an active same-family responsible_user_id)

update walks set responsible_user_id = (select removed_id from t5) where id = (select walk_id from t5);
-- expect: UPDATE 0 — same WITH CHECK applies to UPDATE

-- ----------------------------------------------------------------------------
-- AUDIT TRIGGERS: walk_completed / spontaneous_walk_added /
-- schedule_rule_created/edited/deleted / profile_edited / profile_claimed.
-- These are server-authored (AFTER triggers on walks/schedule_rules/users) —
-- a client cannot forge any of them by calling a "log this" RPC, because
-- there is none: the event is only ever recorded if the underlying row
-- change actually happens, and the actor always comes from
-- auth.uid()/current_profile_id(), never a client-supplied value.
-- ----------------------------------------------------------------------------

-- 14. Member marks their own pending walk done -> 'walk_completed' logged,
--     actor = the member who did it (current_profile_id() at the time of
--     the UPDATE), not any client-supplied "completed_by_user_id" value.
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-0000000c0a02"}'; -- now-responsible member (target_id) from the swap above
update walks set status = 'done', completed_at = now(), completed_by_user_id = (select target_id from t5)
where id = (select walk_id from t5);

set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-0000000c0a01"}'; -- admin, to read audit_log
select action, actor_user_id from audit_log
where family_id = (select family_id from t5) and action = 'walk_completed' and target_id = (select walk_id from t5);
-- expect: exactly 1 row, actor_user_id = target_id (00...c0a02's profile id)

-- 15. A regular member logging a spontaneous walk (already inserted as
--     status='done', is_unplanned=true) -> 'spontaneous_walk_added' logged,
--     NOT 'walk_completed' too (no double-logging on the same insert).
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-0000000c0a03"}';
insert into walks (family_id, dog_id, date, scheduled_time, responsible_user_id, status, is_unplanned, completed_by_user_id, completed_at)
values ((select family_id from t5), (select dog_id from t5), current_date, '08:00', (select requester_id from t5), 'done', true, (select requester_id from t5), now())
returning id as spontaneous_walk_id \gset

set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-0000000c0a01"}';
select count(*) from audit_log where target_id = :'spontaneous_walk_id'::uuid and action = 'spontaneous_walk_added';
-- expect: 1
select count(*) from audit_log where target_id = :'spontaneous_walk_id'::uuid and action = 'walk_completed';
-- expect: 0 (the insert already landed as 'done'; only the pending->done UPDATE path logs walk_completed)

-- 16. Schedule rule created / edited / deleted, each logged once, with the
--     actor being whoever is actually authenticated (here: admin).
insert into schedule_rules (family_id, dog_id, time, rotation_user_ids, rotation_anchor_date)
values ((select family_id from t5), (select dog_id from t5), '07:30', array[(select admin_id from t5)], current_date)
returning id as new_rule_id \gset

update schedule_rules set time = '07:45' where id = :'new_rule_id'::uuid;
delete from schedule_rules where id = :'new_rule_id'::uuid;

select action from audit_log where target_id = :'new_rule_id'::uuid order by created_at;
-- expect: schedule_rule_created, schedule_rule_edited, schedule_rule_deleted (in that order)

-- 17. Profile claimed: already exercised implicitly by the setup (users were
--     inserted pre-claimed), so simulate an unclaimed-then-claimed profile.
insert into auth.users (id) values ('00000000-0000-0000-0000-0000000c0a05') on conflict (id) do nothing;
insert into family_auth_members (family_id, auth_user_id, role) values ((select family_id from t5), '00000000-0000-0000-0000-0000000c0a05', 'member');
insert into users (family_id, name, avatar, color) values ((select family_id from t5), 'לא נתבע', '🐾', '#555') returning id as unclaimed_id \gset

set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-0000000c0a05"}';
select claim_family_profile(:'unclaimed_id'::uuid);

set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-0000000c0a01"}';
select actor_user_id from audit_log where target_id = :'unclaimed_id'::uuid and action = 'profile_claimed';
-- expect: 1 row, actor_user_id = unclaimed_id itself

-- 18. Profile edited: admin renames a member -> 'profile_edited' logged with
--     the ADMIN as actor and the edited member as target (they can differ).
update users set name = 'שם חדש' where id = (select target_id from t5);
select actor_user_id, target_id from audit_log where target_id = (select target_id from t5) and action = 'profile_edited';
-- expect: 1 row, actor_user_id = admin_id, target_id = target_id (not equal to each other)

-- 19. A removal must NOT also produce a duplicate 'profile_edited' row for
--     the same click (only 'family_member_removed', logged by the RPC).
select admin_delete_family_member((select unclaimed_id from t5));
select count(*) from audit_log where target_id = (select unclaimed_id from t5) and action = 'profile_edited';
-- expect: 0
select count(*) from audit_log where target_id = (select unclaimed_id from t5) and action = 'family_member_removed';
-- expect: 1

-- 20. A member (non-admin) still cannot read any of the audit rows above
--     directly, even though several now exist.
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-0000000c0a02"}';
select count(*) from audit_log where family_id = (select family_id from t5);
-- expect: 0 (admin-only SELECT policy, unchanged by adding triggers)

-- ----------------------------------------------------------------------------
-- ROUND 3 GAP FIX: walks / schedule_entries WRITE AUTHORIZATION
-- (enforce_walk_write_authorization() / enforce_schedule_entry_write_authorization(),
-- section 3b). Fresh fixtures below (b1/b2, a new pending walk + entry) so
-- these checks are independent of whatever state the shared t5 walk ended up
-- in above. Same convention as the rest of this file: run with
-- ON_ERROR_ROLLBACK on (e.g. `psql -v ON_ERROR_ROLLBACK=1`) so an expected
-- error doesn't abort the whole script.
-- ----------------------------------------------------------------------------
insert into auth.users (id) values
  ('00000000-0000-0000-0000-0000000c0b01'), -- member b1 (walk owner)
  ('00000000-0000-0000-0000-0000000c0b02')  -- member b2 (a different, unrelated member)
on conflict (id) do nothing;

do $$
declare
  fam uuid := (select family_id from t5);
  dog_id uuid := (select dog_id from t5);
  b1 uuid;
  b2 uuid;
  entry_id uuid;
  walk_id uuid;
begin
  insert into users (family_id, name, avatar, color, auth_user_id)
  values (fam, 'בי-1', '🐕', '#444', '00000000-0000-0000-0000-0000000c0b01') returning id into b1;
  insert into users (family_id, name, avatar, color, auth_user_id)
  values (fam, 'בי-2', '🐩', '#555', '00000000-0000-0000-0000-0000000c0b02') returning id into b2;

  insert into family_auth_members (family_id, auth_user_id, role) values
    (fam, '00000000-0000-0000-0000-0000000c0b01', 'member'),
    (fam, '00000000-0000-0000-0000-0000000c0b02', 'member');

  insert into schedule_entries (family_id, dog_id, date, time, responsible_user_id)
  values (fam, dog_id, current_date + 3, '10:00', b1) returning id into entry_id;

  insert into walks (family_id, dog_id, date, scheduled_time, responsible_user_id, status, schedule_entry_id)
  values (fam, dog_id, current_date + 3, '10:00', b1, 'pending', entry_id) returning id into walk_id;

  create temporary table t5b as select b1, b2, entry_id, walk_id;
end $$;

-- A. Member direct UPDATE responsible_user_id -> rejected.
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-0000000c0b01"}'; -- b1, the walk's own owner
update walks set responsible_user_id = (select b2 from t5b) where id = (select walk_id from t5b);
-- expect: error 'reassigning a walk requires an approved swap request'

-- B. Member direct UPDATE scheduled_time -> rejected.
update walks set scheduled_time = '11:00' where id = (select walk_id from t5b);
-- expect: error 'changing a walk''s time requires an approved time-change request'

-- C. Member direct UPDATE schedule_entries.time -> rejected.
update schedule_entries set time = '11:00' where id = (select entry_id from t5b);
-- expect: error 'members may not directly modify a schedule entry — use create_swap_request()/create_time_change_request() via the walk instead'

-- D. Member direct UPDATE schedule_entries.responsible_user_id -> rejected
--    (same blanket guard as C — no legitimate Member path ever updates an
--    existing schedule_entries row at all, see section 3b's comment).
update schedule_entries set responsible_user_id = (select b2 from t5b) where id = (select entry_id from t5b);
-- expect: same error as C

-- E. Member direct mutation of another Member's walk -> rejected: b2 (who
--    owns nothing here) attempts to reassign b1's walk to themselves —
--    proving ownership of the TARGET walk grants no bypass; the same
--    protected-field guard as A applies regardless of whose walk it is.
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-0000000c0b02"}';
update walks set responsible_user_id = (select b2 from t5b) where id = (select walk_id from t5b);
-- expect: error 'reassigning a walk requires an approved swap request'

-- F. Member spontaneous insert attributed to self -> allowed.
insert into walks (family_id, dog_id, date, scheduled_time, responsible_user_id, status, is_unplanned, completed_by_user_id, completed_at)
values ((select family_id from t5), (select dog_id from t5), current_date, '20:00', (select b2 from t5b), 'done', true, (select b2 from t5b), now());
-- expect: success (caller is b2, attributed to b2)

-- G. Member spontaneous insert attributed to another user -> rejected.
insert into walks (family_id, dog_id, date, scheduled_time, responsible_user_id, status, is_unplanned, completed_by_user_id, completed_at)
values ((select family_id from t5), (select dog_id from t5), current_date, '20:30', (select b1 from t5b), 'done', true, (select b1 from t5b), now());
-- expect: error 'a spontaneous walk may only be attributed to yourself' (caller is still b2, attributing to b1)

-- H. Approved swap RPC still succeeds even though the approver (b2) is a
--    regular Member, not an Admin — proving the trusted-write bypass in
--    approve_swap_request() works.
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-0000000c0b01"}';
select create_swap_request((select walk_id from t5b), (select b2 from t5b)) as t5b_swap \gset
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-0000000c0b02"}';
select approve_swap_request(:'t5b_swap'::uuid);
-- expect: success
select responsible_user_id from walks where id = (select walk_id from t5b);
-- expect: b2

-- I. Approved time-change RPC still succeeds (approver is Admin here, as
--    required — but the trusted-write bypass is set explicitly regardless,
--    see approve_time_change_request()'s own comment).
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-0000000c0b02"}'; -- now responsible, after H
select create_time_change_request((select walk_id from t5b), '12:00') as t5b_time_change \gset
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-0000000c0a01"}'; -- admin approves
select approve_time_change_request(:'t5b_time_change'::uuid);
-- expect: success
select scheduled_time from walks where id = (select walk_id from t5b);
-- expect: '12:00'
select time from schedule_entries where id = (select entry_id from t5b);
-- expect: '12:00' (the RPC's own schedule_entries UPDATE also passed the trusted-write bypass)

-- J. Legitimate Member completion still succeeds — b2, now responsible,
--    marks their own walk done: an allowed field/state transition, no
--    protected field touched.
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-0000000c0b02"}';
update walks set status = 'done', completed_at = now(), completed_by_user_id = (select b2 from t5b), had_pee = true
where id = (select walk_id from t5b);
-- expect: success

-- K. Arbitrary Member DELETE walk/entry -> rejected. Admin retains DELETE
--    (the administrative capability the product intentionally keeps).
delete from walks where id = (select walk_id from t5b);
-- expect: error 'members may not delete walks directly'
delete from schedule_entries where id = (select entry_id from t5b);
-- expect: error 'members may not delete schedule entries directly'

set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-0000000c0a01"}';
delete from walks where id = (select walk_id from t5b);
-- expect: success (admin bypasses the write-authorization trigger entirely)

-- ----------------------------------------------------------------------------
-- ROUND 5: REQUEST STALENESS AFTER REASSIGNMENT (time-change requests did not
-- previously re-check that the requester was still the responsible member;
-- swap requests did not previously re-check scheduled_time). Fresh fixture:
-- two members (c1, c2) plus admin, and a walk currently owned by c1.
-- ----------------------------------------------------------------------------
do $$
declare
  fam uuid := (select family_id from t5);
  dog_id uuid := (select dog_id from t5);
  c1 uuid;
  c2 uuid;
  walk_id uuid;
begin
  insert into users (family_id, name, avatar, color, auth_user_id)
  values (fam, 'סי-1', '🐕', '#666', '00000000-0000-0000-0000-0000000c0c01') returning id into c1;
  insert into users (family_id, name, avatar, color, auth_user_id)
  values (fam, 'סי-2', '🐩', '#777', '00000000-0000-0000-0000-0000000c0c02') returning id into c2;

  insert into family_auth_members (family_id, auth_user_id, role) values
    (fam, '00000000-0000-0000-0000-0000000c0c01', 'member'),
    (fam, '00000000-0000-0000-0000-0000000c0c02', 'member');

  insert into walks (family_id, dog_id, date, scheduled_time, responsible_user_id, status)
  values (fam, dog_id, current_date + 4, '13:00', c1, 'pending') returning id into walk_id;

  create temporary table t5c as select c1, c2, walk_id;
end $$;

-- L. Time-change request -> walk reassigned to someone else (via an approved
--    swap, i.e. NOT bypassing the write-authorization trigger) -> the
--    original requester's now-stale time-change request must be rejected.
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-0000000c0c01"}'; -- c1, currently responsible
select create_time_change_request((select walk_id from t5c), '14:00') as t5c_time_request \gset
-- expect: success

select create_swap_request((select walk_id from t5c), (select c2 from t5c)) as t5c_swap \gset
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-0000000c0c02"}'; -- c2 approves the swap
select approve_swap_request(:'t5c_swap'::uuid);
-- expect: success; walk is now c2's, scheduled_time unchanged ('13:00')
select responsible_user_id, scheduled_time from walks where id = (select walk_id from t5c);
-- expect: responsible_user_id = c2, scheduled_time = '13:00'

set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-0000000c0a01"}'; -- admin approves the now-stale time request
select approve_time_change_request(:'t5c_time_request'::uuid);
-- expect: error 'the walk has changed since this request was created and can no longer be approved'
-- (Round 5 gap fix: approve_time_change_request() now re-checks
-- walk.responsible_user_id = request.requested_by_user_id, catching this.)
select scheduled_time from walks where id = (select walk_id from t5c);
-- expect: still '13:00' — the stale approval must not have applied

-- M. Time-change request -> requester is still responsible at approval time
--    -> approval succeeds normally (the fix must not reject legitimate cases).
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-0000000c0c02"}'; -- c2, now actually responsible
select create_time_change_request((select walk_id from t5c), '15:00') as t5c_time_request_2 \gset
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-0000000c0a01"}';
select approve_time_change_request(:'t5c_time_request_2'::uuid);
-- expect: success
select scheduled_time from walks where id = (select walk_id from t5c);
-- expect: '15:00'

-- N. Swap request -> the walk's scheduled_time materially changes before
--    approval (via the now-approved time-change above) -> the swap request's
--    expected_scheduled_time snapshot no longer matches, so approval must be
--    rejected rather than silently swapping based on stale expectations.
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-0000000c0c02"}'; -- c2, currently responsible
select create_swap_request((select walk_id from t5c), (select c1 from t5c)) as t5c_swap_2 \gset
-- expect: success; expected_scheduled_time snapshot = '15:00'

-- Materially change scheduled_time via the only legitimate path (an
-- approved time-change request — direct UPDATE is already rejected by the
-- Round 4 trigger, proven above), so the swap's snapshot goes stale.
select create_time_change_request((select walk_id from t5c), '17:00') as t5c_time_request_3 \gset
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-0000000c0a01"}';
select approve_time_change_request(:'t5c_time_request_3'::uuid);
-- expect: success; scheduled_time is now '17:00', which no longer matches
-- t5c_swap_2's expected_scheduled_time snapshot ('15:00')

set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-0000000c0c01"}'; -- c1 (target) approves the now-stale swap
select approve_swap_request(:'t5c_swap_2'::uuid);
-- expect: error 'the walk has changed since this request was created and can no longer be approved'
-- (Round 5 gap fix: approve_swap_request() now also re-checks
-- w.scheduled_time = req.expected_scheduled_time, catching this.)
select responsible_user_id, scheduled_time from walks where id = (select walk_id from t5c);
-- expect: still responsible_user_id = c2, scheduled_time = '17:00' — the
-- stale swap approval must not have applied

-- ----------------------------------------------------------------------------
-- ROUND 6: SPONTANEOUS/UNPLANNED WALK INSERT — a Member could previously set
-- responsible_user_id = self (satisfying the old check) while attributing
-- completed_by_user_id, status, completed_at, or schedule_entry_id to
-- whatever they liked. Fresh fixture: two members (d1, d2) plus admin.
-- ----------------------------------------------------------------------------
do $$
declare
  fam uuid := (select family_id from t5);
  dog_id uuid := (select dog_id from t5);
  d1 uuid;
  d2 uuid;
begin
  insert into users (family_id, name, avatar, color, auth_user_id)
  values (fam, 'די-1', '🐕', '#888', '00000000-0000-0000-0000-0000000c0d01') returning id into d1;
  insert into users (family_id, name, avatar, color, auth_user_id)
  values (fam, 'די-2', '🐩', '#999', '00000000-0000-0000-0000-0000000c0d02') returning id into d2;

  insert into family_auth_members (family_id, auth_user_id, role) values
    (fam, '00000000-0000-0000-0000-0000000c0d01', 'member'),
    (fam, '00000000-0000-0000-0000-0000000c0d02', 'member');

  create temporary table t5d as select d1, d2;
end $$;

-- O. Member spontaneous insert with responsible=self, completed_by=self,
--    status='done' -> allowed (the legitimate case).
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-0000000c0d01"}'; -- d1
insert into walks (family_id, dog_id, date, scheduled_time, responsible_user_id, status, is_unplanned, completed_by_user_id, completed_at)
values ((select family_id from t5), (select dog_id from t5), current_date, '08:00', (select d1 from t5d), 'done', true, (select d1 from t5d), now());
-- expect: success

-- P. Member spontaneous insert responsible=self, completed_by=OTHER -> rejected.
insert into walks (family_id, dog_id, date, scheduled_time, responsible_user_id, status, is_unplanned, completed_by_user_id, completed_at)
values ((select family_id from t5), (select dog_id from t5), current_date, '08:30', (select d1 from t5d), 'done', true, (select d2 from t5d), now());
-- expect: error 'a spontaneous walk completion may only be attributed to yourself'

-- Q. Member spontaneous insert responsible=OTHER (already covered by test G
--    above with the identical shape; repeated here for completeness against
--    the fresh fixture) -> rejected.
insert into walks (family_id, dog_id, date, scheduled_time, responsible_user_id, status, is_unplanned, completed_by_user_id, completed_at)
values ((select family_id from t5), (select dog_id from t5), current_date, '09:00', (select d2 from t5d), 'done', true, (select d2 from t5d), now());
-- expect: error 'a spontaneous walk may only be attributed to yourself'

-- R. Member spontaneous insert with status='pending' -> rejected (a
--    spontaneous walk must be recorded as already done, not left open).
insert into walks (family_id, dog_id, date, scheduled_time, responsible_user_id, status, is_unplanned, completed_by_user_id, completed_at)
values ((select family_id from t5), (select dog_id from t5), current_date, '09:30', (select d1 from t5d), 'pending', true, (select d1 from t5d), now());
-- expect: error 'a spontaneous walk must be recorded as already done'

-- S. Member spontaneous insert with schedule_entry_id set -> rejected (a
--    spontaneous walk cannot masquerade as a real scheduled occurrence).
insert into walks (family_id, dog_id, date, scheduled_time, responsible_user_id, status, is_unplanned, completed_by_user_id, completed_at, schedule_entry_id)
values ((select family_id from t5), (select dog_id from t5), current_date, '10:00', (select d1 from t5d), 'done', true, (select d1 from t5d), now(), (select entry_id from t5b));
-- expect: error 'a spontaneous walk cannot be linked to a schedule entry'

-- T. Admin spontaneous insert on behalf of another ACTIVE family member ->
--    allowed (Admin bypasses this trigger entirely, per the existing
--    is_family_admin() short-circuit — unchanged by this round's fix).
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-0000000c0a01"}'; -- admin
insert into walks (family_id, dog_id, date, scheduled_time, responsible_user_id, status, is_unplanned, completed_by_user_id, completed_at)
values ((select family_id from t5), (select dog_id from t5), current_date, '10:30', (select d2 from t5d), 'done', true, (select d1 from t5d), now());
-- expect: success (admin attributes the historical/spontaneous walk to d2,
-- completed_by d1, on their behalf — the product-intended Admin capability)

-- U. Normal completion (pending -> done): completed_by_user_id must refer to
--    an active same-family user. d1 marks a walk done attributing it to a
--    REMOVED member -> rejected.
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-0000000c0a01"}'; -- admin creates the fixture walk
insert into walks (family_id, dog_id, date, scheduled_time, responsible_user_id, status)
values ((select family_id from t5), (select dog_id from t5), current_date + 5, '08:00', (select d1 from t5d), 'pending') returning id as t5d_walk_id \gset

set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-0000000c0d01"}'; -- d1, responsible
update walks set status = 'done', completed_at = now(), completed_by_user_id = (select removed_id from t5)
where id = :'t5d_walk_id'::uuid;
-- expect: error 'a walk can only be marked completed by an active member of this family'

-- V. Same walk, completed_by_user_id = an active same-family member (d2,
--    a different member than the one responsible — intentionally allowed,
--    see the trigger's own comment on why this is not restricted to self)
--    -> succeeds.
update walks set status = 'done', completed_at = now(), completed_by_user_id = (select d2 from t5d)
where id = :'t5d_walk_id'::uuid;
-- expect: success

rollback; -- never commits; this script only inspects behavior
