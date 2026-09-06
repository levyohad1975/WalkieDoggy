-- ----------------------------------------------------------------------------
-- 0011_unplanned_walk_edit_delete.sql
--
-- MEGA ROUND Section 2: lets a member edit or delete an UNPLANNED
-- (spontaneous) walk THEY logged — editing the SAME row (time/date,
-- responsible member, duration, pee/poop, notes), or deleting it outright
-- (with the app's own confirmation dialog in front of it — see
-- AddUnplannedWalkModal's edit path / scheduleStore.deleteUnplannedWalk).
--
-- Scope, deliberately narrow:
--   * Only rows where `is_unplanned = true` are affected by either new
--     branch below — a real SCHEDULED walk's authorization is completely
--     unchanged (still admin-only direct edit; still no non-admin DELETE).
--   * A member may only touch an unplanned walk they are attached to,
--     either as responsible_user_id OR completed_by_user_id (mirrors the
--     self-attribution the INSERT branch already enforces when the walk was
--     first created) — never someone else's logged walk. Admins retain full
--     control via the existing `is_family_admin(fam)` short-circuit at the
--     top of the function, unaffected by anything here.
--   * `is_unplanned`, `family_id`, `dog_id`, `schedule_entry_id` may still
--     never change — an unplanned walk can't be turned into a scheduled one
--     or vice versa (Section 2's explicit "never duplicate / never convert"
--     requirement), and swap_* fields stay untouchable (they are meaningless
--     for a walk that was never on the rotation).
--
-- No column/schema changes, no backfill needed — this migration only
-- extends the enforce_walk_write_authorization() trigger function.
-- ----------------------------------------------------------------------------

create or replace function enforce_walk_write_authorization()
returns trigger as $$
declare
  actor uuid;
  fam uuid;
begin
  if coalesce(current_setting('app.trusted_write', true), '') = 'on' then
    return coalesce(new, old);
  end if;

  fam := coalesce(new.family_id, old.family_id);

  if is_family_admin(fam) then
    return coalesce(new, old);
  end if;

  actor := current_profile_id();

  if actor is null then
    raise exception 'no active profile found for this session';
  end if;

  if tg_op = 'DELETE' then
    -- 0011: a member may delete their OWN unplanned walk (entered by
    -- mistake). Everything else about direct deletion stays rejected.
    if old.is_unplanned and (old.responsible_user_id = actor or old.completed_by_user_id = actor) then
      return old;
    end if;
    raise exception 'members may not delete walks directly';
  end if;

  if tg_op = 'INSERT' then
    if new.is_unplanned then
      if new.responsible_user_id is distinct from actor then
        raise exception 'a spontaneous walk may only be attributed to yourself';
      end if;
      if new.completed_by_user_id is distinct from actor then
        raise exception 'a spontaneous walk completion may only be attributed to yourself';
      end if;
      if new.status is distinct from 'done' then
        raise exception 'a spontaneous walk must be recorded as already done';
      end if;
      if new.completed_at is null then
        raise exception 'a spontaneous walk must have a completion time';
      end if;
      if new.schedule_entry_id is not null then
        raise exception 'a spontaneous walk cannot be linked to a schedule entry';
      end if;
    end if;
    return new;
  end if;

  -- tg_op = 'UPDATE'
  if old.is_unplanned and new.is_unplanned
     and (old.responsible_user_id = actor or old.completed_by_user_id = actor) then
    -- 0011: editing your own unplanned walk. Time/date, responsible member,
    -- duration, pee/poop and notes are all editable on the SAME row — the
    -- identity-defining columns still cannot change.
    if old.family_id is distinct from new.family_id
       or old.dog_id is distinct from new.dog_id
       or old.schedule_entry_id is distinct from new.schedule_entry_id
       or old.is_unplanned is distinct from new.is_unplanned
       or old.swap_original_user_id is distinct from new.swap_original_user_id
       or old.swap_new_user_id is distinct from new.swap_new_user_id
       or old.swap_swapped_at is distinct from new.swap_swapped_at
       or old.swap_swapped_by_user_id is distinct from new.swap_swapped_by_user_id then
      raise exception 'this field cannot be changed directly';
    end if;
    -- Reassigning "responsible member" on your own logged walk must still
    -- land on an active member of the same family (mirrors the
    -- completed_by_user_id check below).
    if new.responsible_user_id is distinct from old.responsible_user_id
       and not exists (
         select 1 from users ru
         where ru.id = new.responsible_user_id
           and ru.family_id = fam
           and ru.removed_at is null
       ) then
      raise exception 'a walk can only be reassigned to an active member of this family';
    end if;
    if new.completed_by_user_id is distinct from old.completed_by_user_id
       and new.completed_by_user_id is not null
       and not exists (
         select 1 from users cu
         where cu.id = new.completed_by_user_id
           and cu.family_id = fam
           and cu.removed_at is null
       ) then
      raise exception 'a walk can only be marked completed by an active member of this family';
    end if;
    return new;
  end if;

  -- Everything below is unchanged from 0010: a Member's self-service update
  -- of a REGULAR (non-unplanned) walk's status/completion detail only.
  if old.responsible_user_id is distinct from new.responsible_user_id then
    raise exception 'reassigning a walk requires an approved swap request';
  end if;
  if old.scheduled_time is distinct from new.scheduled_time then
    raise exception 'changing a walk''s time requires an approved time-change request';
  end if;
  if old.family_id is distinct from new.family_id
     or old.dog_id is distinct from new.dog_id
     or old.date is distinct from new.date
     or old.schedule_entry_id is distinct from new.schedule_entry_id
     or old.is_unplanned is distinct from new.is_unplanned
     or old.swap_original_user_id is distinct from new.swap_original_user_id
     or old.swap_new_user_id is distinct from new.swap_new_user_id
     or old.swap_swapped_at is distinct from new.swap_swapped_at
     or old.swap_swapped_by_user_id is distinct from new.swap_swapped_by_user_id then
    raise exception 'this field cannot be changed directly';
  end if;
  if old.status is distinct from new.status
     and not (old.status = 'pending' and new.status = 'done')
     and not (old.status = 'pending' and new.status = 'skipped') then
    raise exception 'invalid status transition';
  end if;
  if old.completed_by_user_id is distinct from new.completed_by_user_id
     and new.completed_by_user_id is not null
     and not exists (
       select 1 from users cu
       where cu.id = new.completed_by_user_id
         and cu.family_id = fam
         and cu.removed_at is null
     ) then
    raise exception 'a walk can only be marked completed by an active member of this family';
  end if;

  return new;
end;
$$ language plpgsql volatile security definer set search_path = public;
