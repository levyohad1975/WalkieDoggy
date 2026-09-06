-- ----------------------------------------------------------------------------
-- 0010_walk_not_done_status.sql
--
-- MEGA ROUND Section 3: adds a resolved "not done" (✕) final state for a
-- walk whose scheduled time has passed. The app already has a WalkStatus
-- value for this — 'skipped' (src/types/index.ts) — so NO new enum value or
-- column is introduced here; this migration only extends the
-- enforce_walk_write_authorization() trigger's allowed status-transition set
-- so a non-admin can perform this transition through the normal client
-- write path (markWalkSkipped() / scheduleStore.skip()), which until now was
-- blocked at the database layer for anyone but an admin.
--
-- DESIGN DECISION (flagged in the delivery report for Ohad to correct if he
-- intended otherwise): "✓ בוצע" and "✕ לא בוצע" are treated SYMMETRICALLY.
-- Any active family member may resolve an overdue walk either way, exactly
-- like the existing unrestricted pending->done transition already allows for
-- markDone(). This is a "resolution" action on an already-scheduled walk's
-- outcome, not a "direct schedule edit" (reassigning who/when) — the latter
-- remains admin-only (or request-approval-only for members), completely
-- unaffected by this migration. If admin-only resolution was actually
-- intended, tighten the `is_family_admin(fam)` check back into the branch
-- below the same way pending->done is currently NOT admin-gated either.
--
-- Preserves ALL existing behavior: this only ADDS one allowed transition
-- (pending -> skipped) to the non-admin UPDATE branch; every other
-- authorization rule in enforce_walk_write_authorization() (field pinning,
-- delete rejection, spontaneous-walk self-attribution, completed_by_user_id
-- validation) is copied through byte-for-byte from 0005. No data migration/
-- backfill is needed — no columns change shape, only the trigger logic.
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

  if tg_op = 'DELETE' then
    raise exception 'members may not delete walks directly';
  end if;

  actor := current_profile_id();

  if actor is null then
    raise exception 'no active profile found for this session';
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

  -- 0010 change: pending -> skipped ("✕ לא בוצע") is now allowed alongside
  -- the pre-existing pending -> done ("✓ בוצע") transition. Every other
  -- transition (e.g. re-opening a done/skipped walk back to pending, or
  -- skipped -> done without going through undoMarkDone's admin path) stays
  -- rejected exactly as before.
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

-- Trigger definition itself is unchanged (same function name/timing) — no
-- need to drop/recreate the trigger, only the function body it points to.
