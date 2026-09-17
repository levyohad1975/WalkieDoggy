-- 0037_deactivate_push_on_member_removal.sql
--
-- REAL BUG FIX: admin_delete_family_member() (0004/0007, reworked by 0016 --
-- that is the current, applied definition this migration replaces) soft-
-- deletes a member (users.removed_at = now()) but has never touched
-- push_tokens/web_push_subscriptions for that member. Those rows stay
-- is_active = true indefinitely -- there is no other code path anywhere in
-- this schema that deactivates a single removed member's push destinations
-- (the only existing push_tokens deletes are the whole-FAMILY QA-sandbox
-- resets in 0016, `delete from push_tokens where family_id = ...`, not a
-- per-member removal).
--
-- This is concretely reachable, not theoretical: a member M creates a
-- time-change request for their own walk (registers/refreshes their push
-- token via upsert_push_token, 0013). Before the request is resolved, an
-- admin removes M from the family via the ordinary FamilyScreen delete
-- flow. The admin later approves or rejects that still-pending request --
-- both approve_time_change_request() and reject_time_change_request()
-- (0006) resolve the recipient purely from
-- time_change_requests.requested_by_user_id, with no removed_at check on
-- that user. supabase/functions/send-request-push/index.ts's own
-- "Requirement 7, defense in depth" recipientFamilyIds check
-- (index.ts ~line 323-329) only re-confirms family_id, never removed_at,
-- so a soft-deleted member still passes it -- and their push_tokens row is
-- still is_active = true, so the Expo push is actually delivered. The same
-- gap applies to walk_swap_requests' target_user_id and to any future push
-- channel that loads push_tokens/web_push_subscriptions by user_id without
-- separately re-checking removed_at. A person the admin just removed from
-- the family keeps receiving real, content-bearing push notifications
-- about that family's internal activity -- a data-boundary leak triggered
-- by a completely ordinary two-step admin sequence (remove a member, then
-- resolve their pending request), not a contrived edge case.
--
-- FIX: admin_delete_family_member() now also deactivates (is_active =
-- false, matching the existing DeviceNotRegistered-deactivation shape
-- already used in send-request-push/index.ts) every push_tokens and
-- web_push_subscriptions row belonging to the removed member, at the same
-- moment removed_at is set. This closes the leak at its root, independent
-- of which push code path later resolves the (now-removed) user as a
-- recipient: no active destination remains to deliver to. Deactivating
-- (not deleting) mirrors the existing per-token pattern elsewhere in this
-- schema and is harmless even if the member is later reclaimed/rejoins --
-- upsert_push_token()/the client's own registration flow re-activates a
-- fresh row the next time that device's app runs.
--
-- Everything else about admin_delete_family_member() (the last-admin
-- guard, the replacement-id validation loops, the rotation/schedule/walk
-- updates) is UNCHANGED from 0016's own definition -- copied verbatim, only
-- the two new UPDATE statements added at the end, before removed_at is set.
-- Same 4-argument signature, so CREATE OR REPLACE is safe here (no drop
-- needed, unlike 0036's create_verified_family() case) and existing grants
-- are preserved automatically.

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

  -- NEW (0037): deactivate the removed member's own push delivery
  -- destinations so they stop receiving notifications about this family's
  -- activity the moment they are removed, regardless of which later push
  -- code path (time-change/swap approve or reject, walk reminders, or any
  -- future channel) would otherwise resolve them as a recipient.
  update push_tokens
  set is_active = false, updated_at = now()
  where user_id = target_user_id
    and is_active = true;

  update web_push_subscriptions
  set is_active = false, updated_at = now()
  where user_id = target_user_id
    and is_active = true;

  update users
  set removed_at = now()
  where id = target_user_id
    and family_id = target_family;
end;
$$ language plpgsql volatile security definer set search_path = public;
