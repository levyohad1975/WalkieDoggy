/**
 * Owner request 2026-11-03: a walk whose walker forgot to tap "סיים טיול"
 * kept running for 113 minutes. While a walk is tracked on this device, the
 * app detects that the walker came back home and asks whether the walk has
 * ended, offering the arrival time as the end time.
 *
 * Rules (pure, drawing on the measured route only):
 *  - the walk must have been away from home (more than LEFT_HOME_METERS) at
 *    some point, so a walk that has not left the house yet never triggers;
 *  - the route then ends inside ARRIVAL_RADIUS_METERS of home and has stayed
 *    near home since (a walk that only passes by home and continues does
 *    not count);
 *  - at least MIN_WALK_MINUTES after the walk started.
 * A browser stops GPS while the phone is locked, so the first fix at home
 * may come long after the real arrival. When the gap between the last fix
 * away and the first fix at home is long, the arrival is estimated from the
 * remaining distance at walking pace and marked as an estimate.
 */
import { haversineDistanceMeters } from './gpsDistance';

export const ARRIVAL_RADIUS_METERS = 40;
export const STAY_NEAR_HOME_METERS = 80;
export const LEFT_HOME_METERS = 120;
export const MIN_WALK_MINUTES = 5;
/** A gap longer than this between the last fix away and the first fix home means GPS was paused. */
export const ARRIVAL_GAP_ESTIMATE_MS = 3 * 60 * 1000;
const WALKING_METERS_PER_SECOND = 1.2;

type Point = { latitude: number; longitude: number; timestamp: number };

export interface ArrivalHome {
  /** Epoch ms of the arrival home. */
  arrivedAt: number;
  /** True when GPS was paused on the way back and the time is estimated. */
  estimated: boolean;
}

export function detectArrivalHome(
  points: Point[],
  home: { latitude: number; longitude: number } | null | undefined,
  walkStartedAtMs: number | null | undefined,
): ArrivalHome | null {
  if (!home || points.length < 2) return null;
  const at = (p: Point) => haversineDistanceMeters({ ...home, timestamp: 0 }, p);
  const ordered = points
    .filter((p) => Number.isFinite(p.latitude) && Number.isFinite(p.longitude) && Number.isFinite(p.timestamp))
    .slice()
    .sort((a, b) => a.timestamp - b.timestamp);
  const last = ordered[ordered.length - 1];
  if (!last || at(last) > ARRIVAL_RADIUS_METERS) return null;

  // Walk back from the end through the points that stayed near home.
  let firstNear = ordered.length - 1;
  while (firstNear > 0 && at(ordered[firstNear - 1]) <= STAY_NEAR_HOME_METERS) firstNear -= 1;
  // It must have been properly away before coming back.
  const awayBefore = ordered.slice(0, firstNear).some((p) => at(p) > LEFT_HOME_METERS);
  if (!awayBefore) return null;

  const firstHome = ordered[firstNear];
  const lastAway = ordered[firstNear - 1];
  let arrivedAt = firstHome.timestamp;
  let estimated = false;
  if (lastAway && firstHome.timestamp - lastAway.timestamp > ARRIVAL_GAP_ESTIMATE_MS) {
    const walkBackMs = (at(lastAway) / WALKING_METERS_PER_SECOND) * 1000;
    arrivedAt = Math.min(firstHome.timestamp, lastAway.timestamp + walkBackMs);
    estimated = true;
  }

  const started = walkStartedAtMs ?? ordered[0].timestamp;
  if (arrivedAt - started < MIN_WALK_MINUTES * 60 * 1000) return null;
  return { arrivedAt: Math.round(arrivedAt), estimated };
}

/** "HH:mm" in local time, for the end-walk sheet. */
export function arrivalTimeLabel(arrivedAt: number): string {
  const d = new Date(arrivedAt);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}
