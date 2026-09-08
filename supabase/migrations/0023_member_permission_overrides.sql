-- ----------------------------------------------------------------------------
-- 0023_member_permission_overrides.sql
--
-- BATCH 1 (data model foundation) — Part 2 of 3: additive foundation for
-- the customizable per-member permission model (Master Specification §3.2).
-- This migration adds ONLY the data model plus admin-gated write RPCs —
-- nothing in the app reads or enforces these overrides yet (navigation
-- gating, History/Statistics visibility enforcement, and any UI to manage
-- them are later batch work). Upgrade-safe when applied on top of the
-- expected 0001-0022 baseline this repository ships with. `create table if
-- not exists` guards against re-running THIS migration a second time — it
-- does not verify or reconcile an already-existing same-named table of a
-- different shape; if member_permission_overrides already exists from some
-- other source, inspect it before applying this file.
--
-- MODEL: role (admin/member) still supplies the DEFAULT for every
-- permission. This table stores per-member, per-permission EXCEPTIONS to
-- that default, settable only by a Family Admin. The absence of a row for
-- (user_id, permission_key) means "use the role default" — this is what
-- makes introducing this table a no-op for every existing family: nobody
-- has any override rows yet, so every family's current behavior (History
-- and Statistics visible to every member — the approved default) is
-- preserved automatically until an admin explicitly changes something for
-- a specific member.
--
-- permission_key is deliberately constrained to the small set actually
-- approved so far (view_history, view_statistics) rather than free text, so
-- a typo'd key can never silently create a permission the app doesn't
-- recognize. Extending this set later (e.g. for navigation-tab visibility)
-- is a small additive migration that widens this CHECK constraint — no data
-- migration needed for rows that already exist.
-- ----------------------------------------------------------------------------

create table if not exists member_permission_overrides (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references families(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  permission_key text not null check (permission_key in ('view_history', 'view_statistics')),
  allowed boolean not null,
  set_by_user_id uuid references users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, permission_key)
);

create index if not exists member_permission_overrides_family_id_idx
  on member_permission_overrides(family_id);
create index if not exists member_permission_overrides_user_id_idx
  on member_permission_overrides(user_id);

comment on table member_permission_overrides is
  'Per-member exceptions to the role-based (admin/member) permission defaults (Master Specification §3.2). Absence of a row means "use the role default" — see this migration''s header. Not yet read or enforced anywhere in the app as of migration 0023.';

alter table member_permission_overrides enable row level security;

-- A member may read their OWN override rows (so their own client can, in a
-- later batch, resolve what it should show); a Family Admin may read every
-- override in the family (for a future management UI). No client
-- INSERT/UPDATE/DELETE policy — every write goes through the admin-gated
-- RPCs below, exactly like every other privileged mutation in this schema.
drop policy if exists "member permission overrides select" on member_permission_overrides;
create policy "member permission overrides select" on member_permission_overrides
  for select using (
    family_id = current_family_id()
    and (user_id = current_profile_id() or is_family_admin(family_id))
  );

-- ----------------------------------------------------------------------------
-- set_member_permission_override(p_user_id, p_permission_key, p_allowed)
--
-- Sets (or updates) one explicit permission exception for one member.
-- Callable only by a Family Admin of the target member's own family, for an
-- active (non-removed) member. Every call is audited via the existing
-- log_audit_event() (0005/0006) — no new audit mechanism invented.
-- ----------------------------------------------------------------------------
create or replace function set_member_permission_override(
  p_user_id uuid,
  p_permission_key text,
  p_allowed boolean
)
returns void as $$
declare
  admin_profile uuid;
  target_family uuid;
  target_removed_at timestamptz;
begin
  admin_profile := current_profile_id();
  if admin_profile is null then
    raise exception 'no active profile claimed on this family';
  end if;

  if p_permission_key not in ('view_history', 'view_statistics') then
    raise exception 'unknown permission_key';
  end if;

  select family_id, removed_at into target_family, target_removed_at
  from users where id = p_user_id;

  if target_family is null then
    raise exception 'user not found';
  end if;
  if target_family is distinct from current_family_id() then
    raise exception 'user not found';
  end if;
  if not is_family_admin(target_family) then
    raise exception 'admin permission required';
  end if;
  if target_removed_at is not null then
    raise exception 'cannot set a permission override for a removed member';
  end if;

  insert into member_permission_overrides (family_id, user_id, permission_key, allowed, set_by_user_id, updated_at)
  values (target_family, p_user_id, p_permission_key, p_allowed, admin_profile, now())
  on conflict (user_id, permission_key) do update
    set allowed = excluded.allowed,
        set_by_user_id = excluded.set_by_user_id,
        updated_at = now();

  perform log_audit_event(target_family, admin_profile, 'member_permission_override_set', 'user', p_user_id,
    jsonb_build_object('permission_key', p_permission_key, 'allowed', p_allowed));
end;
$$ language plpgsql volatile security definer set search_path = public;

revoke all on function set_member_permission_override(uuid, text, boolean) from public;
grant execute on function set_member_permission_override(uuid, text, boolean) to authenticated;

-- ----------------------------------------------------------------------------
-- clear_member_permission_override(p_user_id, p_permission_key)
--
-- Removes an override, reverting that member/permission back to "use the
-- role default". The natural inverse of the setter above; included now
-- rather than as a follow-up migration since it's the same shape of change.
-- Validates p_permission_key against the exact same known set as
-- set_member_permission_override() — an unknown key is rejected outright,
-- before touching member_permission_overrides or the audit log, so this
-- function can never record a "cleared" audit event for a permission that
-- was never a real, recognized permission in the first place.
-- ----------------------------------------------------------------------------
create or replace function clear_member_permission_override(
  p_user_id uuid,
  p_permission_key text
)
returns void as $$
declare
  admin_profile uuid;
  target_family uuid;
begin
  admin_profile := current_profile_id();
  if admin_profile is null then
    raise exception 'no active profile claimed on this family';
  end if;

  if p_permission_key not in ('view_history', 'view_statistics') then
    raise exception 'unknown permission_key';
  end if;

  select family_id into target_family from users where id = p_user_id;
  if target_family is null or target_family is distinct from current_family_id() then
    raise exception 'user not found';
  end if;
  if not is_family_admin(target_family) then
    raise exception 'admin permission required';
  end if;

  delete from member_permission_overrides
  where user_id = p_user_id and permission_key = p_permission_key;

  perform log_audit_event(target_family, admin_profile, 'member_permission_override_cleared', 'user', p_user_id,
    jsonb_build_object('permission_key', p_permission_key));
end;
$$ language plpgsql volatile security definer set search_path = public;

revoke all on function clear_member_permission_override(uuid, text) from public;
grant execute on function clear_member_permission_override(uuid, text) to authenticated;
