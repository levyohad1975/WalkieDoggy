/**
 * Section 10 (+ security correction): pure, testable routing/authorization
 * logic for request-related push notifications.
 *
 * SECURITY NOTE: this module is the SINGLE SOURCE OF TRUTH for "who gets a
 * push for this event", but it only ever operates on SERVER-LOADED data —
 * a persisted request row (loaded by the Edge Function with the
 * service-role key, AFTER the caller's identity was verified from their
 * auth token) and a caller identity/admin-status the Edge Function itself
 * resolved from that verified token. It is never handed anything the
 * mobile client sent for authorization purposes — client-supplied
 * recipient lists or message content have no bearing on the result. See
 * supabase/functions/send-request-push/index.ts's doc comment for the full
 * end-to-end flow; that function inlines an equivalent copy of
 * validateAndRoutePushEvent() (Deno can't import this RN-project file at
 * deploy time) — keep both in sync if this rule ever changes.
 *
 * Rule (never broadcasts to the whole family):
 *   - A new request ("created")          -> pushes to whoever must ACT on it
 *     (the swap target, or every current admin for a time-change).
 *   - A decision ("approved"/"rejected") -> pushes to the ORIGINAL
 *     REQUESTER *and* every current Family Admin of the request's family
 *     (product decision: admins must see every resolution, not just the
 *     ones they personally acted on), deduplicated — a requester who is
 *     also an admin, or an admin who is also in the admin list twice,
 *     never gets two pushes for the same event.
 *   - The caller must actually be the party entitled to report that event
 *     (the requester reporting their own new request; the swap target or
 *     an admin reporting a decision they made), and the request's
 *     PERSISTED status must actually match the claimed event — otherwise
 *     the call is rejected outright, no push is sent.
 *   - Every recipient is re-confirmed to belong to the SAME family as the
 *     request (defense in depth — Requirement 7) via a caller-supplied
 *     family-membership map; anything not confirmed there is dropped.
 */

export type PushRequestKind = 'swap' | 'timeChange';
export type PushRequestEvent = 'created' | 'approved' | 'rejected';
export type PushRequestStatus = 'pending' | 'approved' | 'rejected';

/** A request row as actually persisted — never trust a client-shaped version of this; the Edge Function must load it itself. */
export interface RequestRowForPush {
  id: string;
  kind: PushRequestKind;
  familyId: string;
  status: PushRequestStatus;
  requestedByUserId: string;
  /** Swap requests only. */
  targetUserId?: string;
}

export interface PushAuthContext {
  /** The caller's own profile id, resolved server-side from their verified auth token — never from anything the client sent. */
  callerUserId: string;
  callerFamilyId: string;
  /** Resolved server-side (e.g. via the existing is_family_admin() RPC) — never trusted from the client. */
  callerIsAdmin: boolean;
  /** Every active admin user id in the row's family — consulted for a timeChange 'created' event's fan-out, and for every 'approved'/'rejected' decision event (both kinds), which now also notify every admin alongside the requester. */
  familyAdminUserIds?: string[];
  /**
   * Requirement 7 (defense in depth): family_id for every candidate
   * recipient id this function might resolve, as actually loaded from the
   * `users` table server-side. A recipient id missing from this map, or
   * mapped to a different family than the request's, is dropped rather
   * than trusted. Optional only so existing unit tests that don't care
   * about this extra layer can omit it and get the un-filtered result.
   */
  recipientFamilyIds?: Record<string, string>;
}

export interface PushRoutingResult {
  authorized: boolean;
  /** Present only when authorized is false — never shown to the end user, purely for logs/debugging. */
  reason?: string;
  recipientUserIds: string[];
  /** A short, stable identifier for de-duping sends of the same logical event (e.g. two rapid retries), independent of push provider. */
  dedupeKey: string;
}

const STATUS_FOR_EVENT: Record<PushRequestEvent, PushRequestStatus> = {
  created: 'pending',
  approved: 'approved',
  rejected: 'rejected',
};

/**
 * Single source of truth for the dedupe-key shape (Requirement 5 of the
 * idempotency correction) — used by validateAndRoutePushEvent() below, by
 * src/logic/pushIdempotency.ts's claim-decision helper, and mirrored
 * verbatim in the Edge Function's inlined copy and its
 * claim_request_push_event() DB function (migration 0014). Never construct
 * this string a different way anywhere else.
 */
export function buildDedupeKey(kind: PushRequestKind, requestId: string, event: PushRequestEvent): string {
  return `${kind}:${requestId}:${event}`;
}

/**
 * The full authenticated routing decision for one request lifecycle event.
 * Returns `authorized: false` (and an empty recipient list) for anything
 * that doesn't check out — a caller who isn't the party entitled to report
 * this event, a claimed event that doesn't match the row's actual
 * persisted status, a cross-family caller, or a swap request missing its
 * target.
 */
export function validateAndRoutePushEvent(
  row: RequestRowForPush,
  event: PushRequestEvent,
  ctx: PushAuthContext
): PushRoutingResult {
  const dedupeKey = buildDedupeKey(row.kind, row.id, event);
  const deny = (reason: string): PushRoutingResult => ({ authorized: false, reason, recipientUserIds: [], dedupeKey });

  if (ctx.callerFamilyId !== row.familyId) return deny('caller is not a member of the request\'s family');
  if (row.status !== STATUS_FOR_EVENT[event]) return deny('request\'s persisted status does not match the claimed event');

  let recipientUserIds: string[];

  if (event === 'approved' || event === 'rejected') {
    // A decision push goes back to the original requester AND every
    // current admin of this family — but only the party who actually made
    // that decision may trigger it.
    if (row.kind === 'swap') {
      if (ctx.callerUserId !== row.targetUserId) return deny('only the swap target may report a decision on this request');
    } else if (!ctx.callerIsAdmin) {
      return deny('only an admin may report a decision on a time-change request');
    }
    recipientUserIds = [...new Set([row.requestedByUserId, ...(ctx.familyAdminUserIds ?? [])].filter(Boolean))];
  } else {
    // event === 'created' — only the original requester may report their
    // own request as newly created.
    if (ctx.callerUserId !== row.requestedByUserId) return deny('only the requester may report a request as newly created');
    if (row.kind === 'swap') {
      if (!row.targetUserId) return deny('swap request has no target to notify');
      recipientUserIds = [row.targetUserId];
    } else {
      recipientUserIds = [...new Set((ctx.familyAdminUserIds ?? []).filter(Boolean))];
    }
  }

  if (ctx.recipientFamilyIds) {
    recipientUserIds = recipientUserIds.filter((id) => ctx.recipientFamilyIds![id] === row.familyId);
  }

  if (recipientUserIds.length === 0) return deny('no valid same-family recipient resolved');

  return { authorized: true, recipientUserIds, dedupeKey };
}
