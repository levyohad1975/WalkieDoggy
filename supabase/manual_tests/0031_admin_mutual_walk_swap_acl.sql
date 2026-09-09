-- ============================================================================
-- manual_tests/0031_admin_mutual_walk_swap_acl.sql
--
-- Manual verification for migration 0031_admin_mutual_walk_swap.sql.
-- Proves server-side Admin authorization, impersonation fail-closed behavior,
-- mutual atomic updates of walks + linked schedule_entries, swap metadata,
-- audit logging, and no partial mutation on rejected calls.
-- ============================================================================

begin;

insert into auth.users (id) values
  ('00000000-0000-0000-0000-0000000c3101'), -- admin
  ('00000000-0000-0000-0000-0000000c3102'), -- member 1
  ('00000000-0000-0000-0000-0000000c3103')  -- member 2
on conflict (id) do nothing;

do $$
declare
  fam uuid;
  dog_id uuid;
  admin_id uuid;
  member1 uuid;
  member2 uuid;
begin
  insert into families (name, invite_code)
  values ('משפחת 0031', 'TEST31')
  returning id into fam;

  insert into dogs (family_id, name)
  values (fam, 'טופי')
  returning id into dog_id;

  insert into users (family_id, name, avatar, color, auth_user_id)
  values (fam, 'אדמין 0031', '🐶', '#111111', '00000000-0000-0000-0000-0000000c3101')
  returning id into admin_id;

  insert into users (family_id, name, avatar, color, auth_user_id)
  values (fam, 'חבר 1', '🐕', '#222222', '00000000-0000-0000-0000-0000000c3102')
  returning id into member1;

  insert into users (family_id, name, avatar, color, auth_user_id)
  values (fam, 'חבר 2', '🐩', '#333333', '00000000-0000-0000-0000-0000000c3103')
  returning id into member2;

  insert into family_auth_members (family_id, auth_user_id, role) values
    (fam, '00000000-0000-0000-0000-0000000c3101', 'admin'),
    (fam, '00000000-0000-0000-0000-0000000c3102', 'member'),
    (fam, '00000000-0000-0000-0000-0000000c3103', 'member');

  insert into profile_auth_sessions (auth_user_id, family_id, user_id) values
    ('00000000-0000-0000-0000-0000000c3101', fam, admin_id),
    ('00000000-0000-0000-0000-0000000c3102', fam, member1),
    ('00000000-0000-0000-0000-0000000c3103', fam, member2);

  create temporary table t31 as
  select fam as family_id, dog_id, admin_id, member1, member2, null::uuid as entry_a, null::uuid as entry_b, null::uuid as walk_a, null::uuid as walk_b;
end $$;

grant select, update on t31 to authenticated;

set local role authenticated;
set local request.jwt.claims =
  '{"sub": "00000000-0000-0000-0000-0000000c3101"}';

do $$
declare
  v_entry_a uuid;
  v_entry_b uuid;
  v_walk_a uuid;
  v_walk_b uuid;
begin
  insert into schedule_entries (family_id, dog_id, date, time, responsible_user_id)
  values ((select family_id from t31), (select dog_id from t31), current_date + 1, '10:00', (select member1 from t31))
  returning id into v_entry_a;

  insert into schedule_entries (family_id, dog_id, date, time, responsible_user_id)
  values ((select family_id from t31), (select dog_id from t31), current_date + 1, '18:00', (select member2 from t31))
  returning id into v_entry_b;

  insert into walks (family_id, dog_id, date, scheduled_time, responsible_user_id, status, schedule_entry_id)
  values ((select family_id from t31), (select dog_id from t31), current_date + 1, '10:00', (select member1 from t31), 'pending', v_entry_a)
  returning id into v_walk_a;

  insert into walks (family_id, dog_id, date, scheduled_time, responsible_user_id, status, schedule_entry_id)
  values ((select family_id from t31), (select dog_id from t31), current_date + 1, '18:00', (select member2 from t31), 'pending', v_entry_b)
  returning id into v_walk_b;

  update t31
  set entry_a = v_entry_a,
      entry_b = v_entry_b,
      walk_a = v_walk_a,
      walk_b = v_walk_b;
end $$;


-- ----------------------------------------------------------------------------
-- A. Family Admin performs direct mutual swap successfully.
-- ----------------------------------------------------------------------------
set local request.jwt.claims =
  '{"sub": "00000000-0000-0000-0000-0000000c3101"}';

select admin_swap_walks(
  (select walk_a from t31),
  (select walk_b from t31)
);

do $$
begin
  if (select responsible_user_id from walks where id = (select walk_a from t31))
       is distinct from (select member2 from t31) then
    raise exception 'TEST FAILED: walk A owner was not swapped';
  end if;

  if (select responsible_user_id from walks where id = (select walk_b from t31))
       is distinct from (select member1 from t31) then
    raise exception 'TEST FAILED: walk B owner was not swapped';
  end if;

  if (select responsible_user_id from schedule_entries where id = (select entry_a from t31))
       is distinct from (select member2 from t31) then
    raise exception 'TEST FAILED: schedule entry A owner was not swapped';
  end if;

  if (select responsible_user_id from schedule_entries where id = (select entry_b from t31))
       is distinct from (select member1 from t31) then
    raise exception 'TEST FAILED: schedule entry B owner was not swapped';
  end if;

  if not exists (
    select 1
    from walks
    where id = (select walk_a from t31)
      and swap_original_user_id = (select member1 from t31)
      and swap_new_user_id = (select member2 from t31)
      and swap_swapped_by_user_id = (select admin_id from t31)
      and swap_swapped_at is not null
  ) then
    raise exception 'TEST FAILED: walk A swap metadata incorrect';
  end if;

  if not exists (
    select 1
    from walks
    where id = (select walk_b from t31)
      and swap_original_user_id = (select member2 from t31)
      and swap_new_user_id = (select member1 from t31)
      and swap_swapped_by_user_id = (select admin_id from t31)
      and swap_swapped_at is not null
  ) then
    raise exception 'TEST FAILED: walk B swap metadata incorrect';
  end if;

  if not exists (
    select 1
    from audit_log
    where family_id = (select family_id from t31)
      and action = 'walk_admin_swapped'
      and target_id = (select walk_a from t31)
      and actor_user_id = (select admin_id from t31)
  ) then
    raise exception 'TEST FAILED: walk_admin_swapped audit event missing';
  end if;
end $$;

-- Restore original owners through the SAME RPC for later denial tests.
select admin_swap_walks(
  (select walk_a from t31),
  (select walk_b from t31)
);

-- ----------------------------------------------------------------------------
-- B. Regular Member cannot call the direct Admin swap.
-- Must fail BEFORE either side changes.
-- ----------------------------------------------------------------------------
set local request.jwt.claims =
  '{"sub": "00000000-0000-0000-0000-0000000c3102"}';

do $$
begin
  perform admin_swap_walks(
    (select walk_a from t31),
    (select walk_b from t31)
  );

  raise exception 'TEST FAILED: regular member was allowed to use admin swap';
exception
  when others then
    if position('admin permission required' in sqlerrm) = 0 then
      raise;
    end if;
end $$;

do $$
begin
  if (select responsible_user_id from walks where id = (select walk_a from t31))
       is distinct from (select member1 from t31)
     or
     (select responsible_user_id from walks where id = (select walk_b from t31))
       is distinct from (select member2 from t31)
     or
     (select responsible_user_id from schedule_entries where id = (select entry_a from t31))
       is distinct from (select member1 from t31)
     or
     (select responsible_user_id from schedule_entries where id = (select entry_b from t31))
       is distinct from (select member2 from t31) then
    raise exception 'TEST FAILED: member denial left a partial swap';
  end if;
end $$;

-- ----------------------------------------------------------------------------
-- C. Real Admin while impersonating a Member must lose Admin power.
-- ----------------------------------------------------------------------------
set local request.jwt.claims =
  '{"sub": "00000000-0000-0000-0000-0000000c3101"}';

select begin_impersonation((select member1 from t31));

do $$
begin
  perform admin_swap_walks(
    (select walk_a from t31),
    (select walk_b from t31)
  );

  raise exception 'TEST FAILED: impersonated admin retained direct swap power';
exception
  when others then
    if position('admin permission required' in sqlerrm) = 0 then
      raise;
    end if;
end $$;

do $$
begin
  if (select responsible_user_id from walks where id = (select walk_a from t31))
       is distinct from (select member1 from t31)
     or
     (select responsible_user_id from walks where id = (select walk_b from t31))
       is distinct from (select member2 from t31) then
    raise exception 'TEST FAILED: impersonation denial changed a walk';
  end if;
end $$;

select end_impersonation();

-- ----------------------------------------------------------------------------
-- D. Same walk twice is rejected and leaves state unchanged.
-- ----------------------------------------------------------------------------
do $$
begin
  perform admin_swap_walks(
    (select walk_a from t31),
    (select walk_a from t31)
  );

  raise exception 'TEST FAILED: same walk was accepted twice';
exception
  when others then
    if position('choose a different walk' in sqlerrm) = 0 then
      raise;
    end if;
end $$;

-- ----------------------------------------------------------------------------
-- E. If either walk is no longer pending, the whole call is rejected
-- before any mutation — no half-swap.
-- ----------------------------------------------------------------------------
update walks
set status = 'done',
    completed_at = now(),
    completed_by_user_id = (select member2 from t31)
where id = (select walk_b from t31);

do $$
begin
  perform admin_swap_walks(
    (select walk_a from t31),
    (select walk_b from t31)
  );

  raise exception 'TEST FAILED: non-pending pair was accepted';
exception
  when others then
    if position('both walks must still be pending' in sqlerrm) = 0 then
      raise;
    end if;
end $$;

do $$
begin
  if (select responsible_user_id from walks where id = (select walk_a from t31))
       is distinct from (select member1 from t31)
     or
     (select responsible_user_id from walks where id = (select walk_b from t31))
       is distinct from (select member2 from t31)
     or
     (select responsible_user_id from schedule_entries where id = (select entry_a from t31))
       is distinct from (select member1 from t31)
     or
     (select responsible_user_id from schedule_entries where id = (select entry_b from t31))
       is distinct from (select member2 from t31) then
    raise exception 'TEST FAILED: rejected non-pending swap left partial mutation';
  end if;
end $$;

rollback;












