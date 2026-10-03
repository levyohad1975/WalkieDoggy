/**
 * Family Lifecycle repair, item 6 — the general family-wide short code
 * (Settings' "👨‍👩‍👧‍👦 שיתוף המשפחה" / FamilySharingModal, backed by
 * findFamilyByInviteCode()/joinFamily() in lib/supabase.ts) is a genuinely
 * separate mechanism from the personal member invite
 * (createFamilyInvite()/inspectFamilyInviteDetail()/redeemFamilyInvite() in
 * lib/invites.ts, see logic/familyInvites.ts):
 *
 *  - Personal invitation: claims a SPECIFIC pre-created member profile.
 *    Always role='member', server-enforced, one profile per token.
 *  - Family sharing code: joins the family with no specific profile
 *    claimed — joinFamily() picks/creates membership generically. Still a
 *    real, server-authorized flow (findFamilyByInviteCode()/joinFamily()
 *    remain the sole authorization boundary; nothing here changes that),
 *    just a different identity model.
 *
 * This file does NOT touch that authorization boundary — it only gives the
 * family-wide code the same "real, clickable HTTPS link first, manual code
 * as fallback" treatment logic/familyInvites.ts already gives the personal
 * invite, so the two systems stay clearly distinguishable (different query
 * param, `join` vs `invite`) rather than converging into one ambiguous
 * thing. Pure, framework-agnostic — no React/React Native/Supabase imports,
 * matching every other file in src/logic.
 */

const JOIN_LINK_QUERY_PARAM = 'join';

/** Strips trailing punctuation a human might have left attached while copying — same convention as familyInvites.ts. */
function stripTrailingPunctuation(token: string): string {
  return token.replace(/["'<>.,;:!?)}\]]+$/, '').trim();
}

/**
 * Builds the family-wide join link. With a web `origin`, a real HTTPS URL
 * carrying only the plain invite code as a query param (the code itself is
 * already the complete, non-secret-structured credential
 * generate_invite_code() hands out — see migration history — so this adds
 * no new disclosure beyond what the existing bare-code share already did).
 * Without an origin (native, or before `window` exists), falls back to the
 * bare code itself — still fully usable via the manual "קוד הזמנה" entry
 * in FamilyOnboardingScreen's 'join' mode, exactly as before this change.
 */
export function buildJoinLinkText(code: string, origin?: string | null): string {
  if (origin) {
    return `${origin}/?${JOIN_LINK_QUERY_PARAM}=${encodeURIComponent(code)}`;
  }
  return code;
}

/**
 * Parses a launch URL's query string, or a manually pasted link/message,
 * for a family-wide join code. Recognizes `?join=<code>` (or `&join=`)
 * anywhere in the input, falling back to treating the whole trimmed input
 * as a bare code — mirroring parseInviteInput()'s own forgiving shape, kept
 * in a separate function so the two mechanisms' parsing never merges into
 * one ambiguous rule (a `join` link must never be accepted by the personal
 * invite's `invite` parser, or vice versa).
 */
export function parseJoinInput(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  const queryMatch = trimmed.match(/[?&]join=([^&\s"'<>]+)/);
  if (queryMatch) {
    let code = queryMatch[1];
    try {
      code = decodeURIComponent(code);
    } catch {
      // Malformed percent-encoding — fall back to the raw captured text;
      // findFamilyByInviteCode() will simply reject whatever this is.
    }
    return stripTrailingPunctuation(code) || null;
  }

  return trimmed;
}
