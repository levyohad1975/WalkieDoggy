-- ----------------------------------------------------------------------------
-- 0030_system_admin_verified_identity_only.sql
--
-- BATCH 4 CORRECTION #1 (item 3) — SECURITY FIX.
--
-- PROBLEM: every device in this app signs in via Supabase's anonymous
-- auth (see lib/supabase.ts's ensureAnonymousSession() — this is the ONLY
-- sign-in method this app has ever offered; there is no Google/email flow
-- yet, see item G / this correction's identity notes). is_system_admin()
-- (migration 0024) checked only "does a row in system_admins exist for
-- auth.uid()" — it never asked whether that auth.uid() belongs to a
-- verified, non-anonymous identity. That means a `system_admins` row keyed
-- on an ordinary anonymous device UID (e.g. one a well-meaning operator
-- copied out of auth.users during a manual bootstrap) would be treated as
-- fully authorized. The product requirement is explicit: "System Admin =
-- VERIFIED platform identity." An anonymous device session must NEVER
-- qualify, no matter what system_admins says.
--
-- This migration changes is_system_admin() ONLY — every other System Admin
-- v1 object from 0024/0029 (system_admins, am_i_system_admin(),
-- system_audit_log, log_system_audit_event(), system_admin_list_families(),
-- system_admin_get_family_detail()) is untouched and keeps calling
-- is_system_admin() exactly as before, so this fix applies everywhere the
-- gate is used without changing any of their signatures or call sites.
--
-- WHY auth.jwt() ->> 'is_anonymous': Supabase's anonymous sign-in feature
-- (the same feature this app's ensureAnonymousSession() relies on) stamps
-- every access token — anonymous AND real — with an explicit "is_anonymous"
-- boolean claim once the feature is enabled on a project, which is the
-- officially documented way to distinguish them (Supabase's own anonymous
-- sign-ins guide recommends exactly this claim for RLS/authorization
-- checks). auth.jwt() reads the CURRENT request's token claims — the same
-- primitive auth.uid() itself is built on — so it needs no extra grant
-- beyond what is_system_admin() (SECURITY DEFINER) already has.
--
-- DEFENSE IN DEPTH: also re-checks the durable auth.users.is_anonymous
-- column for the same auth_user_id, independent of whatever the CURRENT
-- request's token happens to claim. This project's own auth schema already
-- has this column — see supabase/manual_tests/idan_claim_diagnostic.sql,
-- which already reads it in a diagnostic query — so this is not a new,
-- unverified assumption about this project's Supabase version.
--
-- FAIL CLOSED, ALWAYS: a missing/malformed "is_anonymous" claim (e.g. a
-- token minted before anonymous sign-ins was ever enabled on this project,
-- or any other unexpected shape) is treated as "not verified", never as
-- "verified" — never fail open on ambiguity. If reading auth.users errors
-- for any reason (e.g. an unexpected permissions configuration on some
-- Supabase project), the whole RPC call throws, and the client already
-- fails closed on any error (see store/systemAdminStore.ts's refresh():
-- any rejected checkIsSystemAdmin() call sets isSystemAdmin: false) — so
-- there is no path, including an infrastructure surprise, that grants
-- access on an error.
--
-- BOOTSTRAP GUIDANCE (unchanged from 0024, restated here for emphasis): do
-- NOT insert a row into system_admins keyed on a device's current
-- anonymous auth_user_id — after this migration, is_system_admin() would
-- correctly return false for it anyway, but doing so was never correct
-- ("System Admin = VERIFIED platform identity") even before this fix
-- existed to catch it. Until this app has a real verified sign-in method
-- (Google/email — see the Batch 4 correction report's identity notes for
-- what that would require), there is no verified identity to grant System
-- Admin to, and the System Admin surface should simply stay unused. This
-- migration does not insert any system_admins row, and does not change
-- that guidance.
-- ----------------------------------------------------------------------------

create or replace function is_system_admin()
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_jwt_is_anonymous boolean;
  v_row_is_anonymous boolean;
begin
  if v_uid is null then
    return false;
  end if;

  if not exists (select 1 from system_admins where auth_user_id = v_uid) then
    return false;
  end if;

  -- Primary check: the CURRENT request's own token claim. Missing/null is
  -- treated as "anonymous" (fail closed), never as "verified".
  v_jwt_is_anonymous := coalesce((auth.jwt() ->> 'is_anonymous')::boolean, true);
  if v_jwt_is_anonymous then
    return false;
  end if;

  -- Defense in depth: the durable auth.users row itself, independent of the
  -- current token. Same fail-closed default.
  select is_anonymous into v_row_is_anonymous from auth.users where id = v_uid;
  if coalesce(v_row_is_anonymous, true) then
    return false;
  end if;

  return true;
end;
$$;

comment on function is_system_admin() is
  'Server-side System Admin check, derived from auth.uid() only — never a client-supplied claim. BATCH 4 CORRECTION #1 (item 3): also requires the caller''s identity to be VERIFIED (non-anonymous), checked against both the current request''s JWT claim and the durable auth.users row, failing closed on any ambiguity. An anonymous device session can never pass this check even if its auth_user_id appears in system_admins.';

-- Same grant this function has always had (0024) — restated for clarity,
-- not a change.
revoke all on function is_system_admin() from public;
grant execute on function is_system_admin() to authenticated;
