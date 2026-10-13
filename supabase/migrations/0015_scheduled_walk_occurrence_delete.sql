-- ----------------------------------------------------------------------------
-- 0015_scheduled_walk_occurrence_delete.sql
--
-- Final QA round v2, item D completion: lets a member correct/remove a
-- mis-recorded SCHEDULED (non-unplanned) walk OCCURRENCE they were
-- responsible for, once it's resolved — mirrors the exact "admin OR the
-- walk's own responsible member" pattern already established by 0012 for
-- status resolution, rather than inventing a new authorization shape.
--
-- Scope, deliberately narrow (mirrors 0011's own framing for the
-- unplanned-walk case):
--   * Only a row where `is_unplanned = false` AND `status in ('done',
--     'skipped')` is newly permitted here. A still-PENDING scheduled walk
--     remains completely undeletable by a non-admin — this is a
--     correction of a mis-recorded occurrence, never a way to cancel a
--     walk that hasn't happened yet (that's what deleteRule/removing a
--     rule's future entries already covers, unchanged).
--   * Only the walk's OWN currently-responsible member (old.responsible_
--     user_id = actor) may delete it — not whoever is currently logged
--     in, not the person who completed it if that differs from who was
--     responsible (mirrors 0012's own non-status-change edit check
--     exactly). Admin retains full access via the existing
--     is_family_admin(fam) short-circuit at the top, unaffected by
--     anything here.
--   * This is a DELETE of the WALK ROW ONLY. It does NOT touch the
--     walk's `schedule_entry_id` row (schedule_entries), the rule
--     (schedule_rules) it came from, or any other occurrence. This is
--     the reason it is safe from scheduleStore.load()'s rule-based
--     backfill: that backfill (see src/logic/rotation.ts's
--     `ruleNeedsEntryBackfill`, and its own unit tests) is gated
--     ENTIRELY on whether a rule has at least one schedule_entries row
--     dated >= today — it has no way to observe that a walk row was
--     deleted, and never inspects the walks table at all when deciding
--     whether to regenerate. Leaving the schedule_entry row in place
--     means that check still finds an entry for the rule and never
--     re-triggers generation for this (or any) date because of this
--     delete.
--
-- No column/schema changes, no backfill needed — this migration only
-- extends the enforce_walk_write_authorization() trigger function's
-- DELETE branch. Every other branch (INSERT, UPDATE, the 0011 unplanned-
-- walk DELETE/UPDATE branches, 0012's status-resolution UPDATE rule) is
-- reproduced here byte-for-byte unchanged from 0012 — only the new `if`
-- inside the DELETE branch is added.
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
    return coalesce(new, old); -- Admin: full access, unchanged.
  end if;

  actor := current_profile_id();

  if actor is null then
    raise exception 'no active profile found for this session';
  end if;

  if tg_op = 'DELETE' then
    -- Unchanged from 0011: a member may delete their OWN unplanned walk.
    if old.is_unplanned and (old.responsible_user_id = actor or old.completed_by_user_id = actor) then
      return old;
    end if;
    -- NEW (0015): a member may also delete their OWN resolved SCHEDULED
    -- walk occurrence (done/skipped) — a correction of a mis-recorded
    -- occurrence, not a way to cancel a still-pending walk or touch the
    -- recurring rule. See this file's header comment for the full
    -- reasoning on why this cannot be silently regenerated.
    if not old.is_unplanned
       and old.status in ('done', 'skipped')
       and old.responsible_user_id = actor then
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

  -- Unchanged from 0011: editing your own unplanned walk (time/date,
  -- responsible member, duration, pee/poop, notes) in place.
  if old.is_unplanned and new.is_unplanned
     and (old.responsible_user_id = actor or old.completed_by_user_id = actor) then
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

  -- A regular scheduled walk. Self-service update (status resolution +
  -- execution detail) is allowed ONLY when the caller is the walk's
  -- CURRENTLY responsible user (0012's correction, unchanged here).
  -- NOTE (0015 audit): this already permits updating completed_by_user_id
  -- on your own resolved walk (see the generic completed_by_user_id check
  -- further below, and the `elsif` branch's own comment) — no change was
  -- needed here for the "who actually did it" correction, only for
  -- DELETE above.
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

  if old.status is distinct from new.status then
    if old.responsible_user_id is distinct from actor then
      raise exception 'only the responsible member (or an admin) may resolve this walk';
    end if;
    if not (old.status = 'pending' and new.status = 'done')
       and not (old.status = 'pending' and new.status = 'skipped') then
      raise exception 'invalid status transition';
    end if;
  elsif old.responsible_user_id is distinct from actor then
    -- Not a status change (e.g. editDoneDetails updating pee/poop/notes,
    -- or the new completedByUserId correction, on an already-resolved
    -- walk) — still restricted to the responsible member, matching "may
    -- update execution details ... for their own eligible walk" from the
    -- 0012 correction. completedByUserId may legitimately differ from
    -- responsibleUserId (someone else physically walked the dog), but the
    -- person making this EDIT afterwards must still be the walk's
    -- responsible member (or admin, already short-circuited above).
    raise exception 'only the responsible member (or an admin) may edit this walk''s details';
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
