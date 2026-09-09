import { supabase, SupabaseNotConfiguredError } from './supabase';

/**
 * Round 2: thin client wrapper over the five deployed migration-0008
 * family-invite RPCs (supabase/migrations/0008_family_invites.sql).
 *
 * Deliberately Supabase-only, following the exact precedent of lib/family.ts
 * and lib/requests.ts: every invite operation is server-authoritative (all
 * real authorization — admin-only create/revoke/list, impersonation
 * rejection, target eligibility, family matching, collision guards, role
 * assignment — is enforced fresh inside the RPCs, never here) and MUST NOT be
 * routed through OfflineFirstRepository/LocalRepository/SyncQueue. Queuing a
 * create/revoke/redeem as "already applied" offline could show a false
 * success for something that never actually happened server-side (the same
 * reasoning lib/family.ts's setMemberRole and lib/requests.ts's approval
 * RPCs already document). In local/demo mode (no Supabase configured) every
 * function here throws SupabaseNotConfiguredError; calling UI is expected to
 * catch that and show a clear "not available in demo mode" message, matching
 * every other Supabase-only workflow in this app.
 *
 * This module intentionally does not import AsyncStorage, the Zustand store,
 * LocalRepository, or SyncQueue — there is nothing here for the raw invite
 * token to leak into even by accident (see the token-handling note on
 * redeemFamilyInvite/createFamilyInvite below).
 */

function requireSupabase() {
  if (!supabase) throw new SupabaseNotConfiguredError();
  return supabase;
}

// ---------------------------------------------------------------------------
// Types
//
// Deliberately separate shapes for each RPC result rather than one shared
// "invite" type — the five RPCs expose five different, intentionally narrow
// slices of the underlying family_invites row (see 0008's own header
// comment on why token_hash can never be redacted column-by-column via RLS
// and instead simply never leaves the server via any of these functions'
// return signatures). None of these types has a token_hash field, ever.
// ---------------------------------------------------------------------------

/** Persisted status values only — never includes 'expired' (that's derived, see EffectiveInviteStatus below). */
export type InviteStatus = 'pending' | 'redeemed' | 'revoked';

/** The status as the server actually reports it in list/inspect results: persisted status, or 'expired' derived server-side from status='pending' AND expires_at <= now(). Matches list_family_invites()/inspect_family_invite()'s own `case when ... then 'expired' else status end` — this client never recomputes expiry itself. */
export type EffectiveInviteStatus = InviteStatus | 'expired';

/**
 * Result of create_family_invite(p_target_user_id). Contains the raw,
 * one-time invite token — this is the ONLY place in this module's public
 * API where a raw token appears in a return value, because the immediate
 * caller needs it for the not-yet-built QR/share step (Round 3+). Callers
 * must not persist `rawToken` anywhere durable (AsyncStorage, Zustand,
 * LocalRepository, SyncQueue) — see the module-level doc comment.
 */
export interface CreatedFamilyInvite {
  id: string;
  rawToken: string;
  expiresAt: string;
}

/** One row from list_family_invites() — metadata only, no token/token_hash by construction (the RPC's own return signature has no such column). */
export interface FamilyInviteListItem {
  inviteId: string;
  targetUserId: string;
  targetName: string;
  targetAvatar: string | null;
  status: EffectiveInviteStatus;
  expiresAt: string;
  createdAt: string;
}

/** Result of inspect_family_invite(p_token) — the narrow pre-redemption preview: no family_id, no raw token, no token_hash. */
export interface FamilyInvitePreview {
  familyName: string;
  targetName: string;
  targetAvatar: string | null;
  status: EffectiveInviteStatus;
  expiresAt: string;
}

/** One member of the family shown in a still-pending invite's detailed preview — see FamilyInvitePreviewDetail. */
export interface FamilyInvitePreviewMember {
  name: string;
  avatar: string;
  photoUrl: string | null;
}

/**
 * BATCH 4 (item D) — result of inspect_family_invite_detail(p_token), the
 * enriched sibling of FamilyInvitePreview: adds the family dog's real
 * name/photo and the family's member list (real photos where available) —
 * ONLY populated while the invite is still genuinely pending/unexpired (see
 * migration 0028's security reasoning); a revoked/redeemed/expired invite
 * gets `dogName`/`dogPhotoUrl` null and `members` null, same minimal shape
 * inspect_family_invite() always had.
 */
export interface FamilyInvitePreviewDetail extends FamilyInvitePreview {
  dogName: string | null;
  dogPhotoUrl: string | null;
  members: FamilyInvitePreviewMember[] | null;
}

/** Result of redeem_family_invite(p_token) — the family the caller's device just joined and the profile it just claimed. */
export interface RedeemedFamilyInvite {
  familyId: string;
  familyName: string;
  targetUserId: string;
}

// ---------------------------------------------------------------------------
// RPC wrappers
// ---------------------------------------------------------------------------

/**
 * Admin-only (enforced server-side by the impersonation-aware
 * is_family_admin() inside create_family_invite() — this wrapper performs no
 * authorization of its own, see the module doc comment). Creates a
 * member-specific invite for an existing, active, unclaimed profile in the
 * caller's own family; superseding any still-pending invite for the same
 * target. TTL is fixed at 72 hours server-side — there is no ttl parameter.
 *
 * TOKEN SAFETY: the returned `rawToken` must be used immediately for the
 * caller's own purpose (Round 3+ share/QR step) and never logged, persisted,
 * or included in any diagnostic/telemetry. This function itself never logs
 * or persists it.
 */
export async function createFamilyInvite(targetUserId: string): Promise<CreatedFamilyInvite> {
  const client = requireSupabase();
  const { data, error } = await client.rpc('create_family_invite', { p_target_user_id: targetUserId });
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) throw new Error('יצירת ההזמנה נכשלה');
  return { id: row.id, rawToken: row.raw_token, expiresAt: row.expires_at };
}

/**
 * Admin-only (impersonation-aware is_family_admin(), same as
 * createFamilyInvite). Idempotent on an already-revoked/redeemed invite —
 * revoke_family_invite() returns void without raising in that case, mirroring
 * reject_swap_request()'s idempotent pattern.
 */
export async function revokeFamilyInvite(inviteId: string): Promise<void> {
  const client = requireSupabase();
  const { error } = await client.rpc('revoke_family_invite', { p_invite_id: inviteId });
  if (error) throw error;
}

/**
 * Admin-only (impersonation-aware is_family_admin(), same as create/revoke).
 * Returns every invite (any status) for the caller's own family, newest
 * first — status is the server-derived EffectiveInviteStatus, so this client
 * never recomputes 'expired' itself (see list_family_invites()'s own `case
 * when ... then 'expired'` in 0008).
 */
export async function listFamilyInvites(): Promise<FamilyInviteListItem[]> {
  const client = requireSupabase();
  const { data, error } = await client.rpc('list_family_invites');
  if (error) throw error;
  const rows = (data ?? []) as Array<{
    invite_id: string;
    target_user_id: string;
    target_name: string;
    target_avatar: string | null;
    status: EffectiveInviteStatus;
    expires_at: string;
    created_at: string;
  }>;
  return rows.map((row) => ({
    inviteId: row.invite_id,
    targetUserId: row.target_user_id,
    targetName: row.target_name,
    targetAvatar: row.target_avatar ?? null,
    status: row.status,
    expiresAt: row.expires_at,
    createdAt: row.created_at,
  }));
}

/**
 * No membership/admin requirement (mirrors findFamilyByInviteCode()'s
 * deliberately narrow, no-membership-required design) — the "what am I
 * about to join" preview a not-yet-authenticated-as-member device shows
 * before redeeming. Does not consume or lock the invite; safe to call
 * repeatedly. Never returns the raw token or token_hash.
 */
export async function inspectFamilyInvite(token: string): Promise<FamilyInvitePreview> {
  const client = requireSupabase();
  const { data, error } = await client.rpc('inspect_family_invite', { p_token: token });
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) throw new Error('ההזמנה לא נמצאה');
  return {
    familyName: row.family_name,
    targetName: row.target_name,
    targetAvatar: row.target_avatar ?? null,
    status: row.status,
    expiresAt: row.expires_at,
  };
}

/**
 * BATCH 4 (item D) — the enriched sibling of inspectFamilyInvite() above:
 * same no-membership-required, safe-to-call-repeatedly, never-consumes-the-
 * invite contract, plus the family dog's real photo and member list (real
 * photos where available) for a still-pending/unexpired invite. See
 * migration 0028's header comment for the full security reasoning on why
 * this is a safe, additive enrichment of an already-narrow, single-use,
 * server-verified disclosure boundary — and why it does NOT touch
 * findFamilyByInviteCode()'s deliberately minimal short-code lookup.
 */
export async function inspectFamilyInviteDetail(token: string): Promise<FamilyInvitePreviewDetail> {
  const client = requireSupabase();
  const { data, error } = await client.rpc('inspect_family_invite_detail', { p_token: token });
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) throw new Error('ההזמנה לא נמצאה');
  const members = Array.isArray(row.members)
    ? (row.members as Array<{ name: string; avatar: string; photoUrl: string | null }>).map((m) => ({
        name: m.name,
        avatar: m.avatar,
        photoUrl: m.photoUrl ?? null,
      }))
    : null;
  return {
    familyName: row.family_name,
    targetName: row.target_name,
    targetAvatar: row.target_avatar ?? null,
    status: row.status,
    expiresAt: row.expires_at,
    dogName: row.dog_name ?? null,
    dogPhotoUrl: row.dog_photo_url ?? null,
    members,
  };
}

/**
 * Onboarding for a fresh device only (correction round 2 — see 0008): fails
 * closed, with no reassignment and no second-profile claim, if the caller's
 * device already belongs to a different family or already owns a different
 * claimed profile anywhere. Always grants role='member' server-side; there
 * is no client input that can change that. Atomically performs family
 * membership + profile claim + invite consumption in one RPC call.
 *
 * TOKEN SAFETY: `token` is passed through as a plain RPC argument and never
 * logged or persisted by this function.
 */
export async function redeemFamilyInvite(token: string): Promise<RedeemedFamilyInvite> {
  const client = requireSupabase();
  const { data, error } = await client.rpc('redeem_family_invite', { p_token: token });
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) throw new Error('הצטרפות למשפחה נכשלה');
  return { familyId: row.family_id, familyName: row.family_name, targetUserId: row.target_user_id };
}
