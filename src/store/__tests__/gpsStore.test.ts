import type { Walk, WalkGpsSession } from '../../types';

/**
 * Phase 4 kickoff (GPS foundation, PRD §7) — gpsStore owns the foreground
 * tracking session lifecycle: start on walk-start, stop (persisting the
 * final reading) on walk-end, and the required correction flow. Mocks
 * lib/gpsTracking's startGpsWatch() directly (already unit-tested on its
 * own in gpsTracking.test.ts) rather than expo-location itself.
 */
describe('gpsStore', () => {
  beforeEach(() => {
    jest.resetModules();
  });

  const walk: Pick<Walk, 'id' | 'familyId' | 'dogId'> = { id: 'walk-1', familyId: 'family-1', dogId: 'dog-1' };

  it('startTracking with a granted handle sets trackingWalkId + permissionStatus "granted"', async () => {
    const { useGpsStore } = require('../gpsStore');
    const gpsTracking = require('../../lib/gpsTracking');
    jest.spyOn(gpsTracking, 'startGpsWatch').mockResolvedValueOnce({ remove: jest.fn() });

    await useGpsStore.getState().startTracking(walk);

    const state = useGpsStore.getState();
    expect(state.trackingWalkId).toBe('walk-1');
    expect(state.permissionStatus).toBe('granted');
  });

  it('startTracking with no handle (denied/unavailable) leaves trackingWalkId null and sets permissionStatus "denied"', async () => {
    const { useGpsStore } = require('../gpsStore');
    const gpsTracking = require('../../lib/gpsTracking');
    jest.spyOn(gpsTracking, 'startGpsWatch').mockResolvedValueOnce(null);

    await useGpsStore.getState().startTracking(walk);

    const state = useGpsStore.getState();
    expect(state.trackingWalkId).toBeNull();
    expect(state.permissionStatus).toBe('denied');
  });

  it('feeds live distance/pointCount updates from the onUpdate callback into state', async () => {
    const { useGpsStore } = require('../gpsStore');
    const gpsTracking = require('../../lib/gpsTracking');
    let feed: (acc: { distanceMeters: number; pointCount: number; routePoints: never[] }) => void = () => undefined;
    jest.spyOn(gpsTracking, 'startGpsWatch').mockImplementationOnce(async (onUpdate: any) => {
      feed = onUpdate;
      return { remove: jest.fn() };
    });

    await useGpsStore.getState().startTracking(walk);
    feed({ distanceMeters: 123.4, pointCount: 7, routePoints: [] });

    const state = useGpsStore.getState();
    expect(state.distanceMeters).toBe(123.4);
    expect(state.pointCount).toBe(7);
  });

  it('starting a new walk while a previous handle is active removes the old one first (no subscription leak)', async () => {
    const { useGpsStore } = require('../gpsStore');
    const gpsTracking = require('../../lib/gpsTracking');
    const firstRemove = jest.fn();
    jest.spyOn(gpsTracking, 'startGpsWatch')
      .mockResolvedValueOnce({ remove: firstRemove })
      .mockResolvedValueOnce({ remove: jest.fn() });

    await useGpsStore.getState().startTracking({ id: 'walk-a', familyId: 'family-1', dogId: 'dog-1' });
    await useGpsStore.getState().startTracking({ id: 'walk-b', familyId: 'family-1', dogId: 'dog-1' });

    expect(firstRemove).toHaveBeenCalledTimes(1);
    expect(useGpsStore.getState().trackingWalkId).toBe('walk-b');
  });

  it('stopTracking for a walk that was never being tracked returns null and persists nothing', async () => {
    const { useGpsStore } = require('../gpsStore');
    const { repository } = require('../../data');
    const upsertSpy = jest.spyOn(repository, 'upsertGpsSession').mockResolvedValue(undefined);

    const result = await useGpsStore.getState().stopTracking(walk, 'user-aba');

    expect(result).toBeNull();
    expect(upsertSpy).not.toHaveBeenCalled();
  });

  it('stopTracking with zero points captured returns null and persists nothing (nothing worth saving)', async () => {
    const { useGpsStore } = require('../gpsStore');
    const { repository } = require('../../data');
    const gpsTracking = require('../../lib/gpsTracking');
    jest.spyOn(gpsTracking, 'startGpsWatch').mockResolvedValueOnce({ remove: jest.fn() });
    const upsertSpy = jest.spyOn(repository, 'upsertGpsSession').mockResolvedValue(undefined);

    await useGpsStore.getState().startTracking(walk);
    const result = await useGpsStore.getState().stopTracking(walk, 'user-aba');

    expect(result).toBeNull();
    expect(upsertSpy).not.toHaveBeenCalled();
    expect(useGpsStore.getState().trackingWalkId).toBeNull();
  });

  it('stopTracking with captured points persists a session with this walk\'s familyId/dogId and removes the OS subscription', async () => {
    const { useGpsStore } = require('../gpsStore');
    const { repository } = require('../../data');
    const gpsTracking = require('../../lib/gpsTracking');
    const removeMock = jest.fn();
    let feed: (acc: { distanceMeters: number; pointCount: number; routePoints: never[] }) => void = () => undefined;
    jest.spyOn(gpsTracking, 'startGpsWatch').mockImplementationOnce(async (onUpdate: any) => {
      feed = onUpdate;
      return { remove: removeMock };
    });
    const upsertSpy = jest.spyOn(repository, 'upsertGpsSession').mockResolvedValue(undefined);

    await useGpsStore.getState().startTracking(walk);
    feed({ distanceMeters: 900.5, pointCount: 42, routePoints: [] });

    const result = await useGpsStore.getState().stopTracking(walk, 'user-aba');

    expect(removeMock).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({
      walkId: 'walk-1', familyId: 'family-1', dogId: 'dog-1',
      distanceMeters: 900.5, pointCount: 42, source: 'device_gps', createdByUserId: 'user-aba',
    });
    expect(upsertSpy).toHaveBeenCalledWith(expect.objectContaining({ walkId: 'walk-1', distanceMeters: 900.5 }));
    expect(useGpsStore.getState().sessionsByWalkId['walk-1']).toEqual(result);
    expect(useGpsStore.getState().trackingWalkId).toBeNull();
  });

  it('GPS audit fix: persists the session\'s startedAt/endedAt — previously always omitted even though the schema/repository already round-trip them', async () => {
    const { useGpsStore } = require('../gpsStore');
    const gpsTracking = require('../../lib/gpsTracking');
    let feed: (acc: { distanceMeters: number; pointCount: number; routePoints: never[] }) => void = () => undefined;
    jest.spyOn(gpsTracking, 'startGpsWatch').mockImplementationOnce(async (onUpdate: any) => {
      feed = onUpdate;
      return { remove: jest.fn() };
    });

    expect(useGpsStore.getState().trackingStartedAt).toBeNull();
    await useGpsStore.getState().startTracking(walk);
    // startTracking() only sets trackingStartedAt once the watch actually
    // starts (after startGpsWatch() resolves) — not merely on being called.
    const startedAt = useGpsStore.getState().trackingStartedAt;
    expect(startedAt).toEqual(expect.any(String));
    expect(Number.isNaN(new Date(startedAt!).getTime())).toBe(false);

    feed({ distanceMeters: 200, pointCount: 10, routePoints: [] });
    const result = await useGpsStore.getState().stopTracking(walk, 'user-aba');

    expect(result?.startedAt).toBe(startedAt);
    expect(result?.endedAt).toEqual(expect.any(String));
    expect(new Date(result!.endedAt!).getTime()).toBeGreaterThanOrEqual(new Date(startedAt!).getTime());
    // Reset for the next tracking round, not left stale.
    expect(useGpsStore.getState().trackingStartedAt).toBeNull();
  });

  it('loadSession fetches a persisted session from the repository and caches it', async () => {
    const { useGpsStore } = require('../gpsStore');
    const { repository } = require('../../data');
    const session: WalkGpsSession = {
      id: 'gps-1', walkId: 'walk-1', familyId: 'family-1', dogId: 'dog-1',
      distanceMeters: 500, pointCount: 10, source: 'device_gps', createdAt: 'c', updatedAt: 'u',
    };
    jest.spyOn(repository, 'getGpsSession').mockResolvedValueOnce(session);

    const result = await useGpsStore.getState().loadSession('walk-1');

    expect(result).toEqual(session);
    expect(useGpsStore.getState().sessionsByWalkId['walk-1']).toEqual(session);
  });

  it('correctDistance sets correctedDistanceMeters/correctedByUserId while preserving the original distanceMeters', async () => {
    const { useGpsStore } = require('../gpsStore');
    const { repository } = require('../../data');
    const session: WalkGpsSession = {
      id: 'gps-1', walkId: 'walk-1', familyId: 'family-1', dogId: 'dog-1',
      distanceMeters: 900.5, pointCount: 42, source: 'device_gps', createdAt: 'c', updatedAt: 'u',
    };
    jest.spyOn(repository, 'getGpsSession').mockResolvedValueOnce(session);
    const upsertSpy = jest.spyOn(repository, 'upsertGpsSession').mockResolvedValue(undefined);

    const result = await useGpsStore.getState().correctDistance('walk-1', 850, 'user-ima');

    expect(result?.distanceMeters).toBe(900.5); // original preserved
    expect(result?.correctedDistanceMeters).toBe(850);
    expect(result?.correctedByUserId).toBe('user-ima');
    expect(upsertSpy).toHaveBeenCalledWith(expect.objectContaining({ correctedDistanceMeters: 850 }));
  });

  it('correctDistance returns undefined when the walk has no session at all', async () => {
    const { useGpsStore } = require('../gpsStore');
    const { repository } = require('../../data');
    jest.spyOn(repository, 'getGpsSession').mockResolvedValueOnce(undefined);

    const result = await useGpsStore.getState().correctDistance('walk-no-session', 500, 'user-aba');

    expect(result).toBeUndefined();
  });
});
