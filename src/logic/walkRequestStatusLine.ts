import type { Walk } from '../types';
import type { SwapRequestRow, TimeChangeRequestRow } from '../lib/requests';
import { computeRequestLifecycle, isRequestVisible, type RequestLike } from './requestLifecycle';

/**
 * P1 — compact request-status line on walk cards.
 *
 * Computes AT MOST one short Hebrew status string for a given walk, derived
 * from the authoritative request state already loaded into requestsStore
 * (kept fresh by the realtime + foreground-sync fixes elsewhere this
 * round). Pure and unit-tested on purpose — WalkRow.tsx (and any other
 * per-walk card) should call this rather than re-deriving request status
 * inline, so there is exactly one place this logic lives.
 *
 * Rules:
 *   - Only requests belonging to THIS walk (`walk_id === walk.id`) are
 *     considered.
 *   - Visibility reuses requestLifecycle.ts's existing 24h
 *     "recentlyResolved" window (isRequestVisible) — an approved/rejected
 *     request stops being shown on the card once it's no longer visible
 *     there, exactly like it already stops being shown in the requests
 *     inbox. A still-`active` (pending, actionable) request is always
 *     shown regardless of age.
 *   - If both a swap and a time-change request are relevant for the same
 *     walk (e.g. one was rejected and a different kind was requested
 *     afterwards), the MOST RECENT one wins (compared by `created_at`) —
 *     deterministic, single line, never two.
 *   - Terminal states get a distinct glyph (✓ approved / ✕ rejected) from
 *     the pending state (🕐), matching the task's example copy.
 */
export interface WalkRequestStatusLine {
  text: string;
  kind: 'swap' | 'timeChange';
  status: 'pending' | 'approved' | 'rejected';
}

type AnyRequestRow = (SwapRequestRow & { kind: 'swap' }) | (TimeChangeRequestRow & { kind: 'timeChange' });

function toRequestLike(row: AnyRequestRow): RequestLike {
  return { id: row.id, walk_id: row.walk_id, target_walk_id: 'target_walk_id' in row ? row.target_walk_id : undefined, status: row.status, created_at: row.created_at, resolved_at: row.resolved_at };
}

function lineFor(row: AnyRequestRow): string {
  if (row.kind === 'swap') {
    if (row.status === 'pending') return '🔁 ממתין';
    if (row.status === 'approved') return '✓ אושר';
    return '✕ נדחה';
  }
  const time = row.proposed_time;
  if (row.status === 'pending') return `🕐 ${time} · ממתין`;
  if (row.status === 'approved') return `✓ ${time} אושר`;
  return `✕ ${time} נדחה`;
}

/**
 * @param walk the walk to compute a status line for.
 * @param swapRequests all swap requests currently known to the client (any walk).
 * @param timeChangeRequests all time-change requests currently known to the client (any walk).
 * @param walksById lookup used by computeRequestLifecycle to tell whether a still-pending request is 'expired' (see that function's doc comment) — pass the same map ScheduleStore/HomeScreen already build for other lifecycle checks.
 * @param now injectable for tests; defaults to the real current time.
 */
export function computeWalkRequestStatusLine(
  walk: Pick<Walk, 'id'>,
  swapRequests: SwapRequestRow[],
  timeChangeRequests: TimeChangeRequestRow[],
  walksById: Record<string, Pick<Walk, 'status'> | undefined>,
  now: Date = new Date(),
  viewerUserId?: string | null
): WalkRequestStatusLine | null {
  const candidates: AnyRequestRow[] = [
    ...swapRequests.filter((r) => r.walk_id === walk.id || r.target_walk_id === walk.id).map((r) => ({ ...r, kind: 'swap' as const })),
    ...timeChangeRequests.filter((r) => r.walk_id === walk.id).map((r) => ({ ...r, kind: 'timeChange' as const })),
  ];
  if (candidates.length === 0) return null;

  const visible = candidates.filter((row) => {
    // A resolved time-change badge is personal feedback for the member who
    // requested it. Everyone still sees the walk's authoritative updated
    // scheduledTime; only the requester sees ✓/✕ + proposed time for 24h.
    if (row.kind === 'timeChange' && row.status !== 'pending' && viewerUserId && row.requested_by_user_id !== viewerUserId) {
      return false;
    }
    const lifecycle = computeRequestLifecycle(toRequestLike(row), walksById, now);
    // 'expired' (a pending request whose walk moved on) is deliberately
    // excluded here too — nothing useful to show on a card for a request
    // that can no longer be acted on.
    return isRequestVisible(lifecycle);
  });
  if (visible.length === 0) return null;

  // Most recent relevant request wins — deterministic tie-break by created_at.
  visible.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
  const winner = visible[0];

  return { text: lineFor(winner), kind: winner.kind, status: winner.status };
}
