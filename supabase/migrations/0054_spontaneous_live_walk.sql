-- ----------------------------------------------------------------------------
-- 0054_spontaneous_live_walk.sql
--
-- Product decision: a spontaneous/unplanned walk must support TWO distinct
-- cases, both already named "spontaneous" in the UI:
--   A. LIVE — a member starts one right now ("התחל טיול") and finishes it
--      later ("סיים טיול"), same lifecycle a scheduled walk already gets.
--   B. RETROACTIVE — a member logs one that already happened (unchanged;
--      this is AddUnplannedWalkModal's existing "הוסף טיול שבוצע" flow).
--
-- Until now, enforce_walk_write_authorization()'s INSERT branch (see 0011,
-- reproduced unchanged through 0012/0015) only ever allowed case B for a
-- non-admin: `new.status` had to already be 'done' with a `completed_at`
-- set. There was no way for a REGULAR member (not an admin) to insert a
-- still-`pending`, not-yet-completed unplanned walk row — the one thing
-- case A needs, since the whole point of "start now" is that nothing is
-- decided about completion yet.
--
-- This migration adds exactly that one new allowed shape, as a sibling of
-- the existing retroactive one — not a replacement:
--   * `is_unplanned = true`, `status = 'pending'`, self-attributed
--     (`responsible_user_id = actor`), no `schedule_entry_id` (never
--     touches the rotation/schedule — same invariant as the retroactive
--     case).
--   * Must NOT already look started, completed, or ended at insert time:
--     `started_at`/`started_by_user_id`/`completed_at`/
--     `completed_by_user_id`/`ended_by_user_id` must all be null. This is
--     the actor/timestamp-spoofing guard — a member can create the
--     PENDING row, but the actual pending->in_progress and
--     in_progress->done transitions (and their started_at/started_by/
--     completed_at/completed_by/ended_by/duration_minutes columns) are
--     only ever written by the EXISTING start_walk()/finish_walk() RPCs
--     (migration 0048), which run as security definer with
--     app.trusted_write set and independently re-derive the actor
--     server-side from current_profile_id() — never trusting a client
--     value. This migration does not touch start_walk()/finish_walk() at
--     all; the live flow is: INSERT a bare pending row here, then call
--     the existing start_walk(id)/finish_walk(id, ...) exactly as a
--     scheduled walk already does.
--   * Cross-family writes remain blocked by the existing, unchanged RLS
--     INSERT policy ("insert walks in own family" — see schema.sql),
--     which this trigger only ever supplements: `family_id =
--     current_family_id()` and `responsible_user_id` must be an active
--     member of that same family are enforced there regardless of this
--     trigger, before this function even runs.
--   * Deleting an abandoned/mis-started live walk needs no change — the
--     existing DELETE branch already lets a member delete their own
--     is_unplanned row at ANY status (0011, unchanged).
--   * The UPDATE branch needs no change either: the client never directly
--     UPDATEs this row for the start/finish transitions (only via the
--     trusted_write-bypassing RPCs above), and the existing self-edit
--     UPDATE branch (editing time/date/responsible/pee/poop/note on your
--     own unplanned walk) already works unchanged for a pending row same
--     as any other status.
--
-- Every other branch (DELETE, the retroactive-done INSERT check, both
-- UPDATE branches) is reproduced below byte-for-byte unchanged from 0015.
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
    -- Unchanged from 0011: a member may delete their OWN unplanned walk,
    -- at any status — including a live one they started and want to
    -- abandon before/without finishing.
    if old.is_unplanned and (old.responsible_user_id = actor or old.completed_by_user_id = actor) then
      return old;
    end if;
    -- Unchanged from 0015: a member may also delete their OWN resolved
    -- SCHEDULED walk occurrence (done/skipped).
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
      if new.schedule_entry_id is not null then
        raise exception 'a spontaneous walk cannot be linked to a schedule entry';
      end if;

      -- NEW (0054): case A — a member starting a LIVE spontaneous walk.
      -- Everything the walk lifecycle records (started_at/started_by,
      -- completed_at/completed_by, ended_by, duration) must come ONLY
      -- from start_walk()/finish_walk() afterward, never from this insert.
      if new.status = 'pending' then
        if new.started_at is not null or new.started_by_user_id is not null then
          raise exception 'a new spontaneous walk cannot already be started';
        end if;
        if new.completed_at is not null or new.completed_by_user_id is not null then
          raise exception 'a new spontaneous walk cannot already be completed';
        end if;
        if new.ended_by_user_id is not null then
          raise exception 'a new spontaneous walk cannot already be ended';
        end if;
        return new;
      end if;

      -- Unchanged from 0011: case B — a member logging a walk that
      -- already happened, recorded as already done.
      if new.completed_by_user_id is distinct from actor then
        raise exception 'a spontaneous walk completion may only be attributed to yourself';
      end if;
      if new.status is distinct from 'done' then
        raise exception 'a spontaneous walk must be recorded as already done';
      end if;
      if new.completed_at is null then
        raise exception 'a spontaneous walk must have a completion time';
      end if;
    end if;
    return new;
  end if;

  -- tg_op = 'UPDATE'

  -- Unchanged from 0011: editing your own unplanned walk (time/date,
  -- responsible member, duration, pee/poop, notes) in place — same rule
  -- regardless of status, so this already covers a still-pending live
  -- walk too.
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
