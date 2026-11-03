import type { WalkGpsSession } from '../../types';
import { isPotentialLateGpsStart, reconstructMissingRoute, VerifiedHomeLocation } from '../gpsReconstruction';

const home: VerifiedHomeLocation = { latitude: 32, longitude: 34, accuracyMeters: 8, verifiedAt: '2026-10-22T10:00:00Z', verifiedByUserId: 'admin-1' };
const route = [
  [32, 34], [32.0005, 34], [32.001, 34], [32.0015, 34], [32.002, 34], [32.0015, 34], [32.001, 34], [32.0005, 34], [32, 34],
].map(([latitude, longitude], index) => ({ latitude, longitude, timestamp: 1_800_000_000_000 + index * 60_000 }));
const completedSession = (walkId = 'walk-old', routePoints = route, patch: Partial<WalkGpsSession> = {}): WalkGpsSession => ({
  id: `gps-${walkId}`, walkId, familyId: 'family-1', dogId: 'dog-1', distanceMeters: 900, pointCount: routePoints.length,
  routePoints, startedAt: '2026-10-20T10:00:00Z', endedAt: '2026-10-20T10:20:00Z', source: 'device_gps', createdAt: 'c', updatedAt: 'u', ...patch,
});
const fix = { latitude: route[4].latitude, longitude: route[4].longitude, timestamp: 1_800_100_000_000, accuracy: 8 };

describe('automatic GPS route reconstruction', () => {
  it('does not reconstruct when tracking starts at home', () => {
    expect(isPotentialLateGpsStart(home, { latitude: 32.0001, longitude: 34, accuracy: 8 })).toBe(false);
  });

  it('reconstructs the measured historical prefix when GPS starts midway along it', () => {
    const history = completedSession();
    const result = reconstructMissingRoute({ familyId: 'family-1', dogId: 'dog-1', home, firstFix: fix, historicalSessions: [history] });
    expect(result).not.toBeNull();
    expect(result?.routePoints[0]).toMatchObject({ latitude: home.latitude, longitude: home.longitude });
    expect(result?.routePoints.at(-1)).toMatchObject({ latitude: fix.latitude, longitude: fix.longitude });
    expect(result?.distanceMeters).toBeGreaterThan(100);
    expect(result?.durationSeconds).toBeGreaterThan(0);
    expect(result?.confidence).toBe('high');
  });

  it('labels equally plausible historical routes low confidence instead of selecting one as certain', () => {
    const result = reconstructMissingRoute({ familyId: 'family-1', dogId: 'dog-1', home, firstFix: fix, historicalSessions: [completedSession('one'), completedSession('two')] });
    expect(result?.confidence).toBe('low');
  });

  it('returns no route when completed GPS history is too short or missing', () => {
    expect(reconstructMissingRoute({ familyId: 'family-1', dogId: 'dog-1', home, firstFix: fix, historicalSessions: [] })).toBeNull();
    expect(reconstructMissingRoute({ familyId: 'family-1', dogId: 'dog-1', home, firstFix: fix, historicalSessions: [completedSession('short', route.slice(0, 3))] })).toBeNull();
  });

  it('rejects poor current accuracy and near-home GPS drift', () => {
    expect(isPotentialLateGpsStart(home, { ...fix, accuracy: 40 })).toBe(false);
    expect(reconstructMissingRoute({ familyId: 'family-1', dogId: 'dog-1', home, firstFix: { ...fix, accuracy: 40 }, historicalSessions: [completedSession()] })).toBeNull();
    expect(isPotentialLateGpsStart(home, { latitude: 32.0005, longitude: 34, accuracy: 15 })).toBe(false);
  });

  it('filters routes by family, dog, completed state, and return near home', () => {
    const wrongFamily = completedSession('other-family', route, { familyId: 'family-2' });
    const wrongDog = completedSession('other-dog', route, { dogId: 'dog-2' });
    const notCompleted = completedSession('active', route, { endedAt: undefined });
    const didNotReturnHome = completedSession('far-end', route.map((p, i) => i === route.length - 1 ? { ...p, latitude: 32.02 } : p));
    expect(reconstructMissingRoute({ familyId: 'family-1', dogId: 'dog-1', home, firstFix: fix, historicalSessions: [wrongFamily, wrongDog, notCompleted, didNotReturnHome] })).toBeNull();
  });

  it('does not mutate or replace measured route values and timestamps', () => {
    const existing = completedSession();
    const original = structuredClone(existing);
    const estimate = reconstructMissingRoute({ familyId: 'family-1', dogId: 'dog-1', home, firstFix: fix, historicalSessions: [existing] });
    const displayModel = { ...existing, reconstruction: estimate ?? undefined };
    expect(existing).toEqual(original);
    expect(displayModel.distanceMeters).toBe(900);
    expect(displayModel.startedAt).toBe(original.startedAt);
    expect(displayModel.routePoints).toEqual(original.routePoints);
    expect(displayModel.reconstruction?.durationSeconds).not.toEqual(new Date(displayModel.startedAt!).getTime());
  });

  it('prefers the route direction that continues toward the next live fix', () => {
    const oppositeDirectionFix = { latitude: 32.0025, longitude: 34, timestamp: fix.timestamp + 10_000 };
    const result = reconstructMissingRoute({ familyId: 'family-1', dogId: 'dog-1', home, firstFix: fix, nextFix: oppositeDirectionFix, historicalSessions: [completedSession()] });
    expect(result).toBeNull();
  });
});
