-- Compatibility follow-up: Supabase exposes pgcrypto in the extensions schema. Keep the SECURITY DEFINER search path explicit while allowing the same function bodies to resolve pgcrypto on staging.
-- ============================================================================
-- 0009_family_invites_pgcrypto_fix.sql
--
-- Narrowly-scoped RUNTIME COMPATIBILITY FIX for the Family Invite feature
-- (0008_family_invites.sql). This is NOT Round 4 and makes NO behavioral,
-- authorization, schema, table, or RLS changes of any kind.
--
-- Problem (observed in live Supabase QA): create_family_invite() fails at
-- runtime on the live Supabase project — no family_invites row is ever
-- created. On that project, pgcrypto's functions resolve under the
-- `extensions` schema (extensions.gen_random_bytes, extensions.digest) —
-- this is how Supabase's own platform provisioning installs pgcrypto,
-- distinct from a bare/manual local Postgres setup where
-- `create extension if not exists pgcrypto;` (see schema.sql) typically
-- resolves it under `public` instead.
--
-- 0008's three affected functions are declared
-- `security definer set search_path = public` (intentionally, so that only
-- `public` is searched inside them regardless of the calling session's own
-- search_path — this is exactly what makes SECURITY DEFINER safe against a
-- caller manipulating search_path to shadow a function/table). Because only
-- `public` is searched, an unqualified `gen_random_bytes(...)`/`digest(...)`
-- call inside these functions cannot resolve on the live project, where
-- those functions live in `extensions` rather than `public`.
--
-- Fix: explicit schema-qualification of every pgcrypto call
-- (`extensions.gen_random_bytes(...)`, `digest(...)`) inside the
-- three functions that actually use them. `search_path` itself is left
-- exactly as `public` — NOT widened to include `extensions` — because
-- widening search_path is a strictly weaker fix for this exact problem:
-- explicit qualification resolves the same function under either possible
-- pgcrypto location (local `public` or live `extensions`) without ever
-- depending on schema search order, whereas adding `extensions` to
-- search_path would (a) still require getting the order right relative to
-- `public` and other schemas, (b) silently widen what a
-- SECURITY-DEFINER-elevated function implicitly trusts and searches for
-- EVERY unqualified identifier in its body — not just the two pgcrypto
-- calls — which is exactly the class of risk `set search_path = public`
-- exists to close off, and (c) is unnecessary here since qualifying the two
-- call sites is sufficient and strictly more precise. There is no
-- compelling repository-specific reason to prefer the weaker option, so the
-- explicit-qualification fix is used per the task's own stated preference.
--
-- Functions redefined (create or replace function — same signatures, same
-- return shapes, same body, same security/search_path clauses as 0008 —
-- ONLY the pgcrypto call sites are schema-qualified):
--   - create_family_invite(p_target_user_id uuid)   [2 call sites]
--   - inspect_family_invite(p_token text)           [1 call site]
--   - redeem_family_invite(p_token text)            [1 call site]
--
-- NOT redefined here, and deliberately unmodified — neither uses pgcrypto:
--   - revoke_family_invite(p_invite_id uuid)
--   - list_family_invites()
--
-- No table, index, RLS policy, or column is touched. No error string,
-- authorization check, TTL, collision guard, or audit call is changed.
-- Migration 0008 itself is not modified — this is a pure additive
-- `create or replace function` migration, per Postgres/Supabase's own
-- established migration convention already used across every other
-- migration in this repo.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- create_family_invite(p_target_user_id uuid) — pgcrypto-qualified
--
-- Identical to 0008's definition in every respect except lines
-- `v_raw_token := encode(gen_random_bytes(32), 'base64');` and
-- `v_token_hash := encode(digest(v_raw_token, 'sha256'), 'hex');`, which now
-- read `gen_random_bytes(32)` / `digest(...)`.
-- ----------------------------------------------------------------------------

create or replace function create_family_invite(p_target_user_id uuid)
returns table (id uuid, raw_token text, expires_at timestamptz) as $$
declare
  fam uuid;
  admin_profile uuid;
  target_family uuid;
  target_removed_at timestamptz;
  target_auth_user_id uuid;
  v_raw_token text;
  v_token_hash text;
  v_expires_at timestamptz;
  new_id uuid;
begin
  if auth.uid() is null then
    raise exception 'must be authenticated';
  end if;

  fam := current_family_id();
  if fam is null then
    raise exception 'this device is not a member of a family';
  end if;

  -- CORRECTION ROUND 1: impersonation-aware check. is_family_admin()
  -- resolves false for the entire duration of an active impersonation
  -- session (0006), so a real admin mid-impersonation gets the same
  -- "admin permission required" rejection a genuine non-admin member would
  -- — never a special-cased allow. Client-side hiding is UX only, never the
  -- enforcement boundary.
  if not is_family_admin(fam) then
    raise exception 'admin permission required';
  end if;

  -- NOTE: table-qualified (users.id / users.family_id / ...) because this
  -- function's RETURNS TABLE declares an OUT parameter literally named
  -- `id`, which would otherwise make a bare `id`/`family_id` column
  -- reference here ambiguous (caught by a real Postgres run against a live
  -- database during Round 1 verification — see the implementation report).
  select users.family_id, users.removed_at, users.auth_user_id
    into target_family, target_removed_at, target_auth_user_id
  from users
  where users.id = p_target_user_id;

  if target_family is null then
    raise exception 'user not found';
  end if;

  -- CORRECTION ROUND 3: explicit re-check that the target actually belongs
  -- to the caller's own family — not assumed from the FK relationship
  -- alone. Same anti-enumeration wording as set_member_role()'s (0007)
  -- cross-family lookup.
  if target_family is distinct from fam then
    raise exception 'user not found';
  end if;

  if target_removed_at is not null then
    raise exception 'cannot invite a removed profile';
  end if;

  if target_auth_user_id is not null then
    raise exception 'profile is already claimed';
  end if;

  admin_profile := current_profile_id();

  -- Auto-supersede any still-pending invite for this same target — never
  -- two live invites for one profile. Mirrors begin_impersonation()'s own
  -- supersede pattern (0006).
  update family_invites
  set status = 'revoked', revoked_at = now(), revoked_by_user_id = admin_profile
  where target_user_id = p_target_user_id and status = 'pending';

  -- Generate the raw token server-side. base64url = standard base64 with
  -- '+' -> '-', '/' -> '_' and padding stripped, so it is URL-safe without
  -- any percent-encoding.
  --
  -- 0009 FIX: schema-qualified extensions.gen_random_bytes(...) — see the
  -- migration header comment. On the live Supabase project, pgcrypto's
  -- functions resolve under `extensions`, not `public`; since this function
  -- is `set search_path = public`, the previously-unqualified call could not
  -- resolve there.
  v_raw_token := encode(gen_random_bytes(32), 'base64');
  v_raw_token := replace(replace(v_raw_token, '+', '-'), '/', '_');
  v_raw_token := rtrim(v_raw_token, '=');

  -- 0009 FIX: schema-qualified digest(...) — same reason as
  -- gen_random_bytes above.
  v_token_hash := encode(digest(v_raw_token, 'sha256'), 'hex');
  v_expires_at := now() + interval '72 hours';

  insert into family_invites (
    family_id, target_user_id, token_hash,
    created_by_user_id, created_by_auth_user_id, expires_at
  ) values (
    fam, p_target_user_id, v_token_hash,
    admin_profile, auth.uid(), v_expires_at
  ) returning family_invites.id into new_id;

  -- Never the token — only the invite's own row id.
  perform log_audit_event(
    fam, admin_profile, 'invite_created', 'user', p_target_user_id,
    jsonb_build_object('invite_id', new_id, 'expires_at', v_expires_at)
  );

  return query select new_id, v_raw_token, v_expires_at;
end;
$$ language plpgsql volatile security definer set search_path = public, extensions;

-- ----------------------------------------------------------------------------
-- inspect_family_invite(p_token text) — pgcrypto-qualified
--
-- Identical to 0008's definition except
-- `v_token_hash := encode(digest(p_token, 'sha256'), 'hex');`, which now
-- reads `digest(...)`.
-- ----------------------------------------------------------------------------

create or replace function inspect_family_invite(p_token text)
returns table (
  family_name text,
  target_name text,
  target_avatar text,
  status text,
  expires_at timestamptz
) as $$
declare
  v_token_hash text;
begin
  if p_token is null or length(p_token) = 0 then
    raise exception 'invite not found';
  end if;

  -- 0009 FIX: schema-qualified digest(...) — see the migration
  -- header comment.
  v_token_hash := encode(digest(p_token, 'sha256'), 'hex');

  return query
  select
    f.name,
    u.name,
    u.avatar,
    case when fi.status = 'pending' and fi.expires_at <= now() then 'expired' else fi.status end,
    fi.expires_at
  from family_invites fi
  join families f on f.id = fi.family_id
  join users u on u.id = fi.target_user_id
  where fi.token_hash = v_token_hash;

  if not found then
    raise exception 'invite not found';
  end if;
end;
$$ language plpgsql stable security definer set search_path = public, extensions;

-- ----------------------------------------------------------------------------
-- redeem_family_invite(p_token text) — pgcrypto-qualified
--
-- Identical to 0008's definition except
-- `v_token_hash := encode(digest(p_token, 'sha256'), 'hex');`, which now
-- reads `digest(...)`.
-- ----------------------------------------------------------------------------

create or replace function redeem_family_invite(p_token text)
returns table (family_id uuid, family_name text, target_user_id uuid) as $$
declare
  v_token_hash text;
  inv record;
  target_family uuid;
  target_removed_at timestamptz;
  target_auth_user_id uuid;
  v_caller_family uuid;
  v_existing_role text;
  v_updated_count int;
  v_family_name text;
begin
  if auth.uid() is null then
    raise exception 'must be authenticated';
  end if;

  if p_token is null or length(p_token) = 0 then
    raise exception 'invite not found';
  end if;

  -- 0009 FIX: schema-qualified digest(...) — see the migration
  -- header comment.
  v_token_hash := encode(digest(p_token, 'sha256'), 'hex');

  -- Row-level lock: serializes concurrent redemption attempts of this exact
  -- token. The second (losing) transaction blocks here until the first
  -- commits, then re-reads a fully up-to-date, already-'redeemed' row below.
  select * into inv from family_invites where token_hash = v_token_hash for update;

  if inv.id is null then
    raise exception 'invite not found';
  end if;

  if inv.status = 'revoked' then
    raise exception 'invite was revoked';
  end if;

  if inv.status = 'redeemed' then
    raise exception 'invite already used';
  end if;

  -- inv.status = 'pending' at this point. Expiry is DERIVED, never a
  -- persisted status (correction round 7) — enforced directly here.
  if inv.expires_at <= now() then
    raise exception 'invite expired';
  end if;

  -- Re-read the target fresh — never trust anything cached from
  -- invite-creation time (closes the "member state changed since invite
  -- creation" case, design §5). Table-qualified (users.*) because this
  -- function's RETURNS TABLE declares OUT parameters literally named
  -- `family_id`/`target_user_id`, which would otherwise make a bare
  -- `family_id` reference here ambiguous (same class of issue as
  -- create_family_invite above).
  select users.family_id, users.removed_at, users.auth_user_id
    into target_family, target_removed_at, target_auth_user_id
  from users
  where users.id = inv.target_user_id;

  if target_family is null then
    raise exception 'target profile is not available for this invite';
  end if;

  -- CORRECTION ROUND 3: explicit re-check, at redemption time, that the
  -- target still belongs to the invite's own family — not assumed from the
  -- FK relationship alone.
  if target_family is distinct from inv.family_id then
    raise exception 'target profile is not available for this invite';
  end if;

  if target_removed_at is not null then
    raise exception 'target profile is not available for this invite';
  end if;

  if target_auth_user_id is not null then
    raise exception 'target profile is not available for this invite';
  end if;

  -- CORRECTION ROUND 2: fail-closed collision guard. Redemption is
  -- onboarding for a fresh device only — never a family-switching or
  -- account-merging operation. No reassignment, no second-profile claim.
  v_caller_family := current_family_id();
  if v_caller_family is not null and v_caller_family is distinct from inv.family_id then
    raise exception 'account already belongs to a different family';
  end if;

  if exists (
    select 1 from users where auth_user_id = auth.uid() and id <> inv.target_user_id
  ) then
    raise exception 'account already has a claimed profile';
  end if;

  -- Insert-only join for the common case (caller has no family_auth_members
  -- row yet). The ON CONFLICT branch only ever fires when the caller is
  -- already a member of THIS SAME family (the only case the collision guard
  -- above allows to reach here) — it preserves whatever role the device
  -- already had rather than granting or revoking anything, so this upsert
  -- can never be how an invite grants admin (mirrors join_family()'s own
  -- "keep admin if already admin of same family" upsert shape from 0003).
  insert into family_auth_members (auth_user_id, family_id, role)
  values (auth.uid(), inv.family_id, 'member')
  on conflict (auth_user_id) do update
    set family_id = excluded.family_id,
        role = family_auth_members.role;

  -- Reused verbatim from claim_family_profile() (0004): guarded UPDATE +
  -- ROW_COUNT check is the atomic source of truth for the claim, closing
  -- the same TOCTOU race that function's own "REVISION NOTE 2" documents.
  -- Table-qualified for the same OUT-parameter-collision reason as above.
  update users
  set auth_user_id = auth.uid()
  where users.id = inv.target_user_id
    and users.family_id = inv.family_id
    and users.removed_at is null
    and users.auth_user_id is null;

  get diagnostics v_updated_count = row_count;

  if v_updated_count = 0 then
    raise exception 'target profile is not available for this invite';
  end if;

  update family_invites
  set status = 'redeemed', redeemed_at = now(), redeemed_by_auth_user_id = auth.uid()
  where id = inv.id;

  -- Actor is the claimed profile itself, consistent with how
  -- claim_family_profile-adjacent audit events attribute elsewhere in the
  -- schema (audit_user_profile_change()'s 'profile_claimed', 0005). Never
  -- the token — only invite_id.
  perform log_audit_event(
    inv.family_id, inv.target_user_id, 'invite_redeemed', 'user', inv.target_user_id,
    jsonb_build_object('invite_id', inv.id)
  );

  select f.name into v_family_name from families f where f.id = inv.family_id;

  return query select inv.family_id, v_family_name, inv.target_user_id;
end;
$$ language plpgsql volatile security definer set search_path = public, extensions;
