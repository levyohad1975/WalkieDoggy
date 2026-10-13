-- ============================================================================
-- manual_tests/0006_qa_impersonation_acl.sql
--
-- Manual verification script for migrations/0006_qa_impersonation.sql:
--   - begin_impersonation()/end_impersonation()
--   - current_profile_id()/is_family_admin() resolving the impersonated
--     member during an active session, and reverting once it ends
--   - privilege escalation attempts (non-admin, cross-family, removed user)
--   - audit attribution (actor_user_id = effective member,
--     impersonated_by_admin_user_id = the real admin)
--   - restart-safety (end_impersonation() as an idempotent, safe no-op)
--
-- Same caveat as 0004/0005's manual test scripts: this sandbox has no live
-- Postgres/Supabase instance, so this is a plain script with "-- expect:"
-- comments to check by eye against a disposable/staging Supabase project
-- (after applying migrations 0001-0006), NOT wired into `npm test`.
-- ============================================================================

begin;

-- ----------------------------------------------------------------------------
-- Setup: family F1 with admin (f1a), two active members (f1m1, f1m2), a
-- removed member (f1r); a second, UNRELATED family F2 with its own admin
-- (f2a) and member (f2m1), to prove cross-family impersonation is rejected.
-- ----------------------------------------------------------------------------
insert into auth.users (id) values
  ('00000000-0000-0000-0000-0000000e0a01'), -- F1 admin
  ('00000000-0000-0000-0000-0000000e0a02'), -- F1 member 1
  ('00000000-0000-0000-0000-0000000e0a03'), -- F1 member 2
  ('00000000-0000-0000-0000-0000000e0a04'), -- F1 removed member
  ('00000000-0000-0000-0000-0000000e0b01'), -- F2 admin
  ('00000000-0000-0000-0000-0000000e0b02')  -- F2 member
on conflict (id) do nothing;

do $$
declare
  fam1 uuid;
  fam2 uuid;
  admin1 uuid;
  member1 uuid;
  member2 uuid;
  removed1 uuid;
  admin2 uuid;
  member_f2 uuid;
begin
  insert into families (name, invite_code) values ('משפחה F1', 'TEST61') returning id into fam1;
  insert into families (name, invite_code) values ('משפחה F2', 'TEST62') returning id into fam2;

  insert into users (family_id, name, avatar, color, auth_user_id)
  values (fam1, 'אדמין1', '🐶', '#000', '00000000-0000-0000-0000-0000000e0a01') returning id into admin1;
  insert into users (family_id, name, avatar, color, auth_user_id)
  values (fam1, 'עידן', '🐕', '#111', '00000000-0000-0000-0000-0000000e0a02') returning id into member1;
  insert into users (family_id, name, avatar, color, auth_user_id)
  values (fam1, 'עומר', '🐩', '#222', '00000000-0000-0000-0000-0000000e0a03') returning id into member2;
  insert into users (family_id, name, avatar, color, auth_user_id, removed_at)
  values (fam1, 'הוסר', '🦴', '#333', '00000000-0000-0000-0000-0000000e0a04', now()) returning id into removed1;

  insert into users (family_id, name, avatar, color, auth_user_id)
  values (fam2, 'אדמין2', '🐶', '#444', '00000000-0000-0000-0000-0000000e0b01') returning id into admin2;
  insert into users (family_id, name, avatar, color, auth_user_id)
  values (fam2, 'חבר-F2', '🐕', '#555', '00000000-0000-0000-0000-0000000e0b02') returning id into member_f2;

  insert into family_auth_members (family_id, auth_user_id, role) values
    (fam1, '00000000-0000-0000-0000-0000000e0a01', 'admin'),
    (fam1, '00000000-0000-0000-0000-0000000e0a02', 'member'),
    (fam1, '00000000-0000-0000-0000-0000000e0a03', 'member'),
    (fam1, '00000000-0000-0000-0000-0000000e0a04', 'member'),
    (fam2, '00000000-0000-0000-0000-0000000e0b01', 'admin'),
    (fam2, '00000000-0000-0000-0000-0000000e0b02', 'member');

  create temporary table t6 as
  select fam1 as family_id, admin1, member1, member2, removed1, fam2 as family2_id, admin2, member_f2;
end $$;

grant select on t6 to authenticated;

-- ----------------------------------------------------------------------------
-- A. Non-admin cannot begin impersonation (privilege escalation attempt).
-- ----------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-0000000e0a02"}'; -- member1, F1
do $$
begin
  perform begin_impersonation((select member2 from t6));
  raise exception 'TEST FAILED: non-admin was allowed to impersonate';
exception
  when others then
    if position('only a family admin may start real-user QA testing' in sqlerrm) = 0 then
      raise;
    end if;
end $$;
-- expect: error 'only a family admin may start real-user QA testing'

-- ----------------------------------------------------------------------------
-- B. Admin cannot impersonate a member of a DIFFERENT family
-- (cross-family impersonation attempt).
-- ----------------------------------------------------------------------------
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-0000000e0a01"}'; -- admin1, F1
do $$
begin
  perform begin_impersonation((select member_f2 from t6));
  raise exception 'TEST FAILED: cross-family impersonation was allowed';
exception
  when others then
    if position('you can only test as a member of your own family' in sqlerrm) = 0 then
      raise;
    end if;
end $$;
-- expect: error 'you can only test as a member of your own family'

-- ----------------------------------------------------------------------------
-- C. Admin cannot impersonate a REMOVED member.
-- ----------------------------------------------------------------------------
do $$
begin
  perform begin_impersonation((select removed1 from t6));
  raise exception 'TEST FAILED: removed member could be impersonated';
exception
  when others then
    if position('cannot test as a removed member' in sqlerrm) = 0 then
      raise;
    end if;
end $$;
-- expect: error 'cannot test as a removed member'

-- ----------------------------------------------------------------------------
-- D. Admin cannot "impersonate" their own already-claimed profile.
-- ----------------------------------------------------------------------------
do $$
begin
  perform begin_impersonation((select admin1 from t6));
  raise exception 'TEST FAILED: admin could impersonate self';
exception
  when others then
    if position('you are already this profile' in sqlerrm) = 0 then
      raise;
    end if;
end $$;
-- expect: error 'you are already this profile — nothing to test'

-- ----------------------------------------------------------------------------
-- E. Admin BEGINS a valid impersonation session as member1 (עידן).
-- ----------------------------------------------------------------------------
select begin_impersonation((select member1 from t6)) as session1;
-- expect: success, returns a uuid

-- F. current_profile_id() now resolves to the impersonated member, NOT the
--    real admin — this is the mechanism every RLS policy/RPC relies on.
select current_profile_id();
-- expect: equals (select member1 from t6)

-- G. is_family_admin() is suppressed to FALSE while impersonating — the
--    walks/schedule_entries write-authorization trigger's admin bypass (and
--    every other admin-only check) must NOT silently keep admin powers
--    during a "test as member" session.
select is_family_admin((select family_id from t6));
-- expect: false

-- H. is_real_family_admin() still sees the TRUE admin underneath —
--    otherwise the admin could never end their own session.
select is_real_family_admin((select family_id from t6));
-- expect: true

-- I. A concrete authorization-sensitive flow actually behaves as member1
--    would: member1 can create a swap request for a walk assigned to them
--    (proving RPC authorization/request creation is genuinely impersonated,
--    not just current_profile_id() in isolation).
do $$
declare
  dog_id uuid;
  walk_id uuid;
begin
  insert into dogs (family_id, name) values ((select family_id from t6), 'רקסי') returning id into dog_id;
  insert into walks (family_id, dog_id, date, scheduled_time, responsible_user_id, status)
  values ((select family_id from t6), dog_id, current_date + 1, '18:00', (select member1 from t6), 'pending') returning id into walk_id;
  create temporary table t6w as select walk_id;
end $$;

grant select on t6w to authenticated;

select create_swap_request((select walk_id from t6w), (select member2 from t6)) as t6_swap;
-- expect: success — member1 (the impersonated member) IS the walk's
-- responsible user, so create_swap_request()'s own "must be responsible for
-- the walk" check passes using the impersonated identity.

-- ----------------------------------------------------------------------------
-- J. Admin cannot stack a second active session without ending the first —
--    beginning a new one force-supersedes the old one (at most one active
--    session per admin device).
-- ----------------------------------------------------------------------------
select begin_impersonation((select member2 from t6)) as session2;
select current_profile_id();
-- expect: equals (select member2 from t6) — session1 was superseded

-- ----------------------------------------------------------------------------
-- K. end_impersonation() restores the real admin identity.
-- ----------------------------------------------------------------------------
select end_impersonation();
select current_profile_id();
-- expect: equals (select admin1 from t6) — back to the real admin
select is_family_admin((select family_id from t6));
-- expect: true — admin powers restored

-- ----------------------------------------------------------------------------
-- L. end_impersonation() is a SAFE NO-OP when nothing is active (restart
--    safety: authStore.restoreSession() calls this unconditionally on every
--    cold start — it must never error just because there was nothing to end).
-- ----------------------------------------------------------------------------
select end_impersonation();
-- expect: success, no error, no rows affected

-- ----------------------------------------------------------------------------
-- M. AUDIT ATTRIBUTION: after ending impersonation, the admin (now
--    restored) can review the audit log and see BOTH the effective member
--    (actor_user_id) and the real admin who was impersonating
--    (impersonated_by_admin_user_id) for every action taken during the
--    session — including the swap request created in step I, and the
--    begin/end events themselves.
-- ----------------------------------------------------------------------------
select action, actor_user_id, impersonated_by_admin_user_id, impersonated_by_admin_name
from admin_list_audit_log(50, 0)
where target_type in ('user', 'walk') or action like 'swap_request%' or action like 'impersonation%'
order by created_at asc;
-- expect: rows for 'impersonation_started' (x2, session1 then session2),
-- 'impersonation_ended' (x1), and 'swap_request_created' — the
-- swap_request_created row (and the impersonation_started row for session2)
-- has actor_user_id = member2 (or member1 for session1's start),
-- impersonated_by_admin_user_id = admin1/admin1_name for anything logged
-- while a session was active, and NULL impersonated_by_admin_user_id for
-- anything logged as the real admin outside any session.

-- ----------------------------------------------------------------------------
-- N. admin_list_audit_log() itself is admin-only via is_family_admin(),
--    which is now impersonation-aware: while impersonating, even the real
--    admin cannot browse the audit log (must end the session first) — a
--    deliberate design choice, not a gap. Prove it here directly.
-- ----------------------------------------------------------------------------
select begin_impersonation((select member1 from t6)) as session_q;
do $$
begin
  perform * from admin_list_audit_log(50, 0);
  raise exception 'TEST FAILED: impersonated admin retained audit-log access';
exception
  when others then
    if position('admin permission required' in sqlerrm) = 0 then
      raise;
    end if;
end $$;
-- expect: error 'admin permission required'

-- ----------------------------------------------------------------------------
-- O. PRESENCE flow (touch_last_seen) is also impersonation-aware — it had
--    its own inline actor-resolution copy, same as the request RPCs above
--    (see 0006's section 8 comment). While impersonating member1, a
--    presence touch must record member1's row, not the real admin's.
-- ----------------------------------------------------------------------------
select touch_last_seen();
select user_id from user_presence where user_id = (select member1 from t6);
-- expect: 1 row — member1's presence was touched, not admin1's

select end_impersonation();

-- ----------------------------------------------------------------------------
-- P. CONCURRENCY (round-2 security review): the unique partial index
--    impersonation_sessions_one_active_per_admin_idx must reject a second
--    simultaneously-"active" (ended_at is null) row for the SAME admin
--    device, however it comes to be inserted — this is the backstop of
--    record for begin_impersonation()'s pg_advisory_xact_lock. True
--    concurrent-connection races can't be simulated in this linear script,
--    but the constraint itself — the thing that makes the race harmless
--    even if the lock were somehow bypassed — can be proven directly.
-- ----------------------------------------------------------------------------
reset role; -- bypass RLS the same way the fixture setup above does

-- First active session: MUST succeed.
insert into impersonation_sessions (
  family_id,
  admin_auth_user_id,
  admin_user_id,
  target_user_id
)
values (
  (select family_id from t6),
  '00000000-0000-0000-0000-0000000e0a01',
  (select admin1 from t6),
  (select member2 from t6)
);

-- Second active session for the same admin device: MUST fail because of
-- impersonation_sessions_one_active_per_admin_idx.
do $$
begin
  insert into impersonation_sessions (
    family_id,
    admin_auth_user_id,
    admin_user_id,
    target_user_id
  )
  values (
    (select family_id from t6),
    '00000000-0000-0000-0000-0000000e0a01',
    (select admin1 from t6),
    (select member2 from t6)
  );

  raise exception 'TEST FAILED: duplicate active impersonation session was allowed';

exception
  when unique_violation then
    null; -- expected: unique constraint correctly rejected the second row
end $$;

delete from impersonation_sessions
where admin_auth_user_id = '00000000-0000-0000-0000-0000000e0a01';

-- cleanup before test Q
-- ----------------------------------------------------------------------------
-- Q. FAMILY REVALIDATION (round-2 security review): active_impersonation_
--    target() must fail closed the moment the session's own family_id no
--    longer matches this admin device's CURRENT current_family_id(), or the
--    target's own family no longer matches the session's — not just at
--    begin_impersonation() time. Simulated here by starting a valid session
--    and then directly drifting the STORED session row's family_id, which
--    is the only way a real drift (a future bug, a support intervention)
--    could actually happen without going through end_impersonation().
-- ----------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-0000000e0a01"}'; -- admin1, F1
select begin_impersonation((select member1 from t6)) as session_q;
select current_profile_id();
-- expect: equals (select member1 from t6) — session starts out valid

reset role;
update impersonation_sessions
set family_id = (select family2_id from t6)
where admin_auth_user_id = '00000000-0000-0000-0000-0000000e0a01'::uuid
  and ended_at is null;
-- simulates the session's family drifting away from this admin device's
-- actual current_family_id() (fam1) — e.g. a hypothetical future bug that
-- moved the row, not anything the current client code can trigger today.

set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-0000000e0a01"}';
select current_profile_id();
-- expect: equals (select admin1 from t6), NOT member1 — the drifted session
-- fails closed and current_profile_id() falls back to the real admin,
-- exactly as if no session were active at all.
select is_family_admin((select family_id from t6));
-- expect: true — admin powers are correctly restored too, since
-- is_family_admin() also depends on active_impersonation_target()

reset role;
delete from impersonation_sessions
where admin_auth_user_id = '00000000-0000-0000-0000-0000000e0a01'::uuid
  and ended_at is null;
-- cleanup — this session was never properly ended via end_impersonation()
-- since its drifted state made it already resolve as inactive.

rollback; -- never commits; this script only inspects behavior
