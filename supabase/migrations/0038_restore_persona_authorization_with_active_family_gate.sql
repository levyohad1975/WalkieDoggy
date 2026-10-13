-- 0038_restore_persona_authorization_with_active_family_gate.sql
--
-- Issue #3 RC hardening: migration 0033 ("contract/cutover phase") set out
-- only to add a families.approval_status = 'active' fail-closed gate ahead
-- of the verified-family-onboarding cutover, but its `create or replace
-- function current_family_role()` / `is_family_admin()` (lines 23-54)
-- instead threw away the entire persona-anchored authorization model
-- migration 0016 built ("PART 0 -- persona-anchored authorization") and
-- reverted both to bare family_auth_members-based lookups -- exactly the
-- device-level model 0016 replaced because it goes stale.
--
-- set_member_role() (0016, unchanged, still the applied definition) writes
-- ONLY users.role for the target PERSONA. 0033's is_family_admin()/
-- current_family_role() read ONLY family_auth_members.role, a device-level
-- column set_member_role() never touches. The two are completely
-- decoupled by 0033:
--   - Demoting an admin is a no-op server-side: if the demoted member's
--     device still holds family_auth_members.role = 'admin' (e.g. the
--     original family creator), that device keeps full admin authority on
--     every subsequent RPC/RLS check indefinitely, even though the UI
--     shows them demoted and the audit log records the demotion.
--   - Promoting a member to admin is also broken: a member promoted via
--     set_member_role() still resolves as non-admin server-side if their
--     device's family_auth_members.role was ever 'member' (e.g. anyone who
--     joined via invite code), so the UI shows them as Admin while every
--     admin-gated RPC still rejects them with "admin permission required".
-- 0033 also dropped is_family_admin()'s active_impersonation_target()
-- fail-closed wrapper (0006), so a real admin impersonating a member
-- resolves as admin again server-side during an impersonation session.
--
-- This migration restores 0016's persona-anchored current_family_role()/
-- is_real_family_admin() (same persona-first, bootstrap-fallback,
-- fail-closed logic -- see 0016's own "LOST-CLAIM ADVERSARIAL WALKTHROUGH"
-- comment block for the 10 required adversarial cases, still valid
-- unchanged and still mirrored by
-- src/store/__tests__/lostClaimAuthorization.spec.test.ts) and 0006's
-- is_family_admin() impersonation wrapper, while ADDING the
-- families.approval_status = 'active' gate 0033 actually intended --
-- applied explicitly inside both the persona branch and the
-- bootstrap-fallback branch, not merely inferred through
-- real_current_profile_id()'s own current_family_id() gate. That
-- inference alone would not be enough: create_verified_family() (0032)
-- inserts a family_auth_members row for the creating admin at
-- family-creation time, before any persona/users row exists and before
-- approval -- so the unchanged bootstrap-fallback branch (zero active
-- personas yet) would otherwise let a still-pending family's creator
-- resolve as admin, which is exactly the gap 0033 set out to close.
--
-- current_family_id() (0033) is left untouched here -- it is a
-- device-level "which family is this device in" lookup, was never
-- persona-anchored to begin with, and already gates on
-- approval_status = 'active' correctly.

create or replace function current_family_role()
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  persona_id uuid;
  persona_role text;
  persona_family uuid;
  fam_id uuid;
begin
  persona_id := real_current_profile_id();
  if persona_id is not null then
    select role, family_id into persona_role, persona_family
    from users where id = persona_id;

    if not exists (
      select 1 from families
      where id = persona_family and approval_status = 'active'
    ) then
      return null; -- fail closed: this persona's family is not (or no longer) active
    end if;

    return persona_role;
  end if;

  fam_id := current_family_id(); -- already gated on approval_status = 'active'
  if fam_id is null then
    return null; -- no active family membership at all
  end if;

  -- Bootstrap-only fallback -- see 0016's current_family_role() doc
  -- comment for the full reasoning. Reuses bootstrap_first_member_role()'s
  -- exact predicate.
  if exists (select 1 from users where family_id = fam_id and removed_at is null) then
    return null; -- fail closed: an active persona exists somewhere in this family, and this device holds none of them
  end if;

  return (select role from family_auth_members where auth_user_id = auth.uid() and family_id = fam_id limit 1);
end;
$$;

create or replace function is_real_family_admin(target_family_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  persona_id uuid;
begin
  if not exists (
    select 1 from families
    where id = target_family_id and approval_status = 'active'
  ) then
    return false; -- fail closed: target family is not (or no longer) active
  end if;

  persona_id := real_current_profile_id();
  if persona_id is not null then
    return exists (
      select 1 from users
      where id = persona_id
        and family_id = target_family_id
        and role = 'admin'
        and removed_at is null
    );
  end if;

  -- Bootstrap-only fallback -- see 0016's is_real_family_admin() doc
  -- comment for the full reasoning. Reuses bootstrap_first_member_role()'s
  -- exact predicate.
  if exists (select 1 from users where family_id = target_family_id and removed_at is null) then
    return false; -- fail closed: an active persona exists somewhere in this family, and this device holds none of them
  end if;

  return exists (
    select 1 from family_auth_members
    where auth_user_id = auth.uid()
      and family_id = target_family_id
      and role = 'admin'
  );
end;
$$;

-- Restores 0006's impersonation-aware wrapper: false while impersonating,
-- otherwise delegates to the persona-anchored is_real_family_admin() above.
create or replace function is_family_admin(target_family_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select case
    when active_impersonation_target() is not null then false
    else is_real_family_admin(target_family_id)
  end;
$$;
