-- 0039_clear_family_auth_membership_on_member_removal.sql
--
-- REAL BUG FIX (security-relevant read-access leak), recorded as a runner-up
-- candidate by 0038's own cycle and confirmed here by direct inspection:
-- admin_delete_family_member() (0004/0007/0016/0037, the current applied
-- definition this migration replaces) soft-deletes a member (users.removed_at
-- = now()) and, as of 0037, deactivates their push destinations -- but has
-- NEVER touched family_auth_members for the removed member's device(s).
--
-- family_auth_members is the DEVICE-level "which family is this auth.uid()
-- in" table current_family_id() resolves from (0002), and current_family_id()
-- has no removed_at/persona check of its own -- by design, it is what lets a
-- brand-new device see the family's member list before it has claimed any
-- persona at all (0016's bootstrap window). But several currently-active RLS
-- SELECT policies gate purely on `family_id = current_family_id()`, with NO
-- is_family_admin()/removed_at check layered on top at all:
--   - "select users in own family" (0002) -- the whole family roster
--   - "select rules in own family" (0004) -- the whole rotation plan
--   - "select entries in own family" (0005) -- every schedule_entries row
--   - "select own family" (0002) -- family metadata
-- ("select walks in own family", 0027, is narrower -- pending + today's
-- resolved walks only for a non-admin -- but still not removed_at-gated.)
--
-- Since admin_delete_family_member() never touches family_auth_members, a
-- removed member's device keeps its family_auth_members row forever, so
-- current_family_id() keeps resolving to this family for that device
-- indefinitely -- the removed member can go on reading the full member
-- roster and the entire recurring schedule/rotation plan, and see every
-- pending walk, from a device that was just removed by an admin. This is a
-- genuine, reachable data-boundary leak (the same class already fixed for
-- push notifications in 0037), not cosmetic: nothing else in this schema
-- ever revokes it, and the member's own Supabase auth session is never
-- invalidated by removal (soft-delete only).
--
-- Since 0020 (multi-device profile sessions), a persona can be actively
-- signed in on MORE THAN ONE device at once via profile_auth_sessions --
-- users.auth_user_id alone (the pre-0020 single-device column) is no longer
-- a complete list of which devices currently represent this persona. Both
-- sources are swept here for completeness.
--
-- FIX: admin_delete_family_member() now also deletes the family_auth_members
-- row(s) for every auth_user_id currently representing target_user_id
-- (via profile_auth_sessions and/or the legacy users.auth_user_id column),
-- scoped to target_family only -- never touching any other device's row, and
-- never touching a device that has since moved on to a different family
-- (the scope-by-family_id guard). This immediately makes current_family_id()
-- -- and therefore every policy/RPC built on it -- resolve to null for that
-- device, closing the leak at its root for every affected table in one
-- place, without needing to add a removed_at check to each policy
-- individually. Harmless if the member is later re-invited: join_family()
-- already upserts family_auth_members for a fresh join.
--
-- Everything else about admin_delete_family_member() (the last-admin guard,
-- the replacement-id validation loops, the rotation/schedule/walk updates,
-- 0037's push/web-push deactivation) is UNCHANGED -- copied verbatim, only
-- the new DELETE added at the end, before removed_at is set. Same
-- 4-argument signature, so CREATE OR REPLACE is safe here (no drop needed)
-- and existing grants are preserved automatically.

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

  -- NEW (0039): sever every device currently representing target_user_id
  -- from this family at the device-membership level, so current_family_id()
  -- -- and every RLS policy/RPC built on it -- stops resolving this family
  -- for those devices immediately. Scoped to target_family so a device that
  -- has since moved on to a different family is never touched.
  delete from family_auth_members
  where family_id = target_family
    and auth_user_id in (
      select auth_user_id from profile_auth_sessions where user_id = target_user_id
      union
      select auth_user_id from users where id = target_user_id and auth_user_id is not null
    );

  -- Same removal event, same reasoning: a stale profile_auth_sessions row
  -- pointing at a just-removed persona serves no purpose (real_current_
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
