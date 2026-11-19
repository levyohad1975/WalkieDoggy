import type { Walk } from '../../types';

/**
 * Field report 2026-11-05: live walk routes froze when the walker's iPhone
 * locked and suspended the GPS watch. gpsStore now holds a screen wake lock
 * while this device is actively tracking, and releases it on stop/cancel.
 * The wake-lock module itself is mocked here (its own behaviour is covered by
 * src/lib/__tests__/screenWakeLock.test.ts); this asserts the wiring.
 */
jest.mock('../../lib/screenWakeLock', () => ({
  acquireScreenWakeLock: jest.fn(),
  releaseScreenWakeLock: jest.fn(() => Promise.resolve()),
}));

describe('gpsStore ↔ screen wake lock', () => {
  beforeEach(() => {
    jest.resetModules();
  });

  const walk: Pick<Walk, 'id' | 'familyId' | 'dogId'> = { id: 'walk-1', familyId: 'family-1', dogId: 'dog-1' };

  it('acquires the wake lock once a live GPS watch handle exists (the walker is actually tracking)', async () => {
    const { useGpsStore } = require('../gpsStore');
    const gpsTracking = require('../../lib/gpsTracking');
    const wakeLock = require('../../lib/screenWakeLock');
    jest.spyOn(gpsTracking, 'startGpsWatch').mockResolvedValueOnce({ handle: { remove: jest.fn() }, permissionStatus: 'granted' });

    await useGpsStore.getState().startTracking(walk);

    expect(wakeLock.acquireScreenWakeLock).toHaveBeenCalledTimes(1);
  });

  it('does NOT acquire the wake lock when no watch handle is created (permission denied)', async () => {
    const { useGpsStore } = require('../gpsStore');
    const gpsTracking = require('../../lib/gpsTracking');
    const wakeLock = require('../../lib/screenWakeLock');
    jest.spyOn(gpsTracking, 'startGpsWatch').mockResolvedValueOnce({ handle: null, permissionStatus: 'denied', trackingStatus: 'denied' });

    await useGpsStore.getState().startTracking(walk);

    expect(wakeLock.acquireScreenWakeLock).not.toHaveBeenCalled();
  });

  it('releases the wake lock when tracking stops', async () => {
    const { useGpsStore } = require('../gpsStore');
    const { repository } = require('../../data');
    const gpsTracking = require('../../lib/gpsTracking');
    const wakeLock = require('../../lib/screenWakeLock');
    jest.spyOn(repository, 'upsertGpsSession').mockResolvedValue(undefined);
    jest.spyOn(gpsTracking, 'startGpsWatch').mockResolvedValueOnce({ handle: { remove: jest.fn() }, permissionStatus: 'granted' });

    await useGpsStore.getState().startTracking(walk);
    await useGpsStore.getState().stopTracking(walk, 'user-1', 'walk_finished').catch(() => undefined);

    expect(wakeLock.releaseScreenWakeLock).toHaveBeenCalled();
  });

  it('releases the wake lock when tracking is cancelled', async () => {
    const { useGpsStore } = require('../gpsStore');
    const gpsTracking = require('../../lib/gpsTracking');
    const wakeLock = require('../../lib/screenWakeLock');
    jest.spyOn(gpsTracking, 'startGpsWatch').mockResolvedValueOnce({ handle: { remove: jest.fn() }, permissionStatus: 'granted' });

    await useGpsStore.getState().startTracking(walk);
    useGpsStore.getState().cancelTracking('walk-1', 'test_cleanup');

    expect(wakeLock.releaseScreenWakeLock).toHaveBeenCalled();
  });
});
