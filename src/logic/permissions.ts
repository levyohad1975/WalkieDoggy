/**
 * BATCH 3 — Task 3: application-level permission resolver built on top of
 * the Batch 1 data-model foundation (supabase/migrations/0023_member_
 * permission_overrides.sql).
 *
 * MODEL (mirrors 0023's own doc comment exactly): role supplies the
 * DEFAULT for every customizable permission; an override row is a
 * per-member EXCEPTION to that default. No override row for a given
 * (userId, permissionKey) means "use the role default". Today every
 * customizable permission defaults to `true` for everyone — "History and
 * Statistics visible to every member — the approved default" (0023) — so
 * introducing this resolver changes nothing for any family until a Family
 * Admin explicitly sets an override.
 *
 * This is deliberately the ONE place that knows the rule "override, else
 * role default" — screens/navigation are expected to call
 * resolveEffectivePermission() (or the small screen-facing helpers below)
 * rather than re-deriving it from raw override rows themselves, so the
 * rule only ever needs to change in one place (Task 3's own "centralized
 * application-level permission resolver" requirement).
 *
 * CORRECTED (Batch 3 correction #1/#2, post-review): resolveEffectivePermission()/
 * canViewHistory()/canViewStatistics() below remain a UI-visibility helper
 * — they decide what to SHOW, and are still used for instant, offline-
 * tolerant UI (the nav tab, and this file's own admin management screen)
 * — but they are no longer the ONLY thing standing between a denied member
 * and History/Statistics data. Two things changed:
 *   1. Server-side enforcement now exists: migration 0027 adds
 *      has_member_permission() (a SQL mirror of resolveEffectivePermission()
 *      below) plus a tightened `select walks in own family` RLS policy and
 *      two explicitly-gated RPCs (list_history_walks()/list_statistics_
 *      walks()) that HistoryScreen.tsx/StatisticsScreen.tsx now also call
 *      as an authoritative check — see src/lib/permissionedWalks.ts and
 *      0027's own header comment for the full reasoning (including why a
 *      raw client query against `walks` can no longer freely return
 *      history data for a denied member either).
 *   2. canAccessHistoryScreen()/canAccessStatisticsScreen() below are NEW,
 *      separate from the two pure resolvers above: they take an explicit
 *      PermissionLoadStatus and fail CLOSED (return false) unless it is
 *      'loaded' — the pure resolvers alone cannot express "override data
 *      hasn't finished loading / failed to load yet", and familyStore's
 *      permissionOverrides used to default to `[]` while loading, which
 *      resolveEffectivePermission() then read exactly like "successfully
 *      loaded, no override exists" (role default -> allowed). These two
 *      functions are what HistoryScreen.tsx/StatisticsScreen.tsx must use
 *      for the actual screen-level gate; the plain resolvers above stay
 *      correct for every other (non-boundary) caller as-is.
 */

export type PermissionKey = 'view_history' | 'view_statistics' | 'view_settings';

/** The full set of customizable permission keys — kept as a single source used by both this resolver and the admin UI, so a newly added key only needs to be listed once. Must exactly match migration 0023's CHECK constraint. */
export const PERMISSION_KEYS: readonly PermissionKey[] = ['view_history', 'view_statistics', 'view_settings'];

/** One override row, in the app's own camelCase shape (see lib/permissions.ts for the raw-row -> this mapping). */
export interface MemberPermissionOverride {
  userId: string;
  permissionKey: PermissionKey;
  allowed: boolean;
}

/**
 * Role default for every customizable permission — currently `true` for
 * both, for every role, per 0023's approved default. Kept as an explicit
 * map (rather than a bare literal `true`) so a future permission that
 * should default differently, or a future role-specific default, has an
 * obvious single place to change without touching every call site.
 */
const ROLE_DEFAULT: Record<PermissionKey, boolean> = {
  view_history: true,
  view_statistics: true,
  // Settings is admin-oriented by default. Members may be granted access
  // explicitly through an override; family admins retain access separately
  // at the navigation/screen boundary.
  view_settings: false,
};

/**
 * The single resolver: override (if one exists for this member/permission)
 * else the role default. `role`/`overrides` are intentionally the only
 * inputs — this never talks to a store or Supabase directly, so it's
 * trivially unit-testable and reusable from navigation, screens, or tests
 * alike.
 */
export function resolveEffectivePermission(
  permissionKey: PermissionKey,
  userId: string | null | undefined,
  overrides: readonly MemberPermissionOverride[]
): boolean {
  if (!userId) return ROLE_DEFAULT[permissionKey];
  const override = overrides.find((o) => o.userId === userId && o.permissionKey === permissionKey);
  return override ? override.allowed : ROLE_DEFAULT[permissionKey];
}

/** Screen-facing convenience wrapper — reads slightly better at call sites than the generic resolver above. */
export function canViewHistory(userId: string | null | undefined, overrides: readonly MemberPermissionOverride[]): boolean {
  return resolveEffectivePermission('view_history', userId, overrides);
}

/** Screen-facing convenience wrapper — reads slightly better at call sites than the generic resolver above. */
export function canViewStatistics(userId: string | null | undefined, overrides: readonly MemberPermissionOverride[]): boolean {
  return resolveEffectivePermission('view_statistics', userId, overrides);
}

/**
 * Whether familyStore's permissionOverrides reflects a genuinely verified
 * state right now. 'idle' (never asked), 'loading' (a fetch is in flight),
 * and 'error' (the fetch failed) are all "we don't actually know" — only
 * 'loaded' means overrides is an accurate snapshot of the server's rows.
 * Mirrors familyStore.ts's own `permissionOverridesStatus` field exactly
 * (this is the single source of truth for the type; familyStore imports it
 * rather than redefining it).
 */
export type PermissionLoadStatus = 'idle' | 'loading' | 'loaded' | 'error';

/**
 * The actual screen-level gate for HistoryScreen.tsx (Batch 3 correction
 * #2) — fails CLOSED whenever `status` is anything other than 'loaded',
 * regardless of what `overrides` currently contains (it may be `[]` simply
 * because nothing has loaded yet, not because no override exists). Once
 * status is genuinely 'loaded', this is identical to canViewHistory() — the
 * approved role-default-`true` behavior is unchanged for the case that
 * matters (a successful load that found no override row for this member).
 */
export function canAccessHistoryScreen(
  userId: string | null | undefined,
  overrides: readonly MemberPermissionOverride[],
  status: PermissionLoadStatus
): boolean {
  if (status !== 'loaded') return false;
  return canViewHistory(userId, overrides);
}

/** The actual screen-level gate for StatisticsScreen.tsx — see canAccessHistoryScreen()'s doc comment for the full reasoning, identical here for view_statistics. */
export function canAccessStatisticsScreen(
  userId: string | null | undefined,
  overrides: readonly MemberPermissionOverride[],
  status: PermissionLoadStatus
): boolean {
  if (status !== 'loaded') return false;
  return canViewStatistics(userId, overrides);
}

/** Settings permission. Family admins are handled as always-allowed by the caller; this resolver covers member overrides. */
export function canViewSettings(userId: string | null | undefined, overrides: readonly MemberPermissionOverride[]): boolean {
  return resolveEffectivePermission('view_settings', userId, overrides);
}

export function canAccessSettingsScreen(
  userId: string | null | undefined,
  overrides: readonly MemberPermissionOverride[],
  status: PermissionLoadStatus
): boolean {
  if (status !== 'loaded') return false;
  return canViewSettings(userId, overrides);
}
