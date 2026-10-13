-- ============================================================================
-- 0007_multi_admin_roles.sql
--
-- Round 6, Priority B2: multiple Admins per family.
--
-- Adds one new SECURITY DEFINER RPC, set_member_role(), that lets an existing
-- Admin promote a Member to Admin or demote an Admin to Member, safely:
--   - only an existing Admin of the SAME family may call it (server-side
--     check via is_family_admin(), never trusted from the client) — and,
--     per 0006, is_family_admin() already returns false for the duration of
--     an impersonation session, so an impersonated member can never reach
--     this even indirectly;
--   - the target must be an ACTIVE (not removed) member of that admin's
--     family;
--   - a change that would leave the family with ZERO Admins is rejected —
--     this covers both "the last Admin demotes themselves" and "the last
--     Admin demotes the only other Admin", by counting active Admins
--     EXCLUDING the target row and requiring at least one remain (or the
--     target's own new role to still be admin);
--   - every change is written to audit_log via the existing log_audit_event()
--     (0005/0006) — no new audit mechanism invented.
--
-- Role is stored per `family_auth_members.auth_user_id` (0003), not per
-- `users.id` — a family can in principle have more auth sessions than
-- profiles. set_member_role() takes a `users.id` (matching the existing
-- admin_delete_family_member() convention from 0004) and resolves the
-- corresponding auth_user_id server-side.
--
-- Concurrency: mirrors begin_impersonation()'s pg_advisory_xact_lock pattern
-- (0006) — two admins racing to demote each other, or an admin racing a
-- demote against another admin's self-demotion, must not both observe
-- ">= 1 admin remaining" from a stale read and jointly zero the family out.
-- The lock is keyed per-family so unrelated families never contend.
--
-- Rollback note: to remove this feature, `drop function if exists
-- set_member_role(uuid, text);` — no table/column changes to undo.
-- ============================================================================

create or replace function set_member_role(p_user_id uuid, p_role text)
returns void as $$
declare
  admin_profile uuid;
  target_family uuid;
  target_auth_user_id uuid;
  target_removed_at timestamptz;
  current_role text;
  remaining_admins int;
begin
  if p_role not in ('admin', 'member') then
    raise exception 'invalid role';
  end if;

  admin_profile := current_profile_id();
  if admin_profile is null then
    raise exception 'no active profile claimed on this family';
  end if;

  select family_id, auth_user_id, removed_at
    into target_family, target_auth_user_id, target_removed_at
  from users
  where id = p_user_id;

  if target_family is null then
    raise exception 'user not found';
  end if;

  if target_family is distinct from current_family_id() then
    raise exception 'user not found';
  end if;

  -- Server-side only — never trust a client-supplied "I am an admin" claim.
  -- Also fails closed while impersonating (is_family_admin() returns false
  -- during an impersonation session — see 0006).
  if not is_family_admin(target_family) then
    raise exception 'admin permission required';
  end if;

  if target_removed_at is not null then
    raise exception 'cannot change the role of a removed member';
  end if;

  if target_auth_user_id is null then
    raise exception 'target member has no linked auth session';
  end if;

  -- Serialize concurrent role changes within this family (see comment above).
  perform pg_advisory_xact_lock(hashtext('set_member_role:' || target_family::text));

  select role into current_role from family_auth_members where auth_user_id = target_auth_user_id;
  if current_role is null then
    raise exception 'target member has no linked auth session';
  end if;

  if current_role = p_role then
    return; -- no-op, nothing to do or audit
  end if;

  -- Zero-admin guard: count active admins in this family EXCLUDING the
  -- target's current row, then decide if the family still has >= 1 admin
  -- after applying p_role to the target.
  select count(*) into remaining_admins
  from family_auth_members fam
  join users u on u.auth_user_id = fam.auth_user_id
  where fam.family_id = target_family
    and fam.role = 'admin'
    and fam.auth_user_id <> target_auth_user_id
    and u.removed_at is null;

  if p_role = 'member' and remaining_admins = 0 then
    raise exception 'cannot demote the last admin of this family';
  end if;

  update family_auth_members
  set role = p_role
  where auth_user_id = target_auth_user_id;

  perform log_audit_event(
    target_family,
    admin_profile,
    case when p_role = 'admin' then 'member_promoted_to_admin' else 'admin_demoted_to_member' end,
    'user',
    p_user_id,
    jsonb_build_object('previous_role', current_role, 'new_role', p_role)
  );
end;
$$ language plpgsql volatile security definer set search_path = public;

-- No RLS-level grant needed beyond the default (any authenticated user may
-- attempt to call this function — it is safe to call because every actual
-- authorization check happens INSIDE it, exactly like admin_delete_family_member()).

-- ----------------------------------------------------------------------------
-- Last-admin-removal guard on admin_delete_family_member() (0004).
--
-- 0004's admin_delete_family_member() did not guard against removing the
-- family's only Admin (multi-admin didn't exist yet, so this could only ever
-- remove a Member). Now that a family can have more than one Admin, removing
-- one must be blocked the same way demoting the last one is (see
-- set_member_role() above) — following this codebase's own established
-- pattern (0006 already layers `create or replace function` redefinitions of
-- earlier migrations' functions rather than editing the immutable files
-- directly). Everything else about the function is UNCHANGED — copied
-- verbatim from 0004 with only the new guard inserted.
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
  target_auth_user_id uuid;
  item jsonb;
  elem text;
  remaining_admins int;
begin
  if auth.uid() is null then
    raise exception 'must be authenticated';
  end if;

  select family_id, auth_user_id into target_family, target_auth_user_id from users where id = target_user_id;
  if target_family is null then
    raise exception 'user not found';
  end if;

  if target_family is distinct from current_family_id() then
    raise exception 'not a member of this user''s family';
  end if;

  if not is_family_admin(target_family) then
    raise exception 'admin permission required';
  end if;

  -- NEW (0007): removing the family's last remaining Admin must be
  -- rejected, exactly like demoting them would be — a family with zero
  -- Admins can never manage roles/removals again.
  if target_auth_user_id is not null then
    perform pg_advisory_xact_lock(hashtext('set_member_role:' || target_family::text));

    select count(*) into remaining_admins
    from family_auth_members fam
    join users u on u.auth_user_id = fam.auth_user_id
    where fam.family_id = target_family
      and fam.role = 'admin'
      and fam.auth_user_id <> target_auth_user_id
      and u.removed_at is null;

    if remaining_admins = 0
      and exists (select 1 from family_auth_members where auth_user_id = target_auth_user_id and role = 'admin')
    then
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

  update users
  set removed_at = now()
  where id = target_user_id
    and family_id = target_family;
end;
$$ language plpgsql volatile security definer;
