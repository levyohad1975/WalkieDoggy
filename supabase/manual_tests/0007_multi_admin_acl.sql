-- ============================================================================
-- manual_tests/0007_multi_admin_acl.sql
--
-- Manual verification script for migrations/0007_multi_admin_roles.sql:
--   - set_member_role(): promotion, demotion, non-admin denied, last-admin
--     demotion protected, audit_log entries written
--   - admin_delete_family_member(): last-admin removal now protected
--
-- Same caveat as 0004/0005/0006's manual test scripts: this sandbox has no
-- live Postgres/Supabase instance, so this is a plain script with
-- "-- expect:" comments to check by eye against a disposable/staging
-- Supabase project (after applying migrations 0001-0007), NOT wired into
-- `npm test`.
-- ============================================================================

begin;

-- ----------------------------------------------------------------------------
-- Setup: family F1 with one admin (f1a) and two members (f1m1, f1m2).
-- ----------------------------------------------------------------------------
insert into auth.users (id) values
  ('00000000-0000-0000-0000-0000000f0a01'), -- F1 admin
  ('00000000-0000-0000-0000-0000000f0a02'), -- F1 member 1 (to be promoted)
  ('00000000-0000-0000-0000-0000000f0a03')  -- F1 member 2
on conflict (id) do nothing;

do $$
declare
  fam1 uuid;
  admin1 uuid;
  member1 uuid;
  member2 uuid;
begin
  insert into families (name, invite_code) values ('משפחה F1', 'TEST71') returning id into fam1;

  insert into users (family_id, name, avatar, color, auth_user_id)
  values (fam1, 'אדמין1', '🐶', '#000', '00000000-0000-0000-0000-0000000f0a01') returning id into admin1;
  insert into users (family_id, name, avatar, color, auth_user_id)
  values (fam1, 'חבר1', '🐶', '#000', '00000000-0000-0000-0000-0000000f0a02') returning id into member1;
  insert into users (family_id, name, avatar, color, auth_user_id)
  values (fam1, 'חבר2', '🐶', '#000', '00000000-0000-0000-0000-0000000f0a03') returning id into member2;

  insert into family_auth_members (auth_user_id, family_id, role) values
    ('00000000-0000-0000-0000-0000000f0a01', fam1, 'admin'),
    ('00000000-0000-0000-0000-0000000f0a02', fam1, 'member'),
    ('00000000-0000-0000-0000-0000000f0a03', fam1, 'member');
end $$;

-- ----------------------------------------------------------------------------
-- Test 1: non-admin cannot call set_member_role.
-- ----------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-0000000f0a02'; -- member1, not admin

do $$
declare
  target uuid;
begin
  select id into target from users where auth_user_id = '00000000-0000-0000-0000-0000000f0a03';
  begin
    perform set_member_role(target, 'admin');
    raise exception 'TEST FAILED: non-admin was allowed to change a role';
  exception when others then
    if sqlerrm like '%admin permission required%' then
      raise notice 'TEST 1 PASSED: non-admin correctly denied (%).', sqlerrm;
    else
      raise exception 'TEST 1 FAILED: unexpected error: %', sqlerrm;
    end if;
  end;
end $$;

-- ----------------------------------------------------------------------------
-- Test 2: admin promotes member1 to admin — succeeds, audit_log entry written.
-- ----------------------------------------------------------------------------
set local request.jwt.claim.sub = '00000000-0000-0000-0000-0000000f0a01'; -- admin1

do $$
declare
  target uuid;
  new_role text;
  audit_count int;
begin
  select id into target from users where auth_user_id = '00000000-0000-0000-0000-0000000f0a02';
  perform set_member_role(target, 'admin');

  select role into new_role from family_auth_members where auth_user_id = '00000000-0000-0000-0000-0000000f0a02';
  if new_role <> 'admin' then
    raise exception 'TEST 2 FAILED: role was not updated (got %)', new_role;
  end if;

  select count(*) into audit_count from audit_log
  where target_id = target and action = 'member_promoted_to_admin';
  if audit_count <> 1 then
    raise exception 'TEST 2 FAILED: expected exactly one audit_log entry, got %', audit_count;
  end if;

  raise notice 'TEST 2 PASSED: promotion succeeded and was audited.';
end $$;

-- ----------------------------------------------------------------------------
-- Test 3: last-admin protection — family now has 2 admins (admin1, member1).
-- Demoting admin1 should succeed (member1 remains admin); demoting BOTH
-- (in sequence, ending with zero) must fail on the second one.
-- ----------------------------------------------------------------------------
do $$
declare
  admin1_id uuid;
  member1_id uuid;
begin
  select id into admin1_id from users where auth_user_id = '00000000-0000-0000-0000-0000000f0a01';
  select id into member1_id from users where auth_user_id = '00000000-0000-0000-0000-0000000f0a02';

  -- Demote admin1 -> member1 is still admin, should succeed.
  perform set_member_role(admin1_id, 'member');
  raise notice 'TEST 3a PASSED: demoting admin1 succeeded while member1 (now admin) remains.';

  -- Now try to demote member1 too (would leave zero admins) — must fail.
  -- (Acting as admin1 again would fail the admin check since admin1 is now
  -- a member — so this call is made as member1, who IS still an admin.)
end $$;

set local request.jwt.claim.sub = '00000000-0000-0000-0000-0000000f0a02'; -- member1, now the only admin

do $$
declare
  member1_id uuid;
begin
  select id into member1_id from users where auth_user_id = '00000000-0000-0000-0000-0000000f0a02';
  begin
    perform set_member_role(member1_id, 'member'); -- self-demotion, would leave zero admins
    raise exception 'TEST 3b FAILED: last-admin self-demotion was allowed';
  exception when others then
    if sqlerrm like '%cannot demote the last admin%' then
      raise notice 'TEST 3b PASSED: last-admin demotion correctly rejected (%).', sqlerrm;
    else
      raise exception 'TEST 3b FAILED: unexpected error: %', sqlerrm;
    end if;
  end;
end $$;

-- ----------------------------------------------------------------------------
-- Test 4: admin_delete_family_member() rejects removing the last admin.
-- ----------------------------------------------------------------------------
do $$
declare
  member1_id uuid;
begin
  select id into member1_id from users where auth_user_id = '00000000-0000-0000-0000-0000000f0a02';
  begin
    perform admin_delete_family_member(member1_id);
    raise exception 'TEST 4 FAILED: removing the last admin was allowed';
  exception when others then
    if sqlerrm like '%cannot remove the last admin%' then
      raise notice 'TEST 4 PASSED: last-admin removal correctly rejected (%).', sqlerrm;
    else
      raise exception 'TEST 4 FAILED: unexpected error: %', sqlerrm;
    end if;
  end;
end $$;

rollback; -- never actually commit test data
