-- ----------------------------------------------------------------------------
-- 0024_system_admin_foundation.sql
--
-- BATCH 1 (data model foundation) — Part 3 of 3: additive foundation for
-- System Admin (Master Specification §11), WITHOUT any System Admin screen
-- or any RPC that lists/reads family data yet — that is later batch work,
-- built only once it can be reviewed together with the screen that uses it.
-- Upgrade-safe when applied, in order, on top of the expected 0001-0023
-- baseline this repository ships with — see this batch's report for what
-- that guarantee does and doesn't cover (in particular, `create table if
-- not exists` only skips creation if a table by that name already exists;
-- it does not reconcile or verify that an existing same-named object
-- actually has this migration's expected columns/constraints).
--
-- This migration establishes exactly four things:
--   1. system_admins — WHO is a system admin. Architecturally separate from
--      family_auth_members/users (Master Specification §3.1/§11): a system
--      admin is NOT a row in `users`, is not a member of any family, and
--      this table has no foreign key to any family whatsoever. Being a
--      system admin never makes someone a Family Admin of any family, and
--      being a Family Admin of any (or every) family never makes someone a
--      system admin. Keyed on Supabase Auth's own auth.users(id) — the same
--      verified-identity primitive every other privileged check in this
--      schema is built on.
--   2. is_system_admin() — the server-side helper every future
--      system-admin-only RPC must use for its own authorization check
--      (never a client-supplied claim) — same pattern as is_family_admin().
--   3. am_i_system_admin() — a minimal, safe client-callable check. Returns
--      only a boolean for the CALLER's own auth.uid() — never the roster —
--      so a future client can decide whether to show a System Admin entry
--      point without needing SELECT access on system_admins itself.
--   4. system_audit_log — a separate audit trail for system-admin actions,
--      independent of the existing per-family audit_log (Master
--      Specification §11.1: "System Admin activity is logged in a
--      dedicated system audit"). No system-admin RPC writes to it yet as of
--      this migration — that happens once real system-admin RPCs exist.
--
-- BOOTSTRAP: deliberately UNRESOLVED by this migration, on purpose. This
-- migration inserts no rows into system_admins — it establishes the table
-- and its helpers only. There is intentionally NO client-callable "become a
-- system admin" RPC, now or ever, that any ordinary authenticated user
-- could call unprompted.
--
-- Whether the platform System Admin identity should be a dedicated
-- Supabase Auth account created specifically for that purpose, or may also
-- be the same Supabase Auth identity a person already uses as an ordinary
-- family member on their device, is an open product decision that has not
-- been made yet. This table's shape (auth_user_id referencing auth.users,
-- with no link at all to `users`/family membership) is compatible with
-- either answer — it does not need to change once that decision is made.
-- Do NOT insert a row into this table, and do NOT treat any account as a
-- system admin, until that decision is made and a deliberate bootstrap step
-- is explicitly requested. Granting system admins (first or subsequent)
-- can go through a proper, reviewed process (a one-time direct database
-- action and/or a system-admin-gated RPC) once the identity model above is
-- decided and this table is actually about to be used.
-- ----------------------------------------------------------------------------

create table if not exists system_admins (
  auth_user_id uuid primary key references auth.users(id) on delete cascade,
  granted_at timestamptz not null default now(),
  granted_by uuid references auth.users(id) on delete set null,
  notes text
);

comment on table system_admins is
  'Platform-level System Admin roster (Master Specification §3.1/§11) — architecturally separate from family membership/roles. See this migration''s header for the deliberate out-of-band bootstrap process.';

alter table system_admins enable row level security;
-- Deliberately NO policies for anon/authenticated — nobody can read or
-- write this table directly from the client, including a system admin
-- reading their own row. am_i_system_admin() below is the only
-- client-facing surface, and it never returns the roster, only a boolean
-- for the caller's own identity. Only a direct service-role/database
-- connection (which bypasses RLS, same as every other privileged path in
-- this schema) can manage this table until a dedicated admin-gated RPC
-- exists for it.

create or replace function is_system_admin()
returns boolean as $$
  select exists (
    select 1 from system_admins where auth_user_id = auth.uid()
  );
$$ language sql stable security definer set search_path = public;

comment on function is_system_admin() is
  'Server-side System Admin check, derived from auth.uid() only — never a client-supplied claim. The building block every future system-admin-only RPC must use to gate itself, mirroring is_family_admin()''s role in the family-permission model.';

revoke all on function is_system_admin() from public;
grant execute on function is_system_admin() to authenticated;

create or replace function am_i_system_admin()
returns boolean as $$
  select is_system_admin();
$$ language sql stable security definer set search_path = public;

comment on function am_i_system_admin() is
  'Safe client-callable check: "is THIS authenticated session a system admin?" Reveals nothing about anyone other than the caller — safe to call from any authenticated client to decide whether to show a System Admin entry point, without granting SELECT on system_admins itself.';

revoke all on function am_i_system_admin() from public;
grant execute on function am_i_system_admin() to authenticated;

create table if not exists system_audit_log (
  id uuid primary key default gen_random_uuid(),
  actor_auth_user_id uuid references auth.users(id) on delete set null,
  action text not null,
  target_type text,
  target_id uuid,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists system_audit_log_created_at_idx on system_audit_log(created_at desc);

comment on table system_audit_log is
  'Audit trail for System Admin actions, deliberately separate from the per-family audit_log (0005). No system-admin RPC writes to this table yet as of migration 0024 — see log_system_audit_event() below.';

alter table system_audit_log enable row level security;
-- No client policies — same reasoning as request_push_events (0014) and
-- system_admins above: only a service-role/database connection, or a
-- future admin-gated read RPC built alongside the System Admin screen, can
-- ever see this table's contents.

create or replace function log_system_audit_event(
  p_action text,
  p_target_type text default null,
  p_target_id uuid default null,
  p_metadata jsonb default '{}'::jsonb
)
returns void as $$
begin
  if not is_system_admin() then
    raise exception 'system admin permission required';
  end if;
  insert into system_audit_log (actor_auth_user_id, action, target_type, target_id, metadata)
  values (auth.uid(), p_action, p_target_type, p_target_id, p_metadata);
end;
$$ language plpgsql volatile security definer set search_path = public;

comment on function log_system_audit_event(text, text, uuid, jsonb) is
  'Single insertion point for system_audit_log, mirroring log_audit_event()''s (0005) role for the per-family audit_log. Not yet granted to any role beyond its own is_system_admin() gate below — no caller exists until a real system-admin RPC is built to invoke it.';

revoke all on function log_system_audit_event(text, text, uuid, jsonb) from public;
-- Not granted to `authenticated` yet — no legitimate caller exists until a
-- real system-admin RPC is built (a later batch) to invoke it from inside
-- another SECURITY DEFINER function, mirroring log_audit_event()'s own
-- access model (0005: "its own EXECUTE is revoked from PUBLIC/anon/
-- authenticated — only callable from inside another SECURITY DEFINER
-- function"). This function's own is_system_admin() check would still
-- correctly reject any non-system-admin caller even if granted, but there
-- is no reason to widen its grant before any caller needs it.
