import type { EffectiveInviteStatus, FamilyInviteListItem } from '../lib/invites';

/**
 * Round 3 — pure decision logic behind the admin invite-creation/management
 * UI (MemberDetailsModal's "הזמנה להצטרפות" section, FamilyScreen's wiring).
 * Framework-agnostic (no React/React Native imports), matching every other
 * file in src/logic — see presence.ts/familyManagement.ts for the same
 * pattern. The server (migrations/0008_family_invites.sql) remains the
 * actual authorization boundary regardless of anything here; this file only
 * decides what the UI shows/offers so an admin isn't walked into a flow
 * that would just get rejected server-side.
 */

// ----------------------------------------------------------------------------
// Eligibility
// ----------------------------------------------------------------------------

export interface InviteEligibilityInput {
  /**
   * "Is the CURRENT VIEWER a real, non-impersonating admin" — the exact same
   * value FamilyScreen already computes via isRealFamilyAdmin() (authStore.ts)
   * for role management (MemberDetailsModal's `canManageRoles` prop). Reused
   * here rather than re-deriving familyRole/impersonatingUserId separately,
   * so "hidden while impersonating" and "hidden for a non-admin" are the
   * exact same real-admin gate the rest of this screen already relies on —
   * not a second, potentially-divergent copy of that decision.
   */
  isRealAdmin: boolean;
  /** The target member's removedAt (soft-delete timestamp), or null/undefined if active. */
  targetRemovedAt: string | null | undefined;
  /**
   * The target member's role from admin_list_family_activity()
   * (migrations/0005_*.sql) — `left join family_auth_members fam on
   * fam.auth_user_id = u.auth_user_id`, so this comes back SQL NULL (not
   * 'admin'/'member') whenever the target's `users.auth_user_id` is null,
   * i.e. the profile has never been claimed by any device. This is a direct,
   * structurally-guaranteed consequence of that LEFT JOIN — not a fragile
   * heuristic — so `null`/`undefined` here means "genuinely unclaimed",
   * PROVIDED `activityLoaded` is true (see below).
   */
  targetRole: 'admin' | 'member' | null | undefined;
  /**
   * Whether admin_list_family_activity() has successfully loaded at least
   * once for the current family/viewer. Required so an unresolved/failed/
   * not-yet-fetched load (where `targetRole` is simply `undefined` because
   * no data exists yet, not because the join found nothing) is never
   * mistaken for "confirmed unclaimed" — that would be exactly the kind of
   * invented, fragile heuristic this round's instructions say to avoid.
   * False in local/demo mode too (that data is Supabase-only), which is
   * what naturally keeps the whole invite section out of demo mode without
   * a separate demo-mode-specific check here.
   */
  activityLoaded: boolean;
}

/** Whether the admin invite-creation affordance should be shown/usable for this target member right now. Client UX only — the server re-derives and re-checks every one of these conditions independently on every RPC call (see 0008's create_family_invite()). */
export function isMemberInviteEligible(input: InviteEligibilityInput): boolean {
  if (!input.isRealAdmin) return false;
  if (input.targetRemovedAt) return false;
  if (!input.activityLoaded) return false;
  return input.targetRole == null;
}

/** Whether the invite-management controls (revoke, regenerate) should be shown/usable at all — the same real-admin, non-impersonating gate as creation. */
export function canManageFamilyInvites(isRealAdmin: boolean): boolean {
  return isRealAdmin;
}

// ----------------------------------------------------------------------------
// Status metadata
// ----------------------------------------------------------------------------

/**
 * Hebrew label for the server-provided EFFECTIVE status (list_family_invites()'s
 * own derived `case when status='pending' and expires_at<=now() then
 * 'expired' else status end` — see lib/invites.ts). Never recomputes expiry
 * itself; only relabels whatever the server already decided.
 */
export function inviteStatusLabel(status: EffectiveInviteStatus): string {
  switch (status) {
    case 'pending':
      return 'הזמנה בתוקף';
    case 'expired':
      return 'פגה תוקף';
    case 'redeemed':
      return 'נוצלה';
    case 'revoked':
      return 'בוטלה';
    default:
      return '';
  }
}

/**
 * Reduces list_family_invites()'s full history (every invite ever created
 * for the family, any status) down to the single most-recent invite per
 * target member — the only one relevant for "does this member currently
 * have an invite, and what's its status". Relies on the server's own
 * ordering (`order by fi.created_at desc`, see 0008) rather than re-sorting
 * client-side — the first entry seen per target_user_id in iteration order
 * is therefore already the newest.
 */
export function latestInviteByTarget(items: FamilyInviteListItem[]): Map<string, FamilyInviteListItem> {
  const map = new Map<string, FamilyInviteListItem>();
  for (const item of items) {
    if (!map.has(item.targetUserId)) map.set(item.targetUserId, item);
  }
  return map;
}

// ----------------------------------------------------------------------------
// Regenerate / create wording
// ----------------------------------------------------------------------------

/**
 * True when the create button should read as "regenerate" (a still-relevant
 * prior invite exists) rather than a first-time "create". Purely a wording
 * decision — createFamilyInvite() is the SAME call either way (see
 * lib/invites.ts); the server transparently supersedes/revokes any existing
 * pending invite for the same target (0008's own auto-supersede behavior).
 * A 'redeemed' invite never reaches here in practice (the member would no
 * longer be invite-eligible at all — see isMemberInviteEligible above), but
 * is excluded explicitly for clarity/defensiveness rather than relying on
 * that upstream guarantee alone.
 */
export function shouldOfferRegenerate(existingInvite: FamilyInviteListItem | null): boolean {
  return existingInvite !== null && existingInvite.status !== 'redeemed';
}

/** The exact label for the create/regenerate button, given any existing invite for this target. */
export function createInviteButtonLabel(existingInvite: FamilyInviteListItem | null): string {
  return shouldOfferRegenerate(existingInvite) ? 'צור הזמנה חדשה' : 'צור הזמנה';
}

// ----------------------------------------------------------------------------
// Invite link
// ----------------------------------------------------------------------------

/** The exact prefix buildInviteLinkText() produced before the HTTPS redesign — still recognized (and stripped) by parseInviteInput() below so old links/shares already out in the wild, or a native build with no web origin, keep working. */
const INVITE_LINK_PREFIX = 'dogwalkfamily://invite/';

/** The query-param name a real HTTPS invite URL carries the opaque token under — e.g. `https://<domain>/?invite=<token>`. */
const INVITE_LINK_QUERY_PARAM = 'invite';

/**
 * Family Lifecycle repair — the real, clickable invite link. An opaque
 * token only (no family_id/target_user_id/names, ever — inspect_family_invite()
 * is what resolves display fields server-side after redemption-time
 * validation), carried as a query param at the site root so it needs no new
 * Vercel SPA rewrite rule and no change to the PWA manifest's
 * `start_url: "/"` scope/launch matching.
 *
 * `origin` is the caller's own `window.location.origin` (web only — this
 * file stays framework-agnostic/no DOM access, so the caller resolves it).
 * When `origin` is null (native, or web before `window` exists) this falls
 * back to the legacy `dogwalkfamily://` form: still recognized by
 * parseInviteInput() below, and explicitly allowed as an internal/
 * backward-compatible fallback — just never the primary user-facing link.
 */
export function buildInviteLinkText(rawToken: string, origin?: string | null): string {
  if (origin) {
    return `${origin}/?${INVITE_LINK_QUERY_PARAM}=${encodeURIComponent(rawToken)}`;
  }
  return `${INVITE_LINK_PREFIX}${rawToken}`;
}

/** Strips trailing punctuation a human might have left attached while copying ("token." or "token)") — shared by every extraction path below. */
function stripTrailingPunctuation(token: string): string {
  return token.replace(/["'<>.,;:!?)}\]]+$/, '').trim();
}

/** The first whitespace-delimited word of `s` — people commonly paste an entire share message, not just the link/token. */
function firstWord(s: string): string {
  return s.trim().split(/[\s\n\r\t]/)[0] ?? '';
}

/**
 * Parses whatever a person pastes into the "יש לי הזמנה" box on
 * FamilyOnboardingScreen, or whatever a launch URL's query string carries:
 * a real HTTPS invite link (`.../?invite=<token>`, anywhere in a larger
 * pasted message too), the legacy `dogwalkfamily://invite/<token>` link, or
 * just the raw token portion. Trims whitespace; returns null for empty
 * input so the caller can disable the next step rather than attempting an
 * RPC with nothing to send.
 *
 * Deliberately does NOT validate the token's shape/length beyond
 * non-emptiness — inspect_family_invite() (0008) is the actual authority on
 * whether a given string is a real, live invite token ('invite not found'
 * covers every malformed/unknown case already, see errorMessages.ts). Adding
 * a second, client-side notion of "looks like a valid token" here would risk
 * silently diverging from the server's own definition for no real benefit —
 * consistent with this codebase's established "client checks are UX only,
 * server is authoritative" convention (see PROJECT_DNA.md §7/§17).
 */
export function parseInviteInput(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  // Legacy scheme first (unchanged behavior/regression protection — people
  // may still have an old share message, or a native build with no web
  // origin may still emit this form).
  const prefixIndex = trimmed.indexOf(INVITE_LINK_PREFIX);
  if (prefixIndex >= 0) {
    const afterPrefix = trimmed.slice(prefixIndex + INVITE_LINK_PREFIX.length);
    const token = stripTrailingPunctuation(firstWord(afterPrefix));
    return token || null;
  }

  // The new HTTPS form — recognized anywhere in a larger pasted message
  // (a full share, or a bare "invite=<token>" fragment) just like the
  // legacy scheme above, not only as a complete standalone URL.
  const queryMatch = trimmed.match(/[?&]invite=([^&\s"'<>]+)/);
  if (queryMatch) {
    let token = queryMatch[1];
    try {
      token = decodeURIComponent(token);
    } catch {
      // Malformed percent-encoding — fall back to the raw captured text
      // rather than throwing; inspect_family_invite() will simply reject
      // whatever this turns out to be.
    }
    token = stripTrailingPunctuation(token);
    return token || null;
  }

  return trimmed;
}

// ----------------------------------------------------------------------------
// Expiry display
// ----------------------------------------------------------------------------

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

/**
 * "DD-MM-YYYY בשעה HH:MM" for a raw expires_at ISO timestamp (from
 * createFamilyInvite()/listFamilyInvites()) — local time, matching this
 * app's other viewer-facing date formatting (see logic/dateFormat.ts's own
 * "local, not UTC" rationale). Returns null for a missing/unparseable
 * value rather than showing a broken date — same fail-clean convention as
 * logic/presence.ts's describePresence().
 */
export function formatInviteExpiry(expiresAt: string | null | undefined): string | null {
  if (!expiresAt) return null;
  const d = new Date(expiresAt);
  if (Number.isNaN(d.getTime())) return null;
  const date = `${pad2(d.getDate())}-${pad2(d.getMonth() + 1)}-${d.getFullYear()}`;
  const time = `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
  return `${date} בשעה ${time}`;
}
