-- 0040_prevent_cross_family_membership_overwrite.sql
--
-- REAL BUG FIX (security/data-integrity: silent, irreversible family-
-- membership loss), found by direct inspection following up on this
-- campaign's own established pattern of auditing current_family_id()-
-- dependent guards after migration 0033 changed its resolution semantics:
--
-- 0033 redefined current_family_id() to resolve ONLY families with
-- approval_status = 'active' -- by design, so a pending/rejected family's
-- creator does not get treated as a full member anywhere that gates on
-- current_family_id(). But redeem_family_invite()'s (0008/0009, current
-- applied definition) own "account already belongs to a different family"
-- collision guard (CORRECTION ROUND 2, its own comment) resolves the
-- caller's existing membership via `v_caller_family := current_family_id();`
-- -- so for a verified admin whose own family_auth_members row points at a
-- still-pending or already-rejected family, that guard silently sees NULL
-- and never fires. join_family() (0002/0003/0033, current applied
-- definition) never had an equivalent guard at all.
--
-- CONCRETE REACHABLE SCENARIO: a prospective admin completes email-OTP
-- verification and calls create_verified_family() (0032), which inserts
-- this device's family_auth_members row as (auth_user_id, family_id = A,
-- role = 'admin') immediately, before any System Admin approval.
-- FamilyOnboardingScreen.tsx's pending/rejected recovery screens
-- (src/screens/FamilyOnboardingScreen.tsx, the get_my_family_onboarding_
-- status()-driven mount effect) both show a "חזרה" button that calls
-- setMode('choose') -- from there the same still-signed-in device can pick
-- "הצטרפות למשפחה קיימת" and enter a different, already-active family B's
-- invite code. join_family()'s `insert ... on conflict (auth_user_id) do
-- update set family_id = excluded.family_id, role = ...` (family_auth_
-- members.auth_user_id is the primary key, one row per auth identity) then
-- silently OVERWRITES this device's row: family_id flips from A to B,
-- role drops to 'member'. The device's only link to family A -- the family
-- it created, whose onboarding request/dog/settings already exist -- is
-- permanently destroyed with no confirmation, warning, or audit trail. If
-- family A is later approved, it is now a fully orphaned family with no
-- members at all, and the original creator has no way back into it. The
-- same reachability applies to redeem_family_invite()'s "יש לי הזמנה" flow
-- for a member-specific invite into a different family, for the same
-- current_family_id()-blind-spot reason.
--
-- Under the pre-verified-auth device model this was a low-stakes upsert (a
-- device's own local family_auth_members row was disposable). Under the
-- verified-auth model an auth_user_id is a persistent identity, and losing
-- family membership is real, irreversible data loss -- exactly the risk
-- redeem_family_invite()'s own existing guard was written to prevent
-- (0008/0009's own comment: "onboarding for a fresh device only -- never a
-- family-switching or account-merging operation"), just undermined by
-- 0033's current_family_id() redefinition for the pending/rejected case.
--
-- FIX: both functions now resolve the caller's existing membership via a
-- DIRECT `select family_id from family_auth_members where auth_user_id =
-- auth.uid()` -- never through current_family_id(), which hides
-- pending/rejected memberships by design -- and reject the call whenever
-- that existing family_id differs from the target family, regardless of
-- the existing family's approval_status. Joining/redeeming again for the
-- SAME family (the ordinary re-scan/already-a-member case both functions
-- already supported) is unaffected. Both functions' signatures are
-- unchanged, so CREATE OR REPLACE is safe here -- no drop needed, existing
-- grants are preserved automatically. Neither 0033 (join_family) nor 0009
-- (redeem_family_invite) is edited, per rule 8 -- both are left untouched
-- as applied migrations; this migration supersedes them with CREATE OR
-- REPLACE.

create or replace function join_family(code text)
returns table (id uuid, name text)
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_family_id uuid;
  v_caller_family uuid;
begin
  if auth.uid() is null then
    raise exception 'must be authenticated to join a family';
  end if;

  select f.id into v_family_id
  from families f
  where upper(f.invite_code) = upper(code)
    and f.approval_status = 'active'
  limit 1;

  if v_family_id is null then
    raise exception 'invalid invite code';
  end if;

  -- NEW (0040): resolved directly against family_auth_members, never via
  -- current_family_id() -- see migration header for why that matters for a
  -- caller whose own family is currently pending/rejected.
  select family_id into v_caller_family
  from family_auth_members
  where auth_user_id = auth.uid();

  if v_caller_family is not null and v_caller_family is distinct from v_family_id then
    raise exception 'account already belongs to a different family';
  end if;

  insert into family_auth_members (auth_user_id, family_id, role)
  values (auth.uid(), v_family_id, 'member')
  on conflict (auth_user_id) do update set
    family_id = excluded.family_id,
    role = case
      when family_auth_members.family_id = excluded.family_id
       and family_auth_members.role = 'admin'
      then 'admin' else 'member' end;

  return query select f.id, f.name from families f where f.id = v_family_id;
end;
$$;

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

  -- 0009 FIX: schema-qualified extensions.digest(...) — see the migration
  -- header comment.
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
  -- account-merging operation.
  --
  -- NEW (0040): resolved directly against family_auth_members, NOT via
  -- current_family_id() — current_family_id() (0033) only resolves ACTIVE
  -- families, so a caller whose own membership is in a still-pending or
  -- already-rejected family previously read as NULL here and silently
  -- bypassed this guard. See migration header for the full reachable
  -- scenario this closes.
  select family_id into v_caller_family
  from family_auth_members
  where auth_user_id = auth.uid();

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
