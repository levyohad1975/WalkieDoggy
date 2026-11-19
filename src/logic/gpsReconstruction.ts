import type { WalkGpsSession } from '../types';
import { haversineDistanceMeters } from './gpsDistance';

export interface VerifiedHomeLocation {
  latitude: number;
  longitude: number;
  accuracyMeters: number;
  verifiedAt: string;
  verifiedByUserId: string;
}

export interface GpsReconstruction {
  /** Estimated path from home to the first reliable measured fix. */
  routePoints: Array<{ latitude: number; longitude: number; timestamp: number }>;
  distanceMeters: number;
  durationSeconds: number;
  confidence: 'high' | 'low';
  sourceWalkId: string;
}

export const GPS_HOME_DRIFT_METERS = 100;
export const GPS_HOME_MATCH_METERS = 100;
export const GPS_CURRENT_FIX_MAX_ACCURACY_METERS = 25;
const MAX_ROUTE_ENDPOINT_MATCH_METERS = 90;
const MAX_HISTORICAL_HOME_GAP_METERS = 50;
const MIN_HISTORICAL_ROUTE_POINTS = 5;
const FALLBACK_WALKING_SPEED_MPS = 1.1;

/** A start is considered away from home only beyond the configured radius plus reported uncertainty. */
export function isPotentialLateGpsStart(
  home: Pick<VerifiedHomeLocation, 'latitude' | 'longitude'>,
  firstFix: { latitude: number; longitude: number; accuracy?: number | null },
): boolean {
  if (firstFix.accuracy == null || !Number.isFinite(firstFix.accuracy) || firstFix.accuracy > GPS_CURRENT_FIX_MAX_ACCURACY_METERS) return false;
  return distance(home, firstFix) > GPS_HOME_DRIFT_METERS + firstFix.accuracy;
}

/**
 * Reconstruct only when one completed, same-dog route has a verified-home
 * origin/return and a close, directionally continuous sample near the first
 * current fix. Inputs must already be restricted to completed walks in the
 * active family; route geometry itself is never fabricated.
 */
export function reconstructMissingRoute(input: {
  familyId: string;
  dogId: string;
  home: VerifiedHomeLocation;
  firstFix: { latitude: number; longitude: number; timestamp: number; accuracy?: number | null };
  nextFix?: { latitude: number; longitude: number; timestamp: number };
  historicalSessions: WalkGpsSession[];
}): GpsReconstruction | null {
  if (!isPotentialLateGpsStart(input.home, input.firstFix)) return null;
  const candidates: Array<{ session: WalkGpsSession; points: NonNullable<WalkGpsSession['routePoints']>; index: number; gap: number; headingGap: number; homeGap: number }> = [];
  for (const session of input.historicalSessions) {
    if (session.familyId !== input.familyId || session.dogId !== input.dogId || !session.endedAt) continue;
    const points = session.routePoints ?? [];
    if (points.length < MIN_HISTORICAL_ROUTE_POINTS) continue;
    const homeGap = distance(input.home, points[0]);
    if (homeGap > MAX_HISTORICAL_HOME_GAP_METERS || distance(input.home, points[points.length - 1]) > MAX_HISTORICAL_HOME_GAP_METERS) continue;
    if (!hasPlausibleHistoricalPace(points)) continue;
    let index = -1;
    let gap = Infinity;
    for (let i = 1; i < points.length - 1; i += 1) {
      const currentDistance = haversineDistanceMeters(points[i], input.firstFix);
      if (currentDistance < gap) { gap = currentDistance; index = i; }
    }
    if (index < 1 || gap > MAX_ROUTE_ENDPOINT_MATCH_METERS) continue;
    let headingGap = 0;
    if (input.nextFix) {
      const hA = heading(points[index], points[Math.min(index + 1, points.length - 1)]);
      const hB = heading(input.firstFix, input.nextFix);
      headingGap = Math.abs(((hA - hB + 540) % 360) - 180);
      if (headingGap > 100) continue;
    }
    candidates.push({ session, points, index, gap, headingGap, homeGap });
  }
  candidates.sort((a, b) => (a.gap + a.headingGap * 0.35) - (b.gap + b.headingGap * 0.35));
  const best = candidates[0];
  if (!best) return null;
  // An ambiguous second route must not be presented as a precise reconstruction.
  const second = candidates[1];
  const highConfidence = best.gap <= 45 && best.headingGap <= 45 && best.homeGap <= 20 && (!second || second.gap - best.gap >= 25 || Math.abs(second.headingGap - best.headingGap) >= 45);
  const routePoints = [
    // Estimated points intentionally carry no historical timestamps. Time is
    // represented only by durationSeconds, never as a recorded walk start.
    { latitude: input.home.latitude, longitude: input.home.longitude, timestamp: 0 },
    ...best.points.slice(0, best.index + 1).map(({ latitude, longitude }) => ({ latitude, longitude, timestamp: 0 })),
  ];
  const distanceMeters = routePoints.slice(1).reduce((sum, point, index) => sum + haversineDistanceMeters(routePoints[index], point), 0);
  const firstTimestamp = best.points[0]?.timestamp;
  const matchedTimestamp = best.points[best.index]?.timestamp;
  const recordedDuration = matchedTimestamp && firstTimestamp && matchedTimestamp > firstTimestamp ? (matchedTimestamp - firstTimestamp) / 1000 : 0;
  const historicalSpeed = recordedDuration > 0 ? distanceMeters / recordedDuration : 0;
  const durationSeconds = recordedDuration > 0 && historicalSpeed >= 0.25 && historicalSpeed <= 2.4
    ? recordedDuration
    : distanceMeters / FALLBACK_WALKING_SPEED_MPS;
  if (!Number.isFinite(distanceMeters) || distanceMeters < GPS_HOME_DRIFT_METERS || durationSeconds <= 0) return null;
  return { routePoints, distanceMeters, durationSeconds, confidence: highConfidence ? 'high' : 'low', sourceWalkId: best.session.walkId };
}

function heading(a: { latitude: number; longitude: number }, b: { latitude: number; longitude: number }): number {
  const lat1 = a.latitude * Math.PI / 180;
  const lat2 = b.latitude * Math.PI / 180;
  const dLon = (b.longitude - a.longitude) * Math.PI / 180;
  return (Math.atan2(Math.sin(dLon) * Math.cos(lat2), Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon)) * 180 / Math.PI + 360) % 360;
}

function hasPlausibleHistoricalPace(points: NonNullable<WalkGpsSession['routePoints']>): boolean {
  for (let i = 1; i < points.length; i += 1) {
    const seconds = (points[i].timestamp - points[i - 1].timestamp) / 1000;
    if (!Number.isFinite(seconds) || seconds <= 0) return false;
    if (haversineDistanceMeters(points[i - 1], points[i]) / seconds > 4) return false;
  }
  return true;
}

function distance(a: { latitude: number; longitude: number }, b: { latitude: number; longitude: number }): number {
  return haversineDistanceMeters({ ...a, timestamp: 0 }, { ...b, timestamp: 0 });
}
