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
}

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
 */
export function computeRequestLifecycle(
  request: RequestLike,
  walksById: Record<string, Pick<Walk, 'status'> | undefined>,
  now: Date = new Date()
): RequestLifecycleState {
  if (request.status === 'pending') {
    const walk = walksById[request.walk_id];
    if (!walk || walk.status !== 'pending') return 'expired';
    // A mutual swap depends on BOTH exact walks remaining pending.
    if (request.target_walk_id) {
      const targetWalk = walksById[request.target_walk_id];
      if (!targetWalk || targetWalk.status !== 'pending') return 'expired';
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
  walksById: Record<string, Pick<Walk, 'status'> | undefined>,
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
  walksById: Record<string, Pick<Walk, 'status'> | undefined>,
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
  walksById: Record<string, Pick<Walk, 'status'> | undefined>,
  viewerUserId: string,
  isAdmin: boolean,
  now: Date = new Date()
): number {
  const swapCount = countActionableRequests(swapRequests, walksById, (r) => r.target_user_id === viewerUserId, now);
  const timeChangeCount = isAdmin ? countActionableRequests(timeChangeRequests, walksById, () => true, now) : 0;
  return swapCount + timeChangeCount;
}
