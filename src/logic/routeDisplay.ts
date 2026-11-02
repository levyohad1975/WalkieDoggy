/**
 * Display-only clean-up of a recorded walk route (owner request 2026-11-02:
 * the map showed zigzags and straight lines across the park).
 *
 * Phone GPS — especially in a browser — wanders by several to tens of meters
 * between fixes even when the walker goes straight. This smooths that wander
 * for drawing only; persisted routePoints and the recorded distance are never
 * changed.
 *
 *  1. order by time (late uploads can arrive out of order);
 *  2. accuracy-weighted moving average over neighbouring fixes, so a fix
 *     reported as 40 m accurate pulls the line far less than a 5 m one;
 *  3. Douglas–Peucker simplification to drop the remaining sub-meter jitter.
 *
 * The first and last fixes are kept as they are so start/end markers stay put.
 */
import { haversineDistanceMeters, type GpsPoint } from './gpsDistance';

export const SMOOTHING_HALF_WINDOW = 2;
export const SIMPLIFY_TOLERANCE_METERS = 4;
/** Accuracy assumed when a fix does not report one (typical phone GPS outdoors). */
const DEFAULT_ACCURACY_METERS = 15;

type DisplayPoint = Pick<GpsPoint, 'latitude' | 'longitude' | 'timestamp'> & { accuracy?: number | null };

function weightOf(point: DisplayPoint): number {
  const accuracy = point.accuracy != null && Number.isFinite(point.accuracy) && point.accuracy > 0 ? point.accuracy : DEFAULT_ACCURACY_METERS;
  return 1 / (accuracy * accuracy);
}

export function smoothRoute<T extends DisplayPoint>(points: T[], halfWindow = SMOOTHING_HALF_WINDOW): T[] {
  if (points.length < 3 || halfWindow < 1) return points.slice();
  return points.map((point, index) => {
    if (index === 0 || index === points.length - 1) return point;
    const from = Math.max(0, index - halfWindow);
    const to = Math.min(points.length - 1, index + halfWindow);
    let lat = 0;
    let lon = 0;
    let total = 0;
    for (let i = from; i <= to; i += 1) {
      // Nearer neighbours count more than the window's edges.
      const w = weightOf(points[i]) * (halfWindow + 1 - Math.abs(i - index));
      lat += points[i].latitude * w;
      lon += points[i].longitude * w;
      total += w;
    }
    return { ...point, latitude: lat / total, longitude: lon / total };
  });
}

/** Distance (m) from p to the segment a–b, on a local flat projection (fine at walk scale). */
function distanceToSegmentMeters(p: DisplayPoint, a: DisplayPoint, b: DisplayPoint): number {
  const k = Math.cos((a.latitude * Math.PI) / 180) * 111_320;
  const ax = a.longitude * k, ay = a.latitude * 110_540;
  const bx = b.longitude * k, by = b.latitude * 110_540;
  const px = p.longitude * k, py = p.latitude * 110_540;
  const dx = bx - ax, dy = by - ay;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

export function simplifyRoute<T extends DisplayPoint>(points: T[], toleranceMeters = SIMPLIFY_TOLERANCE_METERS): T[] {
  if (points.length < 3) return points.slice();
  const keep = new Array<boolean>(points.length).fill(false);
  keep[0] = true;
  keep[points.length - 1] = true;
  const stack: Array<[number, number]> = [[0, points.length - 1]];
  while (stack.length) {
    const [start, end] = stack.pop()!;
    let maxDistance = 0;
    let index = -1;
    for (let i = start + 1; i < end; i += 1) {
      const d = distanceToSegmentMeters(points[i], points[start], points[end]);
      if (d > maxDistance) { maxDistance = d; index = i; }
    }
    if (index !== -1 && maxDistance > toleranceMeters) {
      keep[index] = true;
      stack.push([start, index], [index, end]);
    }
  }
  return points.filter((_, i) => keep[i]);
}

export function routeForDisplay<T extends DisplayPoint>(points: T[]): T[] {
  const ordered = points
    .filter((p) => Number.isFinite(p.latitude) && Number.isFinite(p.longitude))
    .slice()
    .sort((a, b) => a.timestamp - b.timestamp);
  return simplifyRoute(smoothRoute(ordered));
}

/** Total length of a drawn line, for tests and sanity checks. */
export function pathLengthMeters(points: DisplayPoint[]): number {
  let total = 0;
  for (let i = 1; i < points.length; i += 1) total += haversineDistanceMeters(points[i - 1] as GpsPoint, points[i] as GpsPoint);
  return total;
}

/**
 * Owner rule 2026-11-02: every walk starts at home. When GPS was started
 * late (the first measured fix is well away from the dog's verified home) and
 * no history-based reconstruction exists, the map completes the missing lead
 * from home as a dashed, clearly "estimated" straight line. Drawing only:
 * nothing is stored and the measured distance is unchanged.
 */
export const HOME_LEAD_MIN_METERS = 60;

export function homeLeadForDisplay(
  home: { latitude: number; longitude: number } | null | undefined,
  firstMeasured: { latitude: number; longitude: number } | null | undefined,
): { routePoints: Array<{ latitude: number; longitude: number; timestamp: number }>; distanceMeters: number } | null {
  if (!home || !firstMeasured) return null;
  if (![home.latitude, home.longitude, firstMeasured.latitude, firstMeasured.longitude].every(Number.isFinite)) return null;
  const start = { latitude: home.latitude, longitude: home.longitude, timestamp: 0 };
  const end = { latitude: firstMeasured.latitude, longitude: firstMeasured.longitude, timestamp: 0 };
  const distanceMeters = haversineDistanceMeters(start, end);
  if (distanceMeters < HOME_LEAD_MIN_METERS) return null;
  return { routePoints: [start, end], distanceMeters };
}
