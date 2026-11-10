import type { WalkGpsSession } from '../types';

/**
 * How long a walker's server GPS session may go without a new route write
 * before other family devices stop calling it "active". Appends land every
 * few seconds while the walker's phone is in the foreground; iPhone home-screen
 * apps stop them as soon as the screen locks or the app is closed (field
 * report 2026-11-04: the session stayed "פעיל" on the family's phones for the
 * whole walk although the last point arrived two minutes after the start).
 */
export const REMOTE_GPS_STALE_AFTER_MS = 3 * 60 * 1000;

export type RemoteGpsFreshness =
  | { kind: 'none' }
  | { kind: 'fresh' }
  | { kind: 'stale'; lastUpdateAt: Date };

export function remoteGpsFreshness(
  session: Pick<WalkGpsSession, 'pointCount' | 'updatedAt' | 'liveUpdatedAt'> | null | undefined,
  now: Date = new Date(),
): RemoteGpsFreshness {
  if (!session || !(session.pointCount > 0)) return { kind: 'none' };
  const stamp = session.liveUpdatedAt || session.updatedAt;
  const updated = stamp ? new Date(stamp) : null;
  if (!updated || Number.isNaN(updated.getTime())) return { kind: 'fresh' };
  return now.getTime() - updated.getTime() > REMOTE_GPS_STALE_AFTER_MS
    ? { kind: 'stale', lastUpdateAt: updated }
    : { kind: 'fresh' };
}

export function localClockLabel(date: Date): string {
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}
