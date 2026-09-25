/**
 * Pure GPS distance math (Phase 4, PRD §7) — deliberately framework/native-
 * agnostic so it's unit-testable without expo-location or any device. A
 * `GpsPoint` is exactly what a foreground `watchPositionAsync` callback
 * hands the caller; accumulateDistance() is the ONLY place raw points are
 * ever touched — see lib/gpsTracking.ts, which feeds points through this
 * reducer one at a time and keeps only the running total, the last point,
 * and the accepted route (see `routePoints` below).
 *
 * NOTE ON HISTORY: migration 0051_walk_gps_sessions.sql originally shipped
 * with NO raw point persistence at all, by explicit privacy-by-design
 * choice (that migration's own header), gating a future stored route on a
 * still-open PRD retention/privacy decision. Migration 0053 (route_points,
 * a jsonb array of {latitude,longitude,timestamp}) later added exactly
 * that stored route — this file's own accumulator now retains and returns
 * `routePoints` (accepted fixes only, after the accuracy/movement/speed
 * filters below), and gpsStore.ts persists it via upsertGpsSession(). This
 * comment previously still claimed "no raw point is ever persisted",
 * which stopped being true as of 0053 — corrected here, but whether that
 * PRD retention/privacy question was actually revisited before 0053
 * shipped is outside this file's own knowledge and worth confirming
 * separately.
 *
 * ROUTE-POINT ACCURACY: each accepted point's own `accuracy` reading is now
 * carried through into the persisted `routePoints` (migration 0057 updates
 * walk_gps_sessions.route_points' documented shape to
 * {latitude,longitude,timestamp,accuracy} — jsonb needs no column change to
 * hold the extra key). It stays family-scoped like every other GPS field
 * (RLS on walk_gps_sessions, unchanged), and is useful evidence for a
 * future confidence-scored automatic-walk-detection feature (PRD §7) —
 * e.g. weighting a route segment by how trustworthy its fixes were —
 * without this file needing to change again when that lands.
 */

export interface GpsPoint {
  latitude: number;
  longitude: number;
  /** ms since epoch, as expo-location's Location.LocationObject.timestamp already is. */
  timestamp: number;
  /** meters, when the device reports it — used to filter out low-quality fixes, and (see this file's header) now also carried through into the persisted route as part of each point's own quality signal. */
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

/**
 * A single fix implying a speed above this (meters/second) between it and
 * the last accepted point is treated as an implausible jump — GPS
 * multipath/reflection near buildings, a cold-fix snap from a stale/cached
 * location, or a momentary satellite dropout — rather than genuine
 * movement, and is discarded the same way a too-inaccurate fix is. ~8 m/s
 * (~29 km/h) is deliberately generous: well above a brisk walk or even a
 * light jog with the dog (a family walk is the target use case, not
 * running/cycling), so a fast-but-real pace is never falsely rejected,
 * while a genuine teleport (hundreds of meters in a few seconds) always is.
 */
export const MAX_SPEED_METERS_PER_SECOND = 8;

export interface GpsAccumulator {
  distanceMeters: number;
  pointCount: number;
  lastPoint: GpsPoint | null;
  /** Accepted route points retained only for the completed walk preview. */
  routePoints: GpsPoint[];
}

export function createGpsAccumulator(): GpsAccumulator {
  return { distanceMeters: 0, pointCount: 0, lastPoint: null, routePoints: [] };
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
    return { ...acc, pointCount: acc.pointCount + 1, lastPoint: point, routePoints: [point] };
  }
  const elapsedSeconds = (point.timestamp - acc.lastPoint.timestamp) / 1000;
  if (elapsedSeconds <= 0) {
    // A fix that doesn't move time forward relative to the last accepted
    // one — a duplicate timestamp, or a genuinely out-of-order delivery
    // (rare, but watchPositionAsync gives no ordering guarantee across
    // platforms). Never divide by a non-positive elapsed time below; treat
    // exactly like an untrustworthy fix — same as an inaccurate reading.
    return acc;
  }
  const delta = haversineDistanceMeters(acc.lastPoint, point);
  if (delta / elapsedSeconds > MAX_SPEED_METERS_PER_SECOND) {
    // Implausible jump for a walk (see MAX_SPEED_METERS_PER_SECOND's own
    // doc comment) — discarded the same way a too-inaccurate fix is,
    // rather than folded into the route/distance.
    return acc;
  }
  if (delta < MIN_MOVEMENT_METERS) {
    // Still counts as an observed point (for pointCount/diagnostics), but
    // doesn't move `lastPoint` forward — otherwise a string of sub-floor
    // jitters would each pass the floor against the PREVIOUS jitter and
    // slowly accumulate real-looking distance from pure noise.
    return { distanceMeters: acc.distanceMeters, pointCount: acc.pointCount + 1, lastPoint: acc.lastPoint, routePoints: acc.routePoints };
  }
    return { distanceMeters: acc.distanceMeters + delta, pointCount: acc.pointCount + 1, lastPoint: point, routePoints: [...acc.routePoints, point] };
}
