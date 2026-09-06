-- ============================================================================
-- 0008_family_invites.sql
--
-- Round 1 of the Family Invite feature, implemented exactly per the revised
-- FAMILY_INVITE_DESIGN.md (the corrected revision incorporating all 9
-- required corrections). Migrations 0001-0007 are already deployed and are
-- NOT touched by this file — everything here is additive: one new table
-- (family_invites) and five new SECURITY DEFINER functions
-- (create_family_invite, revoke_family_invite, list_family_invites,
-- inspect_family_invite, redeem_family_invite). No existing function is
-- redefined.
--
-- Member-specific invites only (design §2, Model B): an invite is always
-- bound to one specific, existing, unclaimed `users` row (target_user_id) —
-- never a family-wide "anyone can join and pick a profile" mechanism.
--
-- Sections:
--   1. family_invites table, indexes, RLS (enabled, zero client policies).
--   2. create_family_invite(p_target_user_id uuid)
--   3. revoke_family_invite(p_invite_id uuid)
--   4. list_family_invites()
--   5. inspect_family_invite(p_token text)
--   6. redeem_family_invite(p_token text)
--
-- Key invariants carried over verbatim from the design (see the design doc
-- for full rationale on each):
--   - create_family_invite/revoke_family_invite/list_family_invites all
--     require the impersonation-aware is_family_admin() (NOT
--     is_real_family_admin()) — these RPCs FAIL SERVER-SIDE while an admin
--     is impersonating a member. Client hiding is never the authorization
--     boundary (correction round 1).
--   - target_user.family_id = invite.family_id is explicitly re-verified in
--     both create_family_invite (against the freshly-read target row) and
--     redeem_family_invite (against the freshly-read target row, re-checked
--     at redemption time) — never assumed from the two independent foreign
--     keys alone (correction round 3).
--   - redeem_family_invite fails closed on both collision cases: the caller
--     already belonging to a different family, or the caller already owning
--     a different claimed profile anywhere — no silent reassignment, no
--     second-profile claim (correction round 2).
--   - Redemption always grants role='member'; there is no code path that can
--     ever write role='admin' from an invite.
--   - The raw token is generated once, inside Postgres, returned to the
--     caller once, and NEVER stored — only token_hash (sha-256, hex-encoded)
--     is persisted. list_family_invites() never returns token_hash or the
--     raw token (correction round 4).
--   - TTL is fixed at exactly 72 hours, computed server-side. There is no
--     p_ttl_hours parameter (correction round 6).
--   - Persisted status is only 'pending' | 'redeemed' | 'revoked'. 'expired'
--     is DERIVED (status = 'pending' and expires_at <= now()) wherever it is
--     surfaced — never written by any function, never requires a scheduled
--     job (correction round 7).
--   - Creating a new invite for a target that already has a pending invite
--     supersedes (revokes) the old one first — at most one live invite per
--     target profile.
--   - redeem_family_invite performs the family-membership insert, the
--     profile claim, and the invite consumption atomically in one
--     transaction — all-or-nothing, never a partial "joined but didn't
--     claim" state.
--   - Concurrent redemption of the same token is serialized via
--     `select ... for update` on the invite row (the design's own
--     conclusion: this lock is sufficient by itself, mirroring
--     approve_swap_request()'s existing pattern) plus the guarded
--     UPDATE + ROW_COUNT claim pattern reused verbatim from
--     claim_family_profile() (0004) as a second-layer backstop.
--   - No raw token ever reaches log_audit_event() — only invite_id.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. family_invites
--
-- RLS enabled, ZERO client policies — mirrors impersonation_sessions'/
-- audit_log's own pattern (0006/0005): token_hash must never be readable by
-- any authenticated device, and RLS cannot redact a single column from an
-- otherwise-visible row (only whole rows), so a policy-based "show admins
-- their own family's invites but hide token_hash" is not expressible safely.
-- All reads and writes go through the SECURITY DEFINER functions below.
--
-- No FK from created_by_auth_user_id/redeemed_by_auth_user_id to auth.users
-- — same convention as impersonation_sessions.admin_auth_user_id (0006):
-- these are plain uuid columns, not FK-constrained, since a device's
-- underlying anon auth.users row is not something this feature needs to
-- cascade against.
-- ----------------------------------------------------------------------------

create table if not exists family_invites (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references families(id) on delete cascade,
  target_user_id uuid not null references users(id) on delete cascade,
  token_hash text not null,
  created_by_user_id uuid references users(id) on delete set null,
  created_by_auth_user_id uuid not null,
  -- 'expired' is deliberately NOT a persisted value here (correction round
  -- 7) — see the header comment above and every function below, which
  -- derive it as `status = 'pending' and expires_at <= now()` instead of
  -- ever writing it. No scheduled job is required or provided.
  status text not null default 'pending' check (status in ('pending', 'redeemed', 'revoked')),
  expires_at timestamptz not null,
  redeemed_at timestamptz,
  redeemed_by_auth_user_id uuid,
  revoked_at timestamptz,
  revoked_by_user_id uuid references users(id) on delete set null,
  created_at timestamptz not null default now()
);

create unique index if not exists family_invites_token_hash_key on family_invites (token_hash);
create index if not exists family_invites_family_id_idx on family_invites (family_id);
create index if not exists family_invites_target_user_id_idx on family_invites (target_user_id);

alter table family_invites enable row level security;
-- Intentionally zero policies for role `authenticated` — see the comment
-- block above this table. A misconfigured future grant fails closed.

-- ----------------------------------------------------------------------------
-- 2. create_family_invite(p_target_user_id uuid)
--
-- Admin-only (impersonation-aware is_family_admin() — correction round 1:
-- this RPC itself rejects the call while the real admin is impersonating a
-- member, since is_family_admin() already resolves false for the duration
-- of an active impersonation session per 0006). Target must be an existing,
-- active (not removed), unclaimed profile belonging to the caller's own
-- family — target_user.family_id = fam is checked explicitly (correction
-- round 3), not assumed from the FK alone.
--
-- TTL is fixed at exactly 72 hours (correction round 6) — there is no
-- p_ttl_hours parameter.
--
-- Auto-supersede: creating a new invite for a target that already has a
-- pending invite revokes the old one first, so at most one is ever live per
-- target profile — this is also what "regenerate" in the admin UX means
-- (design §8).
--
-- Token: 32 cryptographically random bytes (256 bits) generated with
-- pgcrypto's gen_random_bytes(), base64url-encoded (no padding), returned to
-- the caller exactly once. Only its sha-256 hash (hex-encoded) is persisted
-- — the raw token itself never touches the table (design §5).
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
  v_raw_token := encode(gen_random_bytes(32), 'base64');
  v_raw_token := replace(replace(v_raw_token, '+', '-'), '/', '_');
  v_raw_token := rtrim(v_raw_token, '=');

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
$$ language plpgsql volatile security definer set search_path = public;

-- ----------------------------------------------------------------------------
-- 3. revoke_family_invite(p_invite_id uuid)
--
-- Admin-only (impersonation-aware is_family_admin(), same as
-- create_family_invite — correction round 1). Idempotent on an
-- already-non-pending invite (mirrors reject_swap_request()'s idempotent
-- pattern, 0005/0006) rather than raising.
-- ----------------------------------------------------------------------------

create or replace function revoke_family_invite(p_invite_id uuid)
returns void as $$
declare
  admin_profile uuid;
  inv_family uuid;
  inv_target uuid;
  inv_status text;
begin
  if auth.uid() is null then
    raise exception 'must be authenticated';
  end if;

  select family_id, target_user_id, status
    into inv_family, inv_target, inv_status
  from family_invites
  where id = p_invite_id;

  if inv_family is null then
    raise exception 'invite not found';
  end if;

  -- CORRECTION ROUND 1: impersonation-aware — fails server-side while
  -- impersonating, same reasoning as create_family_invite above.
  if not is_family_admin(inv_family) then
    raise exception 'admin permission required';
  end if;

  if inv_status <> 'pending' then
    return; -- idempotent: already redeemed/revoked, nothing to do
  end if;

  admin_profile := current_profile_id();

  update family_invites
  set status = 'revoked', revoked_at = now(), revoked_by_user_id = admin_profile
  where id = p_invite_id;

  perform log_audit_event(
    inv_family, admin_profile, 'invite_revoked', 'user', inv_target,
    jsonb_build_object('invite_id', p_invite_id)
  );
end;
$$ language plpgsql volatile security definer set search_path = public;

-- ----------------------------------------------------------------------------
-- 4. list_family_invites()
--
-- New in this revision (correction round 4 — was referenced but never
-- defined in the original design pass). Admin-only (impersonation-aware
-- is_family_admin(), same as create/revoke — correction round 1). Metadata
-- only: NEVER returns token_hash or the raw token, by construction (the
-- return signature has no such column, and the query never selects it into
-- anything client-visible). 'status' is the DERIVED status (correction
-- round 7) — a raw 'pending' row past its expires_at is reported as
-- 'expired' here without ever having been written that way.
-- ----------------------------------------------------------------------------

create or replace function list_family_invites()
returns table (
  invite_id uuid,
  target_user_id uuid,
  target_name text,
  target_avatar text,
  status text,
  expires_at timestamptz,
  created_at timestamptz
) as $$
declare
  fam uuid;
begin
  if auth.uid() is null then
    raise exception 'must be authenticated';
  end if;

  fam := current_family_id();
  if fam is null then
    raise exception 'this device is not a member of a family';
  end if;

  -- CORRECTION ROUND 1: impersonation-aware — an admin mid-impersonation
  -- cannot browse their family's invite list any more than they can create
  -- or revoke one, for the same reason admin_list_audit_log() (0006) is
  -- already suppressed during impersonation.
  if not is_family_admin(fam) then
    raise exception 'admin permission required';
  end if;

  return query
  select
    fi.id,
    fi.target_user_id,
    u.name,
    u.avatar,
    case when fi.status = 'pending' and fi.expires_at <= now() then 'expired' else fi.status end,
    fi.expires_at,
    fi.created_at
  from family_invites fi
  join users u on u.id = fi.target_user_id
  where fi.family_id = fam
  order by fi.created_at desc;
end;
$$ language plpgsql stable security definer set search_path = public;

-- ----------------------------------------------------------------------------
-- 5. inspect_family_invite(p_token text)
--
-- No membership/admin requirement — the pre-redemption "what am I about to
-- join" preview, mirroring find_family_by_invite_code()'s (0002)
-- deliberately narrow, no-membership-required design. Returns only what the
-- invited person needs to decide whether to proceed: family name, target
-- member's display name/avatar, DERIVED status, expiry — never family_id,
-- never any other member's data, never the token back. Does not consume or
-- lock the invite — safe to call repeatedly.
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
$$ language plpgsql stable security definer set search_path = public;

-- ----------------------------------------------------------------------------
-- 6. redeem_family_invite(p_token text)
--
-- Performs the join_family-equivalent AND the claim_family_profile-
-- equivalent atomically, inside one transaction. Onboarding for a fresh
-- device only (correction round 2) — fails closed, with NO reassignment and
-- NO second-profile claim, if the caller's device already belongs to a
-- different family or already owns a different claimed profile anywhere.
--
-- Concurrency: `select ... for update` on the invite row serializes two
-- simultaneous redemption attempts of the SAME token (mirrors
-- approve_swap_request()'s own `for update` pattern, 0005/0006) — the
-- design's own conclusion is that this lock is sufficient by itself. The
-- guarded UPDATE + ROW_COUNT claim pattern from claim_family_profile()
-- (0004) is reused verbatim as a second, independent backstop on the
-- `users` row itself.
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
$$ language plpgsql volatile security definer set search_path = public;
