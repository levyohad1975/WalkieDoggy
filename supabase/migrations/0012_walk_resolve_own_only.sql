-- ----------------------------------------------------------------------------
-- 0012_walk_resolve_own_only.sql
--
-- AUTHORIZATION CORRECTION (supersedes 0010's "any member may resolve any
-- walk" decision — the user explicitly rejected that in favor of):
--
--   1. Admin: may mark ANY scheduled walk done/not-done (unchanged — the
--      existing is_family_admin(fam) short-circuit already covers this).
--   2. Regular member: may mark done/not-done ONLY a walk where they are
--      the CURRENTLY responsible/assigned user (old.responsible_user_id =
--      the caller). May still update execution details (pee/poop/notes) on
--      their own eligible walk. May NOT touch another member's walk this
--      way, and still may NOT directly change scheduled time/responsible
--      member (that remains request-only, unchanged from 0005).
--
-- This migration only tightens the non-admin UPDATE branch added by 0010/
-- 0011 — it does not touch INSERT, DELETE, the unplanned-walk self-service
-- branch from 0011 (already correctly self-scoped via responsible_user_id/
-- completed_by_user_id = actor), or anything admin-related.
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
  -- CURRENTLY responsible user — this is the corrected rule (0010 had
  -- wrongly allowed any member to resolve any walk).
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
    -- THE CORRECTION: previously any member could transition ANY walk
    -- pending->done or pending->skipped. Now this is only allowed when the
    -- caller IS the walk's currently-responsible user.
    if old.responsible_user_id is distinct from actor then
      raise exception 'only the responsible member (or an admin) may resolve this walk';
    end if;
    if not (old.status = 'pending' and new.status = 'done')
       and not (old.status = 'pending' and new.status = 'skipped') then
      raise exception 'invalid status transition';
    end if;
  elsif old.responsible_user_id is distinct from actor then
    -- Not a status change (e.g. editDoneDetails updating pee/poop/notes on
    -- an already-done walk) — still restricted to the responsible member,
    -- matching "may update execution details ... for their own eligible
    -- walk" from the correction. completedByUserId may legitimately differ
    -- from responsibleUserId (someone else physically walked the dog), but
    -- the person making this EDIT afterwards must still be the walk's
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
