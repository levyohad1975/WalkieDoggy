import type { Walk, WalkStatus } from '../types';

/** Common shape shared by SwapRequestRow and TimeChangeRequestRow (src/lib/requests.ts) — enough for lifecycle computation. */
export interface RequestLike {
  id: string;
  walk_id: string;
  target_walk_id?: string | null;
  status: 'pending' | 'approved' | 'rejected';
  created_at: string;
  resolved_at: string | null;
  requester_seen_at?: string | null;
  requested_by_user_id?: string;
  target_user_id?: string;
  /** Time-change requests only (TimeChangeRequestRow.expected_time). */
  expected_time?: string;
  /** Swap requests only (SwapRequestRow's expected_* snapshot columns, migration 0018). */
  expected_responsible_user_id?: string;
  expected_scheduled_time?: string;
  expected_target_responsible_user_id?: string | null;
  expected_target_scheduled_time?: string | null;
}

/**
 * `responsibleUserId`/`scheduledTime` are optional here (unlike on `Walk` itself)
 * so callers that only have `status` on hand (older test fixtures, or any future
 * caller that genuinely can't supply the rest) still type-check — the lifecycle
 * checks that use them are themselves written to no-op when they're absent.
 */
export type LifecycleWalk = Pick<Walk, 'status'> & Partial<Pick<Walk, 'responsibleUserId' | 'scheduledTime'>>;

export type RequestLifecycleState =
  | 'active' // pending, and still actionable — counts toward the badge
  | 'expired' // was pending, but the underlying walk is no longer actionable
  | 'recentlyResolved' // approved/rejected within the last ~24 hours — shown for awareness
  | 'archived'; // approved/rejected more than ~24h ago — no longer shown in the active list

const RECENTLY_RESOLVED_WINDOW_MS = 24 * 60 * 60 * 1000;

/**
 * Section 9: computes a request's lifecycle state from data that already
 * exists (status, resolved_at, and the current state of the walk it refers
 * to) — no schema change needed. Nothing is ever deleted to represent
 * "expired"/"archived": both are purely derived, read-time states.
 *
 * "expired" covers a pending request whose underlying walk can no longer
 * actually be acted on — the walk was deleted, or its status moved on from
 * 'pending' some other way (e.g. it was independently marked done/skipped,
 * or — for a swap/time-change — reassigned/rescheduled by another approved
 * request first). A merely time-passed walk is NOT automatically expired
 * here on its own; it stays 'active' until something resolves it, mirroring
 * how overdue-pending walks stay actionable (Section 3/4).
 *
 * Also mirrors approve_swap_request()/approve_time_change_request()'s own
 * "has this walk changed since the request was created" re-checks (the
 * expected_ and expected_target_ snapshot columns), not just `status`: an
 * unrelated admin action (admin_reschedule_walk, admin_swap_walks, or a
 * different approved request) can change a walk's responsible_user_id or
 * scheduled_time while leaving it `status = 'pending'` — the walk stays
 * pending, but the specific snapshot this request was approved against no
 * longer matches, so the RPC would reject the approval. Without this check
 * the inbox/badge kept showing such a request as live and actionable right
 * up until the admin tapped approve and hit that rejection. Expected fields
 * are optional so a caller that genuinely lacks the snapshot (e.g. an older
 * test fixture) degrades to the pre-existing status-only check rather than
 * being forced to treat every such request as expired.
 */
export function computeRequestLifecycle(
  request: RequestLike,
  walksById: Record<string, LifecycleWalk | undefined>,
  now: Date = new Date()
): RequestLifecycleState {
  if (request.status === 'pending') {
    const walk = walksById[request.walk_id];
    if (!walk || walk.status !== 'pending') return 'expired';
    if (request.target_walk_id) {
      // A mutual swap depends on BOTH exact walks remaining pending, each still
      // matching the snapshot captured when the swap was requested.
      const targetWalk = walksById[request.target_walk_id];
      if (!targetWalk || targetWalk.status !== 'pending') return 'expired';
      if (
        request.expected_responsible_user_id !== undefined &&
        walk.responsibleUserId !== undefined &&
        walk.responsibleUserId !== request.expected_responsible_user_id
      ) return 'expired';
      if (
        request.expected_scheduled_time !== undefined &&
        walk.scheduledTime !== undefined &&
        walk.scheduledTime !== request.expected_scheduled_time
      ) return 'expired';
      if (
        request.expected_target_responsible_user_id != null &&
        targetWalk.responsibleUserId !== undefined &&
        targetWalk.responsibleUserId !== request.expected_target_responsible_user_id
      ) return 'expired';
      if (
        request.expected_target_scheduled_time != null &&
        targetWalk.scheduledTime !== undefined &&
        targetWalk.scheduledTime !== request.expected_target_scheduled_time
      ) return 'expired';
    } else {
      // Time-change request: approve_time_change_request() re-checks the walk's
      // scheduled_time against expected_time AND its responsible_user_id against
      // the request's own requested_by_user_id (there's no separate "expected
      // responsible" column for this request kind — see migration 0006).
      if (
        request.expected_time !== undefined &&
        walk.scheduledTime !== undefined &&
        walk.scheduledTime !== request.expected_time
      ) return 'expired';
      if (
        request.requested_by_user_id !== undefined &&
        walk.responsibleUserId !== undefined &&
        walk.responsibleUserId !== request.requested_by_user_id
      ) return 'expired';
    }
    return 'active';
  }

  // approved / rejected
  if (!request.resolved_at) return 'archived'; // defensive: shouldn't normally happen once resolved
  const resolvedAt = new Date(request.resolved_at).getTime();
  if (now.getTime() - resolvedAt <= RECENTLY_RESOLVED_WINDOW_MS) return 'recentlyResolved';
  return 'archived';
}

/** True for a state that should still count toward "בקשות ממתינות (N)" and be actionable in the inbox. */
export function isRequestActive(state: RequestLifecycleState): boolean {
  return state === 'active';
}

/** True for a state that should still be SHOWN in the inbox list at all (active + recently resolved; archived/expired are hidden from the default view, never deleted). */
export function isRequestVisible(state: RequestLifecycleState): boolean {
  return state === 'active' || state === 'recentlyResolved';
}

/**
 * Badge count = only actionable-pending requests ADDRESSED TO the viewer
 * (mirrors the existing pendingForMe filters in HomeScreen, now lifecycle-
 * aware so an expired pending request never inflates the badge).
 */
export function countActionableRequests<T extends RequestLike>(
  requests: T[],
  walksById: Record<string, LifecycleWalk | undefined>,
  isAddressedToViewer: (request: T) => boolean,
  now: Date = new Date()
): number {
  return requests.filter(
    (r) => isAddressedToViewer(r) && isRequestActive(computeRequestLifecycle(r, walksById, now))
  ).length;
}


/**
 * Counts recent terminal outcomes created by this viewer that have not yet
 * been acknowledged in the Requests inbox. The same 24-hour lifecycle window
 * used by the inbox applies, so an archived result can never resurrect the
 * bell badge.
 */
export function countUnreadRequestResults<T extends RequestLike>(
  requests: T[],
  walksById: Record<string, LifecycleWalk | undefined>,
  viewerUserId: string,
  now: Date = new Date()
): number {
  return requests.filter(
    (r) =>
      r.requested_by_user_id === viewerUserId &&
      r.requester_seen_at == null &&
      computeRequestLifecycle(r, walksById, now) === 'recentlyResolved'
  ).length;
}

/**
 * In-app gap fix (product decision: "ALL Family Admins... receive the
 * result notification... represented appropriately in the in-app
 * requests/messages experience"): countUnreadRequestResults above only
 * ever counts a request's own REQUESTER — an admin who didn't request it
 * (and isn't the swap target/approver either) previously got zero in-app
 * signal when someone else's request resolved, even though they now also
 * get a push for it (see send-request-push's admin fan-out). This counts,
 * for an admin viewer, every OTHER member's request that resolved within
 * the same ~24h "recently resolved" window everything else in this file
 * already uses — `r.requested_by_user_id !== viewerUserId` avoids double-
 * counting requests countUnreadRequestResults already covers for a viewer
 * who is both the requester and an admin.
 *
 * Deliberately lighter-weight than a requester's own signal: there is no
 * per-admin read-receipt column (requester_seen_at is requester-specific —
 * mark_my_request_results_seen only ever updates the caller's OWN
 * requested rows, migration 0005), so this does not clear when an admin
 * opens the inbox and does not distinguish "an admin who just approved
 * this themselves" from "a different admin" — it simply stops counting
 * once the request moves from recentlyResolved to archived (~24h), same
 * as every other lifecycle-driven display in this file. Real signal, not
 * nothing — the alternative was silence.
 */
export function countRecentlyResolvedRequestsForAdmin<T extends RequestLike>(
  requests: T[],
  walksById: Record<string, LifecycleWalk | undefined>,
  viewerUserId: string,
  now: Date = new Date()
): number {
  return requests.filter(
    (r) => r.requested_by_user_id !== viewerUserId && computeRequestLifecycle(r, walksById, now) === 'recentlyResolved'
  ).length;
}

/**
 * True when `walkId` already appears — as either the source or the
 * reciprocal target — in an active pending swap request. `create_swap_request()`
 * (migration 0018) rejects naming either walk on EITHER side of a NEW request
 * whenever it already appears on either side of any existing pending row in
 * the same `walk_swap_requests` table: `r.walk_id in (p_walk_id,
 * p_target_walk_id) or r.target_walk_id in (p_walk_id, p_target_walk_id)`.
 * Without this check, a "בקש החלפה" affordance (or a target-walk picker
 * option) could be shown for a walk that would always be rejected by that
 * guard — the requester's OWN still-pending walk offering a second "בקש
 * החלפה" while the first is outstanding, or the picker still listing a
 * target member's walk that already carries a pending request against it.
 */
export function walkHasActiveSwapRequest<T extends RequestLike>(
  walkId: string,
  swapRequests: T[],
  walksById: Record<string, LifecycleWalk | undefined>,
  now: Date = new Date()
): boolean {
  return swapRequests.some(
    (r) =>
      (r.walk_id === walkId || r.target_walk_id === walkId) &&
      isRequestActive(computeRequestLifecycle(r, walksById, now))
  );
}

/**
 * True when `walkId` already has an active pending time-change request.
 * `create_time_change_request()` (migration 0006) rejects a second request
 * for the same `walk_id` while one is already pending (its own single-table
 * `time_change_requests` guard) — mirrored here so the "בקש שינוי שעה"
 * affordance isn't shown for a walk that would always be rejected by it.
 */
export function walkHasActiveTimeChangeRequest<T extends RequestLike>(
  walkId: string,
  timeChangeRequests: T[],
  walksById: Record<string, LifecycleWalk | undefined>,
  now: Date = new Date()
): boolean {
  return timeChangeRequests.some(
    (r) => r.walk_id === walkId && isRequestActive(computeRequestLifecycle(r, walksById, now))
  );
}

/**
 * Combined "בקשות ממתינות (N)" bell-badge count (HomeScreen). A swap
 * request's target can be ANY active family member the requester picks —
 * including one who also holds the Admin role (UserPickerModal doesn't
 * exclude admins, and RequestsInboxModal's own canApprove check for a swap
 * is target_user_id-only, never role-gated) — so an Admin viewer must still
 * be counted whenever a pending swap names them as target, in addition to
 * every pending time-change request any Admin may approve. A non-admin
 * viewer only ever sees swap requests addressed to them, since they can
 * never approve a time-change request.
 */
export function countPendingRequestsForViewer(
  swapRequests: RequestLike[],
  timeChangeRequests: RequestLike[],
  walksById: Record<string, LifecycleWalk | undefined>,
  viewerUserId: string,
  isAdmin: boolean,
  now: Date = new Date()
): number {
  const swapCount = countActionableRequests(swapRequests, walksById, (r) => r.target_user_id === viewerUserId, now);
  const timeChangeCount = isAdmin ? countActionableRequests(timeChangeRequests, walksById, () => true, now) : 0;
  return swapCount + timeChangeCount;
}
