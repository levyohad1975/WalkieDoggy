-- 0041_fail_closed_member_removal_completeness_check.sql
--
-- REAL BUG FIX (data-integrity gap, first-time-discovered): admin_delete_
-- family_member() (0004/0007/0016/0037/0039, the current applied definition
-- this migration replaces) is SECURITY DEFINER and fully TRUSTS the
-- client-supplied rule_updates/entry_updates/walk_updates JSON arrays to be
-- the COMPLETE set of rotation/entry/walk reassignments needed for the
-- member being removed. It validates that each individual replacement id in
-- the payload is a valid active family member (0039's own comment on this),
-- applies exactly those rows, then unconditionally sets removed_at = now()
-- on the target user -- with no server-side check that every live
-- schedule_rules/schedule_entries/walks row actually still referencing
-- target_user_id was covered by the payload.
--
-- The client computes that payload (planUserRemoval() in
-- src/logic/familyManagement.ts, called from src/store/familyStore.ts's
-- deleteUser()) from useScheduleStore.getState() -- an in-memory cache that
-- is only refreshed via an explicit load() call or a best-effort, debounced
-- Realtime subscription (src/lib/realtime.ts) that can silently miss
-- updates if the realtime connection itself is unavailable. No exotic race
-- is required to go stale: an admin can open FamilyScreen (computing the
-- deletion impact once from whatever is cached at that moment), leave it
-- open for a while, then tap delete -- during which another co-admin's
-- device, the schedule's own rolling entry-generation window crossing a day
-- boundary, or a flaky Realtime connection can all add a new pending
-- walk/future entry/rotation membership for the target user without this
-- device's cache ever refreshing.
--
-- Why this matters: computeUserDeletionImpact()'s own doc comment
-- (src/logic/familyManagement.ts) already establishes the invariant this
-- schema depends on -- "an overdue [pending walk] left behind must still be
-- reassigned... must count as impact requiring a replacement" -- because
-- once removed_at is set, the removed persona's identity can never be
-- reclaimed again (0020's claim_family_profile()/claim_family_profile_
-- with_pin() both explicitly reject "cannot claim a removed profile"). A
-- walks/schedule_entries row left pointing at a just-removed
-- responsible_user_id becomes practically stuck: enforce_walk_write_
-- authorization() (0015) only lets the CURRENT responsible member
-- self-resolve a walk, so only a family admin who happens to notice the
-- orphaned row can ever fix it. Every other privileged multi-row RPC in
-- this schema (admin_swap_walks 0031, admin_reschedule_walk 0026)
-- re-validates its target rows fresh from the database itself rather than
-- trusting a client-supplied "this is everything" claim; this RPC was the
-- one exception.
--
-- FIX: after applying the three update loops (unchanged, copied verbatim)
-- and before the destructive steps (push/web-push deactivation,
-- family_auth_members/profile_auth_sessions cleanup, removed_at set), add a
-- fail-closed completeness check -- raise exception if any live
-- schedule_rules/schedule_entries/walks row in target_family still
-- references target_user_id after the client's own updates were applied.
-- This turns a silent data-integrity corruption into a clear, actionable
-- "refresh and retry" rejection, and makes the server (not a possibly-stale
-- client cache) the authority on whether the removal payload was complete.
--
-- Matches the exact same date/status semantics computeUserDeletionImpact()/
-- planUserRemoval() already use client-side, so a genuinely complete,
-- fresh payload is never rejected:
--   - schedule_rules: every row (regardless of `active`) is checked, since
--     planUserRemoval() also processes every rule containing target_user_id
--     regardless of `active` (see its own doc comment on this).
--   - schedule_entries: only checked for date >= the CALLER'S OWN family's
--     current LOCAL calendar date, via current_family_local_date() (0027) --
--     never a bare current_date, never a client-supplied timezone -- because
--     planUserRemoval()'s entries loop is likewise deliberately scoped to
--     `entry.date >= today` (a past scheduling slot has nothing left to
--     reassign, unlike a pending walk). current_family_id() (and therefore
--     current_family_local_date()) resolves to the caller's own family,
--     already confirmed equal to target_family by the guard above.
--   - walks: checked for status = 'pending' only, with NO date filter --
--     matching computeUserDeletionImpact()/planUserRemoval()'s own
--     deliberate choice to treat an overdue-but-unresolved pending walk as
--     live impact regardless of date (a `pending` walk, unlike an entry, is
--     an unresolved item nobody has marked done/skipped yet, so it must be
--     covered by walk_updates just like a future one).
--
-- Everything else about admin_delete_family_member() (the last-admin guard,
-- the replacement-id validation loops, the rotation/schedule/walk update
-- loops, 0037's push/web-push deactivation, 0039's family_auth_members/
-- profile_auth_sessions cleanup) is UNCHANGED -- copied verbatim, only the
-- new completeness check inserted. Same 4-argument signature, so CREATE OR
-- REPLACE is safe here (no drop needed) and existing grants are preserved
-- automatically.

create or replace function admin_delete_family_member(
  target_user_id uuid,
  rule_updates jsonb default '[]'::jsonb,
  entry_updates jsonb default '[]'::jsonb,
  walk_updates jsonb default '[]'::jsonb
)
returns void as $$
declare
  target_family uuid;
  target_role text;
  item jsonb;
  elem text;
  remaining_admins int;
begin
  if auth.uid() is null then
    raise exception 'must be authenticated';
  end if;

  select family_id, role into target_family, target_role from users where id = target_user_id;
  if target_family is null then
    raise exception 'user not found';
  end if;

  if target_family is distinct from current_family_id() then
    raise exception 'not a member of this user''s family';
  end if;

  if not is_family_admin(target_family) then
    raise exception 'admin permission required';
  end if;

  -- Removing the family's last remaining Admin persona must be rejected,
  -- exactly like demoting them would be — a family with zero Admin
  -- personas can never manage roles/removals again.
  if target_role = 'admin' then
    perform pg_advisory_xact_lock(hashtext('set_member_role:' || target_family::text));

    select count(*) into remaining_admins
    from users u
    where u.family_id = target_family
      and u.role = 'admin'
      and u.id <> target_user_id
      and u.removed_at is null;

    if remaining_admins = 0 then
      raise exception 'cannot remove the last admin of this family';
    end if;
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

  -- NEW (0041): fail-closed completeness check. The update loops above only
  -- ever applied whatever rows the caller supplied — this verifies nothing
  -- live was left behind referencing target_user_id, rather than trusting
  -- the client's cache was complete. See this migration's own header for
  -- the full reachable-staleness reasoning and why each check's scope
  -- mirrors planUserRemoval()'s own client-side semantics exactly.
  if exists (
    select 1 from schedule_rules
    where family_id = target_family
      and target_user_id = any (rotation_user_ids)
  ) then
    raise exception 'stale rotation data — refresh and retry the deletion';
  end if;

  if exists (
    select 1 from schedule_entries
    where family_id = target_family
      and responsible_user_id = target_user_id
      and date >= current_family_local_date()
  ) then
    raise exception 'stale schedule data — refresh and retry the deletion';
  end if;

  if exists (
    select 1 from walks
    where family_id = target_family
      and responsible_user_id = target_user_id
      and status = 'pending'
  ) then
    raise exception 'stale walk data — refresh and retry the deletion';
  end if;

  -- (0037) deactivate the removed member's own push delivery destinations so
  -- they stop receiving notifications about this family's activity the
  -- moment they are removed, regardless of which later push code path would
  -- otherwise resolve them as a recipient.
  update push_tokens
  set is_active = false, updated_at = now()
  where user_id = target_user_id
    and is_active = true;

  update web_push_subscriptions
  set is_active = false, updated_at = now()
  where user_id = target_user_id
    and is_active = true;

  -- (0039) sever every device currently representing target_user_id from
  -- this family at the device-membership level, so current_family_id() --
  -- and every RLS policy/RPC built on it -- stops resolving this family for
  -- those devices immediately. Scoped to target_family so a device that has
  -- since moved on to a different family is never touched.
  delete from family_auth_members
  where family_id = target_family
    and auth_user_id in (
      select auth_user_id from profile_auth_sessions where user_id = target_user_id
      union
      select auth_user_id from users where id = target_user_id and auth_user_id is not null
    );

  -- (0039) same removal event, same reasoning: a stale profile_auth_sessions
  -- row pointing at a just-removed persona serves no purpose (real_current_
  -- profile_id() already excludes it via removed_at, and the device's own
  -- family_auth_members row is now gone too) and only leaves confusing
  -- "still signed in as a removed persona" state lying around.
  delete from profile_auth_sessions where user_id = target_user_id;

  update users
  set removed_at = now()
  where id = target_user_id
    and family_id = target_family;
end;
$$ language plpgsql volatile security definer set search_path = public;
