-- 0101_fix_redeem_invite_profile_session.sql
--
-- P0 FIX — real-device QA on the HTTPS invite-link repair found that
-- pressing "הצטרפות" (Join) after a successful invite inspection always
-- failed client-side verification with a "mismatch" error, even though the
-- invite was shown as valid and redeem_family_invite() itself raised no
-- exception.
--
-- ROOT CAUSE (confirmed by reading every redefinition of the functions
-- involved, in migration order — no live log access needed):
--
--   - real_current_profile_id() — the function whoami()'s `real_profile_id`
--     (and therefore current_profile_id()/is_family_admin()/every RLS
--     policy and RPC authorization check in this schema) is ultimately
--     derived from — was redefined by 0020_multi_device_profile_sessions.sql
--     to resolve EXCLUSIVELY from the new `profile_auth_sessions` table
--     (one row per auth_user_id, written by claim_family_profile()/
--     claim_family_profile_with_pin()), no longer from `users.auth_user_id`
--     directly.
--   - redeem_family_invite() (0008, pgcrypto-qualified in 0009) predates
--     0020 and was NEVER updated when 0020 landed: it still only writes
--     `users.auth_user_id` and `family_auth_members`, and never inserts a
--     `profile_auth_sessions` row.
--
-- Consequence: EVERY invite redemption since 0020 shipped has succeeded
-- server-side (status flips to 'redeemed', users.auth_user_id is set,
-- family_auth_members gets a row) while leaving the claim permanently
-- invisible to real_current_profile_id() — whoami() forever reports
-- real_profile_id = null for that device, which authStore.ts's
-- verifyAndCommitPendingRedemption() (correctly, given that signal) reads
-- as a confirmed identity mismatch and refuses to commit. This was not a
-- timing/race condition; it reproduces deterministically on every
-- redemption.
--
-- FIX, two parts, both additive and authorization-neutral — no RLS policy,
-- admin check, or collision guard is loosened; this only completes the
-- SAME claim redeem_family_invite() already performs atomically, in the
-- shape the identity-resolution layer has required since 0020:
--
--   1. redeem_family_invite() now also upserts into profile_auth_sessions
--      (mirroring claim_family_profile()'s own insert shape exactly),
--      inside the same transaction as its existing writes — so a NEW
--      redemption is correctly visible to real_current_profile_id()
--      immediately.
--   2. whoami() self-heals a device stuck in the already-broken state
--      (like this real QA case): if it has no profile_auth_sessions row
--      yet but a `users` row already names its auth.uid() as the claimant
--      (the old, pre-0020 signal redeem_family_invite() always wrote),
--      the missing session row is backfilled before resolving the result.
--      This requires NO new invite and NO admin action — the device's own
--      next whoami() call (retryPendingInviteRedemptionVerification(), or
--      simply reopening the app) repairs and resolves correctly in one
--      step. Idempotent (ON CONFLICT DO NOTHING) and narrowly scoped: it
--      only ever backfills a session for the CALLER's own auth.uid(), from
--      a `users` row that already and unambiguously names that exact
--      auth.uid() as its claimant — it never grants or infers anything
--      beyond what a prior successful server-side claim already
--      established.
--
-- whoami() also now additionally returns `family_id` (current_family_id()),
-- so a client-side recovery path can re-derive a fully-local session
-- (familyId + currentUserId) from server truth alone when local storage
-- has nothing cached — see authStore.ts's restoreSession().
--
-- whoami()'s signature changed (added column), so it must be dropped
-- before being recreated (same pattern as 0018/0036's own
-- `drop function if exists ...` for a changed-signature redefinition) —
-- `create or replace function` cannot change a function's return type.
-- ============================================================================

drop function if exists whoami();

create or replace function whoami()
returns table (
  profile_id uuid,
  real_profile_id uuid,
  family_id uuid,
  family_role text,
  is_impersonating boolean,
  impersonated_user_id uuid
) as $$
declare
  v_target uuid;
  v_legacy_user_id uuid;
  v_legacy_family_id uuid;
begin
  -- SELF-HEAL — see this migration's header comment, part 2. Only runs
  -- when this exact caller has no session row yet; a no-op (and cheap:
  -- one indexed existence check) for every already-healthy device.
  if auth.uid() is not null and not exists (
    select 1 from profile_auth_sessions where auth_user_id = auth.uid()
  ) then
    select u.id, u.family_id into v_legacy_user_id, v_legacy_family_id
    from users u
    where u.auth_user_id = auth.uid()
      and u.removed_at is null
    limit 1;

    if v_legacy_user_id is not null then
      insert into profile_auth_sessions (auth_user_id, family_id, user_id, updated_at)
      values (auth.uid(), v_legacy_family_id, v_legacy_user_id, now())
      on conflict (auth_user_id) do nothing;
    end if;
  end if;

  v_target := active_impersonation_target();
  return query select
    coalesce(v_target, real_current_profile_id()) as profile_id,
    real_current_profile_id() as real_profile_id,
    current_family_id() as family_id,
    current_family_role() as family_role,
    (v_target is not null) as is_impersonating,
    v_target as impersonated_user_id;
end;
$$ language plpgsql volatile security definer set search_path = public;

-- redeem_family_invite(p_token text) — identical to 0009's definition
-- except the new profile_auth_sessions guard+upsert (part 1 of the fix
-- above), inserted after the existing collision checks and before the
-- family_auth_members upsert, and the new users.auth_user_id guarded
-- UPDATE immediately after it (both unchanged from 0009).
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

  v_token_hash := encode(extensions.digest(p_token, 'sha256'), 'hex');

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

  -- 0101 FIX: same fail-closed shape as claim_family_profile()'s own
  -- "profile already claimed by another device" guard (0020) — this
  -- device's redemption must never silently steal another device's
  -- existing profile_auth_sessions claim on this exact target. In
  -- practice an invite-eligible target (see isMemberInviteEligible()'s
  -- server-side mirror, the target_auth_user_id is null check above)
  -- should never already have one, but this fails closed rather than
  -- assuming that invariant holds forever.
  if exists (
    select 1 from profile_auth_sessions
    where user_id = inv.target_user_id
      and auth_user_id <> auth.uid()
  ) then
    raise exception 'target profile is not available for this invite';
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

  -- 0101 FIX (part 1 — see this migration's header comment): the actual
  -- root-cause fix. Mirrors claim_family_profile()'s own insert shape
  -- (0020) exactly, so this device's claim is immediately visible to
  -- real_current_profile_id() / whoami() / every RLS policy and RPC
  -- authorization check that resolves through current_profile_id() —
  -- without this, the claim above is invisible to all of them, which is
  -- exactly the bug this migration fixes.
  insert into profile_auth_sessions (auth_user_id, family_id, user_id, updated_at)
  values (auth.uid(), inv.family_id, inv.target_user_id, now())
  on conflict (auth_user_id) do update
    set family_id = excluded.family_id,
        user_id = excluded.user_id,
        updated_at = now();

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
