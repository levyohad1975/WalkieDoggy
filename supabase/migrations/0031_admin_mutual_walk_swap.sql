-- 0031_admin_mutual_walk_swap.sql
--
-- Atomic direct mutual walk swap for Family Admin.
-- This is an administrative action, NOT a member swap-request workflow.

create or replace function admin_swap_walks(p_walk_a_id uuid, p_walk_b_id uuid)
returns void as $$
declare
  me uuid;
  my_family uuid;
  walk_a record;
  walk_b record;
  user_a uuid;
  user_b uuid;
begin
  me := current_profile_id();
  if me is null then
    raise exception 'no active profile claimed on this family';
  end if;

  my_family := current_family_id();

  if p_walk_a_id = p_walk_b_id then
    raise exception 'choose a different walk';
  end if;

  -- Lock both rows in deterministic order so concurrent inverse swaps
  -- cannot deadlock or observe a half-updated pair.
  perform 1
  from walks
  where id in (p_walk_a_id, p_walk_b_id)
  order by id
  for update;

  select * into walk_a from walks where id = p_walk_a_id;
  select * into walk_b from walks where id = p_walk_b_id;

  if walk_a.id is null
     or walk_a.family_id is distinct from my_family then
    raise exception 'walk not found in this family';
  end if;

  if walk_b.id is null
     or walk_b.family_id is distinct from my_family then
    raise exception 'target walk not found in this family';
  end if;

  -- Server-side authorization. is_family_admin() is also fail-closed
  -- during impersonation, so impersonating a member cannot use this RPC.
  if not is_family_admin(my_family) then
    raise exception 'admin permission required';
  end if;

  if walk_a.status <> 'pending' or walk_b.status <> 'pending' then
    raise exception 'both walks must still be pending';
  end if;

  if walk_a.dog_id is distinct from walk_b.dog_id then
    raise exception 'both walks must belong to the same dog';
  end if;

  user_a := walk_a.responsible_user_id;
  user_b := walk_b.responsible_user_id;

  if user_a is null or user_b is null then
    raise exception 'both walks must have a responsible member';
  end if;

  if not exists (
    select 1 from users
    where id = user_a
      and family_id = my_family
      and removed_at is null
  ) or not exists (
    select 1 from users
    where id = user_b
      and family_id = my_family
      and removed_at is null
  ) then
    raise exception 'one of the swap members is no longer active in this family';
  end if;

  -- A direct admin swap must not silently invalidate an already-pending
  -- member swap workflow involving either occurrence.
  if exists (
    select 1
    from walk_swap_requests r
    where r.status = 'pending'
      and (
        r.walk_id in (p_walk_a_id, p_walk_b_id)
        or r.target_walk_id in (p_walk_a_id, p_walk_b_id)
      )
  ) then
    raise exception 'a pending swap request already exists for one of these walks';
  end if;

  perform set_config('app.trusted_write', 'on', true);

  if walk_a.schedule_entry_id is not null then
    update schedule_entries
    set responsible_user_id = user_b
    where id = walk_a.schedule_entry_id
      and family_id = my_family;
  end if;

  if walk_b.schedule_entry_id is not null then
    update schedule_entries
    set responsible_user_id = user_a
    where id = walk_b.schedule_entry_id
      and family_id = my_family;
  end if;

  update walks
  set responsible_user_id = user_b,
      swap_original_user_id =
        coalesce(walk_a.swap_original_user_id, user_a),
      swap_new_user_id = user_b,
      swap_swapped_at = now(),
      swap_swapped_by_user_id = me,
      updated_at = now()
  where id = walk_a.id;

  update walks
  set responsible_user_id = user_a,
      swap_original_user_id =
        coalesce(walk_b.swap_original_user_id, user_b),
      swap_new_user_id = user_a,
      swap_swapped_at = now(),
      swap_swapped_by_user_id = me,
      updated_at = now()
  where id = walk_b.id;

  perform set_config('app.trusted_write', 'off', true);

  perform log_audit_event(
    my_family,
    me,
    'walk_admin_swapped',
    'walk',
    walk_a.id,
    jsonb_build_object(
      'source_walk_id', walk_a.id,
      'target_walk_id', walk_b.id,
      'source_old_user_id', user_a,
      'source_new_user_id', user_b,
      'target_old_user_id', user_b,
      'target_new_user_id', user_a
    )
  );
end;
$$ language plpgsql volatile security definer set search_path = public;

revoke all on function admin_swap_walks(uuid, uuid) from public;
grant execute on function admin_swap_walks(uuid, uuid) to authenticated;

comment on function admin_swap_walks(uuid, uuid) is
  'Family Admin direct mutual swap of two pending walks. Server-authorized, atomic, updates linked schedule entries and both walk assignments, preserves original swap attribution, rejects conflicting pending swap requests, and records walk_admin_swapped audit.';

