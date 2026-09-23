/**
 * Pure GPS distance math (Phase 4, PRD §7) — deliberately framework/native-
 * agnostic so it's unit-testable without expo-location or any device. A
 * `GpsPoint` is exactly what a foreground `watchPositionAsync` callback
 * hands the caller; accumulateDistance() is the ONLY place raw points are
 * ever touched — see lib/gpsTracking.ts, which feeds points through this
 * reducer one at a time and keeps only the running total + the last point,
 * never a growing array. No raw point is ever persisted (client cache or
 * server) — see supabase/migrations/0051_walk_gps_sessions.sql's own
 * privacy-by-design rationale for why that's a deliberate boundary, not an
 * oversight.
 */

export interface GpsPoint {
  latitude: number;
  longitude: number;
  /** ms since epoch, as expo-location's Location.LocationObject.timestamp already is. */
  timestamp: number;
  /** meters, when the device reports it — used to filter out low-quality fixes, never persisted. */
  accuracy?: number | null;
}

const EARTH_RADIUS_METERS = 6371000;

function toRadians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

/** Great-circle distance between two points, in meters. */
export function haversineDistanceMeters(a: GpsPoint, b: GpsPoint): number {
  const dLat = toRadians(b.latitude - a.latitude);
  const dLon = toRadians(b.longitude - a.longitude);
  const lat1 = toRadians(a.latitude);
  const lat2 = toRadians(b.latitude);

  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
  return EARTH_RADIUS_METERS * c;
}

/**
 * A GPS fix is noisy at rest — even a stationary phone reports small
 * jittering coordinate changes ("GPS drift"). Without a floor, a 20-minute
 * walk with the dog sniffing a tree for a minute would visibly overcount
 * distance from drift alone. Points closer together than this are treated
 * as "the same spot" and contribute zero distance, rather than summing
 * their jitter. This is a coarse, battery-friendly heuristic (PRD's
 * "צריכת סוללה סבירה" — reasonable battery use, i.e. don't oversample to
 * compensate) — not a Kalman filter — appropriate for "assistive, not sole
 * source of truth" per the PRD's own phase-1 scope.
 */
export const MIN_MOVEMENT_METERS = 3;

/** A fix this inaccurate (device-reported, in meters) is more likely to be noise than movement — discarded rather than accumulated. Generous on purpose: real GPS accuracy varies a lot by device/environment, and rejecting too aggressively would just undercount instead. */
export const MAX_ACCURACY_METERS = 50;

export interface GpsAccumulator {
  distanceMeters: number;
  pointCount: number;
  lastPoint: GpsPoint | null;
}

export function createGpsAccumulator(): GpsAccumulator {
  return { distanceMeters: 0, pointCount: 0, lastPoint: null };
}

/**
 * Folds ONE new point into the running total — called once per
 * watchPositionAsync callback, so the caller never needs to keep an array
 * of points around (see this file's own header). Returns a NEW accumulator
 * (pure) rather than mutating, consistent with this codebase's other
 * reducer-shaped logic (e.g. logic/rotation.ts).
 */
/** "850 מ'" under 1km, "1.24 ק״מ" at/above it — the one shared formatting rule for every screen that shows a GPS distance, so they can never drift into different rounding/unit conventions. */
export function formatDistanceMeters(meters: number): string {
  if (meters < 1000) return `${Math.round(meters)} מ'`;
  return `${(meters / 1000).toFixed(2)} ק״מ`;
}

export function accumulateDistance(acc: GpsAccumulator, point: GpsPoint): GpsAccumulator {
  if (point.accuracy != null && point.accuracy > MAX_ACCURACY_METERS) {
    return acc; // too noisy to trust — not counted, not remembered as "last point" either
  }
  if (!acc.lastPoint) {
    return { distanceMeters: acc.distanceMeters, pointCount: acc.pointCount + 1, lastPoint: point };
  }
  const delta = haversineDistanceMeters(acc.lastPoint, point);
  if (delta < MIN_MOVEMENT_METERS) {
    // Still counts as an observed point (for pointCount/diagnostics), but
    // doesn't move `lastPoint` forward — otherwise a string of sub-floor
    // jitters would each pass the floor against the PREVIOUS jitter and
    // slowly accumulate real-looking distance from pure noise.
    return { distanceMeters: acc.distanceMeters, pointCount: acc.pointCount + 1, lastPoint: acc.lastPoint };
  }
  return { distanceMeters: acc.distanceMeters + delta, pointCount: acc.pointCount + 1, lastPoint: point };
}
