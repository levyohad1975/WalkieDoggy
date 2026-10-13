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
    jest.spyOn(gpsTracking, 'startGpsWatch').mockResolvedValueOnce({ handle: { remove: jest.fn() }, permissionStatus: 'granted' });

    await useGpsStore.getState().startTracking(walk);

    const state = useGpsStore.getState();
    expect(state.trackingWalkId).toBe('walk-1');
    expect(state.permissionStatus).toBe('granted');
  });

  it('startTracking with no handle keeps the active walk visible and sets permissionStatus "denied"', async () => {
    const { useGpsStore } = require('../gpsStore');
    const gpsTracking = require('../../lib/gpsTracking');
    jest.spyOn(gpsTracking, 'startGpsWatch').mockResolvedValueOnce({ handle: null, permissionStatus: 'denied' });

    await useGpsStore.getState().startTracking(walk);

    const state = useGpsStore.getState();
    expect(state.trackingWalkId).toBe(walk.id);
    expect(state.permissionStatus).toBe('denied');
  });

  it('keeps an unavailable browser/provider failure distinct from a denied permission', async () => {
    const { useGpsStore } = require('../gpsStore');
    const gpsTracking = require('../../lib/gpsTracking');
    jest.spyOn(gpsTracking, 'startGpsWatch').mockResolvedValueOnce({ handle: null, permissionStatus: 'unavailable' });

    await useGpsStore.getState().startTracking(walk);

    expect(useGpsStore.getState()).toMatchObject({ trackingWalkId: walk.id, permissionStatus: 'unavailable' });
  });

  it('feeds live distance/pointCount updates from the onUpdate callback into state', async () => {
    const { useGpsStore } = require('../gpsStore');
    const gpsTracking = require('../../lib/gpsTracking');
    let feed: (acc: { distanceMeters: number; pointCount: number; routePoints: Array<{ latitude: number; longitude: number; timestamp: number }> }) => void = () => undefined;
    jest.spyOn(gpsTracking, 'startGpsWatch').mockImplementationOnce(async (onUpdate: any) => {
      feed = onUpdate;
      return { handle: { remove: jest.fn() }, permissionStatus: 'granted' };
    });

    await useGpsStore.getState().startTracking(walk);
    feed({ distanceMeters: 123.4, pointCount: 7, routePoints: [] });

    const state = useGpsStore.getState();
    expect(state.distanceMeters).toBe(123.4);
    expect(state.pointCount).toBe(7);
  });

  it('rebinds an active foreground watch to the canonical server walk ID and persists the collected GPS session there', async () => {
    const { useGpsStore } = require('../gpsStore');
    const { repository } = require('../../data');
    const gpsTracking = require('../../lib/gpsTracking');
    const localScheduledWalk = { ...walk, scheduleEntryId: 'entry-1' };
    const canonicalWalk = { ...localScheduledWalk, id: 'walk-server-canonical' };
    let feed: (acc: { distanceMeters: number; pointCount: number; routePoints: Array<{ latitude: number; longitude: number; timestamp: number }> }) => void = () => undefined;
    const remove = jest.fn();
    let resolveWatch!: (result: any) => void;
    jest.spyOn(gpsTracking, 'startGpsWatch').mockImplementationOnce((onUpdate: any) => {
      feed = onUpdate;
      return new Promise((resolve) => { resolveWatch = resolve; });
    });
    const upsertSpy = jest.spyOn(repository, 'upsertGpsSession').mockResolvedValue(undefined);

    const starting = useGpsStore.getState().startTracking(localScheduledWalk);
    expect(useGpsStore.getState().trackingWalkId).toBe('walk-1');
    expect(useGpsStore.getState().rebindTrackingWalk(localScheduledWalk, canonicalWalk)).toBe(true);
    expect(useGpsStore.getState().trackingWalkId).toBe('walk-server-canonical');
    // iOS permission/watch setup can still be resolving when the server
    // returns its canonical row. The watch must remain attached afterward.
    resolveWatch({ handle: { remove }, permissionStatus: 'granted', trackingStatus: 'waiting' });
    await starting;

    // A callback from the same still-running Safari watch must survive the
    // ID adoption instead of being discarded as belonging to the stale row.
    const routePoints = [
      { latitude: 32.08, longitude: 34.78, timestamp: 1 },
      { latitude: 32.081, longitude: 34.781, timestamp: 2 },
    ];
    feed({ distanceMeters: 247, pointCount: 4, routePoints });
    expect(useGpsStore.getState()).toMatchObject({ trackingWalkId: 'walk-server-canonical', distanceMeters: 247, pointCount: 4, routePoints });

    const result = await useGpsStore.getState().stopTracking(canonicalWalk, 'user-aba');
    expect(remove).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ walkId: 'walk-server-canonical', familyId: 'family-1', dogId: 'dog-1', distanceMeters: 247, pointCount: 4, routePoints });
    expect(upsertSpy).toHaveBeenCalledWith(expect.objectContaining({ walkId: 'walk-server-canonical', distanceMeters: 247, routePoints }));
  });

  it('refuses to rebind a tracking session across family, dog, or schedule-entry ownership', async () => {
    const { useGpsStore } = require('../gpsStore');
    const gpsTracking = require('../../lib/gpsTracking');
    const localScheduledWalk = { ...walk, scheduleEntryId: 'entry-1' };
    jest.spyOn(gpsTracking, 'startGpsWatch').mockResolvedValueOnce({ handle: { remove: jest.fn() }, permissionStatus: 'granted' });
    await useGpsStore.getState().startTracking(localScheduledWalk);

    expect(useGpsStore.getState().rebindTrackingWalk(localScheduledWalk, { ...localScheduledWalk, id: 'other', familyId: 'family-2' })).toBe(false);
    expect(useGpsStore.getState().rebindTrackingWalk(localScheduledWalk, { ...localScheduledWalk, id: 'other', dogId: 'dog-2' })).toBe(false);
    expect(useGpsStore.getState().rebindTrackingWalk(localScheduledWalk, { ...localScheduledWalk, id: 'other', scheduleEntryId: 'entry-2' })).toBe(false);
    const withoutScheduleEvidence = { ...localScheduledWalk, scheduleEntryId: undefined };
    expect(useGpsStore.getState().rebindTrackingWalk(withoutScheduleEvidence, { ...withoutScheduleEvidence, id: 'other' })).toBe(false);
    expect(useGpsStore.getState().trackingWalkId).toBe('walk-1');
    await useGpsStore.getState().stopTracking(localScheduledWalk, 'user-aba');
  });

  it('starting a new walk while a previous handle is active removes the old one first (no subscription leak)', async () => {
    const { useGpsStore } = require('../gpsStore');
    const gpsTracking = require('../../lib/gpsTracking');
    const firstRemove = jest.fn();
    jest.spyOn(gpsTracking, 'startGpsWatch')
      .mockResolvedValueOnce({ handle: { remove: firstRemove }, permissionStatus: 'granted' })
      .mockResolvedValueOnce({ handle: { remove: jest.fn() }, permissionStatus: 'granted' });

    await useGpsStore.getState().startTracking({ id: 'walk-a', familyId: 'family-1', dogId: 'dog-1' });
    await useGpsStore.getState().startTracking({ id: 'walk-b', familyId: 'family-1', dogId: 'dog-1' });

    expect(firstRemove).toHaveBeenCalledTimes(1);
    expect(useGpsStore.getState().trackingWalkId).toBe('walk-b');
  });

  it('coalesces duplicate start requests for the same walk into one watch', async () => {
    const { useGpsStore } = require('../gpsStore');
    const gpsTracking = require('../../lib/gpsTracking');
    const startSpy = jest.spyOn(gpsTracking, 'startGpsWatch').mockResolvedValueOnce({ handle: { remove: jest.fn() }, permissionStatus: 'granted', trackingStatus: 'waiting' });

    await Promise.all([useGpsStore.getState().startTracking(walk), useGpsStore.getState().startTracking(walk)]);

    expect(startSpy).toHaveBeenCalledTimes(1);
  });

  it('stopping while GPS startup is pending invalidates and removes the late watch', async () => {
    const { useGpsStore } = require('../gpsStore');
    const gpsTracking = require('../../lib/gpsTracking');
    let resolveStart!: (value: any) => void;
    const remove = jest.fn();
    jest.spyOn(gpsTracking, 'startGpsWatch').mockImplementationOnce(() => new Promise((resolve: any) => { resolveStart = resolve; }));

    const starting = useGpsStore.getState().startTracking(walk);
    await useGpsStore.getState().stopTracking(walk, 'user-aba');
    resolveStart({ handle: { remove }, permissionStatus: 'granted', trackingStatus: 'waiting' });
    await starting;

    expect(remove).toHaveBeenCalledTimes(1);
    expect(useGpsStore.getState().trackingWalkId).toBeNull();
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
    jest.spyOn(gpsTracking, 'startGpsWatch').mockResolvedValueOnce({ handle: { remove: jest.fn() }, permissionStatus: 'granted' });
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
      return { handle: { remove: removeMock }, permissionStatus: 'granted' };
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

  it('attributes a remote GPS session to the target device performer, not the scheduled member', async () => {
    const { useGpsStore } = require('../gpsStore');
    const { repository } = require('../../data');
    const gpsTracking = require('../../lib/gpsTracking');
    const targetDevice = { ...walk, responsibleUserId: 'omer' };
    jest.spyOn(gpsTracking, 'startGpsWatch').mockImplementationOnce(async (onUpdate: any) => {
      onUpdate({ distanceMeters: 250, pointCount: 3, routePoints: [] });
      return { handle: { remove: jest.fn() }, permissionStatus: 'granted' };
    });
    const upsertSpy = jest.spyOn(repository, 'upsertGpsSession').mockResolvedValue(undefined);
    await useGpsStore.getState().startTracking(targetDevice);
    const session = await useGpsStore.getState().stopTracking(targetDevice, 'avi');
    expect(session).toMatchObject({ walkId: 'walk-1', createdByUserId: 'avi', source: 'device_gps', pointCount: 3 });
    expect(upsertSpy).toHaveBeenCalledWith(expect.objectContaining({ createdByUserId: 'avi' }));
  });

  it('GPS audit fix: persists the session\'s startedAt/endedAt — previously always omitted even though the schema/repository already round-trip them', async () => {
    const { useGpsStore } = require('../gpsStore');
    const gpsTracking = require('../../lib/gpsTracking');
    let feed: (acc: { distanceMeters: number; pointCount: number; routePoints: never[] }) => void = () => undefined;
    jest.spyOn(gpsTracking, 'startGpsWatch').mockImplementationOnce(async (onUpdate: any) => {
      feed = onUpdate;
      return { handle: { remove: jest.fn() }, permissionStatus: 'granted' };
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
