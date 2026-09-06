-- ============================================================================
-- 0004_admin_permissions_and_member_deletion.sql
--
-- Builds on 0003_family_admin_roles.sql (role column, current_family_role(),
-- is_family_admin()). Two things were still missing:
--
--   1. schedule_rules could be inserted/updated/deleted by ANY family
--      member ("modify rules in own family" from schema.sql / 0001) — that
--      was fine before roles existed, but permanent schedule configuration
--      (add/edit/delete a fixed walk time, reorder, change rotation
--      assignments) must now be admin-only. This does NOT touch
--      schedule_entries or walks — ordinary daily activity (marking a walk
--      done, rescheduling a single occurrence, swapping, and especially
--      logging a spontaneous/unplanned walk) must stay available to every
--      family member regardless of role, so those tables' existing
--      "any family member" policies are left exactly as they are.
--
--   2. 0003 disabled direct client DELETE on `users` (deleting a member also
--      has to reassign their rotation turns in schedule_rules/
--      schedule_entries/pending walks, which can't be expressed as a simple
--      RLS policy) but never provided a replacement.
--
-- REVISION NOTE (this version replaces an earlier draft of this same file):
-- the first draft of admin_delete_family_member() actually issued
-- `delete from users`. That is wrong and was caught before this migration
-- was applied to any database — see the "why soft-delete" note below for
-- the reasoning. Because this file has not shipped/been run against any
-- project yet, it is fixed in place here rather than layered under 0005;
-- if you already ran the earlier draft against a real database, do NOT
-- re-run this file as-is — see the bottom of this comment block for the
-- one-line fix-up instead.
--
-- ----------------------------------------------------------------------------
-- Why soft-delete, not hard-delete
-- ----------------------------------------------------------------------------
-- schema.sql declares both of these as `on delete restrict`:
--   schedule_entries.responsible_user_id references users(id) on delete restrict
--   walks.responsible_user_id            references users(id) on delete restrict
-- ...and that RESTRICT is correct and must stay — it's exactly what stops
-- anyone from ever hard-deleting a `users` row out from under history.
-- planUserRemoval() (src/logic/familyManagement.ts) deliberately only
-- reassigns FUTURE pending schedule_entries/walks; past entries and
-- completed walks are left pointing at the departing member on purpose —
-- requirement: "preserve historical walk information", "a deleted member's
-- historical walks should still remain meaningful in History". A member
-- with ANY history (a past schedule_entry, or a single completed walk)
-- would make a real `delete from users` fail with a foreign_key_violation,
-- and one with a FUTURE walk would look like it "succeeded" today only to
-- start failing the day that walk's row is later touched — an inconsistent,
-- data-shape-dependent bug.
--
-- The fix: never delete the `users` row. "Deleting" a family member sets
-- `removed_at`, and every reference to that user (schedule_entries.
-- responsible_user_id, walks.responsible_user_id and
-- walks.completed_by_user_id, swap_* columns) stays exactly as it was —
-- there is nothing left to violate a FK over, and History can still join
-- to `users` and show the real name (see src/components/WalkRow.tsx, which
-- now appends "(הוסר)" when rendering a removed member). Active pickers —
-- FamilyScreen's roster, the rotation picker in RuleFormModal, the "hand
-- this walk to" picker in EditWalkModal, Settings' reminders list — filter
-- `removed_at is null` client-side so a removed member can no longer be
-- assigned new work, without erasing anything they already did.
-- ----------------------------------------------------------------------------

-- ----------------------------------------------------------------------------
-- 1. schedule_rules: administrative configuration is admin-only.
--    (schedule_entries and walks are deliberately NOT touched here.)
-- ----------------------------------------------------------------------------

drop policy if exists "modify rules in own family" on schedule_rules;

-- SELECT stays open to every family member — everyone needs to see the
-- fixed schedule (ScheduleScreen's rule list is visible to Members too).
drop policy if exists "select rules in own family" on schedule_rules;
create policy "select rules in own family" on schedule_rules
  for select using (family_id = current_family_id());

create policy "insert rules (family admins only)" on schedule_rules
  for insert with check (
    family_id = current_family_id()
    and is_family_admin(family_id)
  );

create policy "update rules (family admins only)" on schedule_rules
  for update using (
    family_id = current_family_id()
    and is_family_admin(family_id)
  ) with check (
    family_id = current_family_id()
    and is_family_admin(family_id)
  );

create policy "delete rules (family admins only)" on schedule_rules
  for delete using (
    family_id = current_family_id()
    and is_family_admin(family_id)
  );

-- ----------------------------------------------------------------------------
-- 2. `users.removed_at` — soft-delete marker. See the comment block above
--    for why this exists instead of an actual DELETE.
-- ----------------------------------------------------------------------------

alter table users add column if not exists removed_at timestamptz;

-- ----------------------------------------------------------------------------
-- 3. Admin-only, atomic family-member deletion (soft-delete).
--
-- Takes the SAME reassignment the client already computes via
-- planUserRemoval() (rotation_user_ids with the deleted member removed/
-- replaced, future pending entries/walks reassigned — past entries and
-- completed walks are never included, by design) and applies it plus the
-- removed_at marker as one transaction. Every row touched is re-scoped to
-- the caller's own family server-side — the family_id/ids passed in are
-- never trusted on their own.
-- ----------------------------------------------------------------------------

create or replace function admin_delete_family_member(
  target_user_id uuid,
  rule_updates jsonb default '[]'::jsonb,
  entry_updates jsonb default '[]'::jsonb,
  walk_updates jsonb default '[]'::jsonb
)
returns void as $$
declare
  target_family uuid;
  item jsonb;
  elem text;
begin
  if auth.uid() is null then
    raise exception 'must be authenticated';
  end if;

  select family_id into target_family from users where id = target_user_id;
  if target_family is null then
    raise exception 'user not found';
  end if;

  if target_family is distinct from current_family_id() then
    raise exception 'not a member of this user''s family';
  end if;

  if not is_family_admin(target_family) then
    raise exception 'admin permission required';
  end if;

  -- Validate EVERY replacement user id in the client-supplied JSON before
  -- applying anything. This RPC is SECURITY DEFINER, so it runs with more
  -- privilege than RLS would otherwise grant the caller — the *_updates
  -- payloads must not be trusted just because the caller is confirmed to be
  -- an admin of this family. Each replacement responsible_user_id /
  -- rotation_user_ids entry must reference a user that: exists, belongs to
  -- target_family (never a different family), is active (removed_at is
  -- null — never a previously-removed member), and is not target_user_id
  -- itself (the member being removed can't be their own replacement).
  -- Any violation aborts the whole call (raise exception rolls back the
  -- implicit transaction) rather than partially applying a bad payload.
  for item in select * from jsonb_array_elements(rule_updates) loop
    for elem in select * from jsonb_array_elements_text(item->'rotation_user_ids') loop
      if not exists (
        select 1 from users u
        where u.id = elem::uuid
          and u.family_id = target_family
          and u.removed_at is null
          and u.id <> target_user_id
      ) then
        raise exception 'invalid rotation_user_ids replacement in rule_updates';
      end if;
    end loop;
  end loop;

  for item in select * from jsonb_array_elements(entry_updates) loop
    if not exists (
      select 1 from users u
      where u.id = (item->>'responsible_user_id')::uuid
        and u.family_id = target_family
        and u.removed_at is null
        and u.id <> target_user_id
    ) then
      raise exception 'invalid responsible_user_id replacement in entry_updates';
    end if;
  end loop;

  for item in select * from jsonb_array_elements(walk_updates) loop
    if not exists (
      select 1 from users u
      where u.id = (item->>'responsible_user_id')::uuid
        and u.family_id = target_family
        and u.removed_at is null
        and u.id <> target_user_id
    ) then
      raise exception 'invalid responsible_user_id replacement in walk_updates';
    end if;
  end loop;

  for item in select * from jsonb_array_elements(rule_updates) loop
    update schedule_rules
    set rotation_user_ids = (
      select array_agg(elem::text::uuid)
      from jsonb_array_elements_text(item->'rotation_user_ids') as elem
    )
    where id = (item->>'id')::uuid
      and family_id = target_family;
  end loop;

  for item in select * from jsonb_array_elements(entry_updates) loop
    update schedule_entries
    set responsible_user_id = (item->>'responsible_user_id')::uuid
    where id = (item->>'id')::uuid
      and family_id = target_family;
  end loop;

  for item in select * from jsonb_array_elements(walk_updates) loop
    update walks
    set responsible_user_id = (item->>'responsible_user_id')::uuid,
        updated_at = now()
    where id = (item->>'id')::uuid
      and family_id = target_family;
  end loop;

  -- Soft-delete: never a real DELETE (see the comment block above) — the
  -- FK RESTRICT on schedule_entries/walks.*_user_id stays intact and
  -- unviolated, and every historical row keeps its real responsible/
  -- completed-by user forever.
  update users
  set removed_at = now()
  where id = target_user_id
    and family_id = target_family;
end;
$$ language plpgsql volatile security definer;

-- ----------------------------------------------------------------------------
-- 4. Profile-edit permissions: Self + Admin.
--
-- The users UPDATE policy from schema.sql/0001 was family-wide — ANY
-- authenticated family member could update ANY user row in their family,
-- including changing another member's name/photo, or (once removed_at
-- existed) clearing it to "undelete" someone without admin permission.
-- Replaced with: a Member may edit only their own active profile; an Admin
-- may edit any active profile; removed_at can never be set OR cleared
-- through this policy by anyone (soft-delete/undelete stays exclusively
-- admin_delete_family_member()'s job, which is SECURITY DEFINER and
-- bypasses this policy entirely).
-- ----------------------------------------------------------------------------

drop policy if exists "update users in own family" on users;

create policy "update users (self or admin, active profiles only)" on users
  for update using (
    family_id = current_family_id()
    and removed_at is null
    and (auth_user_id = auth.uid() or is_family_admin(family_id))
  )
  with check (
    family_id = current_family_id()
    and removed_at is null
    and (auth_user_id = auth.uid() or is_family_admin(family_id))
  );

-- ----------------------------------------------------------------------------
-- 5. claim_family_profile() — replaces the old plain
--    `update users set auth_user_id = ...` the client used to run directly.
--
-- Narrowing the UPDATE policy above to self-or-admin breaks that old direct
-- update for the ONE case where it's legitimate and necessary: a device
-- claiming a family member profile for the very first time has no "self"
-- row yet (auth_user_id doesn't match auth.uid() until this call sets it),
-- and it may not be an admin either — a Member's device claiming a Member's
-- profile must still work. That can't satisfy the policy above by
-- definition, so claiming gets its own dedicated SECURITY DEFINER RPC
-- instead of reopening broad UPDATE access. It only ever sets one column
-- (auth_user_id), only on an active user, only within the caller's own
-- family — it cannot be used to edit name/color/photo or touch removed_at.
--
-- REVISION NOTE (this version replaces an earlier draft of this same
-- section): the first draft let ANY authenticated family member claim ANY
-- active profile in the family, unconditionally overwriting its
-- auth_user_id — including a profile that was already claimed by a
-- DIFFERENT device/auth_user_id. That is a profile-takeover hole: a Member
-- could call this RPC against another Member's already-claimed profile,
-- become "self" for it, and thereby bypass the entire Self + Admin
-- profile-edit model this migration exists to enforce. Fixed by adding an
-- explicit ownership check: claiming now only succeeds when the target
-- profile is unclaimed (auth_user_id is null) or already claimed by the
-- SAME auth_user_id calling (idempotent re-claim, e.g. re-running this on
-- every sign-in) — claiming a profile already claimed by someone else is
-- rejected. Moving a profile to a new phone on purpose is intentionally
-- left as a separate, not-yet-implemented admin-only reset/transfer flow
-- rather than allowed insecurely here for convenience.
--
-- REVISION NOTE 2 (fixes a race left by revision 1's ownership check): the
-- ownership check above reads target_auth_user_id via a SELECT, then runs a
-- separately-guarded UPDATE — a classic TOCTOU gap. Two devices can both
-- read auth_user_id as null, both pass the "not claimed by someone else"
-- check, and then both run the UPDATE. The UPDATE's own WHERE guard
-- (auth_user_id is null or auth_user_id = auth.uid()) still stops the wrong
-- row from being written — only the first UPDATE to actually commit can
-- match — but a 0-row UPDATE is not an error in Postgres, so without
-- checking how many rows it touched, the SECOND (losing) caller's call
-- would return normally: success reported for a claim that did NOT
-- actually happen. authStore.signIn() would then persist currentUserId for
-- a device that never actually claimed the profile. Fixed by checking GET
-- DIAGNOSTICS ROW_COUNT right after the UPDATE and raising when it's 0 —
-- the SELECT-based check above is now only a fast, friendly early
-- rejection; the atomic UPDATE + row-count check is the actual guarantee,
-- and it's what a concurrent/stale-read case is caught by.
-- ----------------------------------------------------------------------------

create or replace function claim_family_profile(target_user_id uuid)
returns void as $$
declare
  target_family uuid;
  target_removed_at timestamptz;
  target_auth_user_id uuid;
  updated_count int;
begin
  if auth.uid() is null then
    raise exception 'must be authenticated';
  end if;

  select family_id, removed_at, auth_user_id
    into target_family, target_removed_at, target_auth_user_id
  from users
  where id = target_user_id;

  if target_family is null then
    raise exception 'user not found';
  end if;

  if target_family is distinct from current_family_id() then
    raise exception 'not a member of this user''s family';
  end if;

  if target_removed_at is not null then
    raise exception 'cannot claim a removed profile';
  end if;

  if target_auth_user_id is not null and target_auth_user_id is distinct from auth.uid() then
    raise exception 'profile already claimed by another device';
  end if;

  update users
  set auth_user_id = auth.uid()
  where id = target_user_id
    and family_id = target_family
    and removed_at is null
    and (auth_user_id is null or auth_user_id = auth.uid());

  get diagnostics updated_count = row_count;

  -- The atomic source of truth: if the guarded UPDATE didn't actually touch
  -- a row, this call did NOT claim the profile — regardless of what the
  -- earlier SELECT saw. This is what closes the race: only one concurrent
  -- caller can ever see updated_count > 0 for a given target_user_id.
  if updated_count = 0 then
    raise exception 'profile already claimed by another device';
  end if;
end;
$$ language plpgsql volatile security definer;

-- ----------------------------------------------------------------------------
-- If you already applied an EARLIER draft of this migration (one that did
-- `delete from users`) against a real database, don't re-run this file —
-- instead run just this fix-up once:
--
--   alter table users add column if not exists removed_at timestamptz;
--   create or replace function admin_delete_family_member(...)  -- paste the body above
--
-- No data recovery is needed for that scenario: a `delete from users` under
-- the old draft would have FAILED outright (foreign_key_violation) for any
-- member with real history, so no user rows could have actually been lost
-- to it. It could only have succeeded for a brand-new member with zero
-- schedule_entries/walks ever — which soft-delete also handles identically
-- other than leaving the (unused) row behind with removed_at set.
--
-- If you already applied a draft of this migration from BEFORE sections 4/5
-- existed (still using the old, family-wide "update users in own family"
-- policy and a plain client-side `update users set auth_user_id = ...` for
-- claiming), just run sections 4 and 5 above once — `drop policy`/`create
-- policy`/`create or replace function` are all safe to (re-)apply on their
-- own, in order, without touching anything else in this file.
--
-- If you already applied an EARLIER draft of section 5 (one that let ANY
-- family member claim ANY active profile unconditionally, including one
-- already claimed by someone else — a profile-takeover hole) or an earlier
-- draft of section 3's admin_delete_family_member() (one that trusted
-- rule_updates/entry_updates/walk_updates without validating each
-- replacement user id), just re-run `create or replace function
-- claim_family_profile(...)` and `create or replace function
-- admin_delete_family_member(...)` with the bodies above — both are safe to
-- replace in place, and no data needs fixing up: the takeover hole only
-- ever affected auth_user_id (which device controls a profile), never any
-- walk/schedule data, and the unvalidated deletion RPC could only have
-- succeeded with payloads the client itself already computed correctly.
--
-- If you already applied an EARLIER draft of section 5 that had the
-- ownership check (revision 1) but not the row-count check (revision 2) —
-- i.e. it checked target_auth_user_id via a SELECT but never verified the
-- guarded UPDATE actually affected a row — just re-run `create or replace
-- function claim_family_profile(...)` with the body above. That draft had
-- a race: two devices reading auth_user_id as null at the same time could
-- both pass the ownership check, and the losing device's UPDATE would
-- silently affect 0 rows while the RPC still returned success. No data
-- fix-up is needed: the race could only ever produce a client believing it
-- claimed a profile it didn't (a stale local currentUserId), never a wrong
-- server-side auth_user_id value — re-signing in resolves it.
-- ----------------------------------------------------------------------------
