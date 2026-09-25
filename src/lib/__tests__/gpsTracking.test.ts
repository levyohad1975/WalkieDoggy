/**
 * gpsTracking.ts loads expo-location lazily via require() (no module-scope
 * import) — same reason as notificationService.ts's getNotifications(), so
 * each test here uses jest.doMock + jest.resetModules() + a fresh require(),
 * the same established pattern src/lib/__tests__/pushTokensNative.test.ts
 * documents for a lazily-required native module, rather than a global
 * static mock.
 */
describe('gpsTracking', () => {
  beforeEach(() => {
    jest.resetModules();
  });

  function mockLocationModule(overrides: Record<string, jest.Mock> = {}) {
    const mocks = {
      getForegroundPermissionsAsync: jest.fn().mockResolvedValue({ granted: false }),
      requestForegroundPermissionsAsync: jest.fn().mockResolvedValue({ granted: true }),
      watchPositionAsync: jest.fn().mockResolvedValue({ remove: jest.fn() }),
      ...overrides,
    };
    jest.doMock('expo-location', () => ({
      ...mocks,
      Accuracy: { Balanced: 3 },
    }));
    return mocks;
  }

  describe('requestForegroundGpsPermission', () => {
    it('returns "granted" immediately when already granted, without re-prompting', async () => {
      const mocks = mockLocationModule({ getForegroundPermissionsAsync: jest.fn().mockResolvedValue({ granted: true }) });
      const { requestForegroundGpsPermission } = require('../gpsTracking');

      const status = await requestForegroundGpsPermission();

      expect(status).toBe('granted');
      expect(mocks.requestForegroundPermissionsAsync).not.toHaveBeenCalled();
    });

    it('requests and returns "granted" when the user approves', async () => {
      mockLocationModule({
        getForegroundPermissionsAsync: jest.fn().mockResolvedValue({ granted: false }),
        requestForegroundPermissionsAsync: jest.fn().mockResolvedValue({ granted: true }),
      });
      const { requestForegroundGpsPermission } = require('../gpsTracking');

      expect(await requestForegroundGpsPermission()).toBe('granted');
    });

    it('returns "denied" when the user declines', async () => {
      mockLocationModule({
        getForegroundPermissionsAsync: jest.fn().mockResolvedValue({ granted: false }),
        requestForegroundPermissionsAsync: jest.fn().mockResolvedValue({ granted: false }),
      });
      const { requestForegroundGpsPermission } = require('../gpsTracking');

      expect(await requestForegroundGpsPermission()).toBe('denied');
    });

    it('returns "unavailable" when expo-location cannot be loaded at all', async () => {
      jest.doMock('expo-location', () => {
        throw new Error('native module not present');
      });
      const { requestForegroundGpsPermission } = require('../gpsTracking');

      expect(await requestForegroundGpsPermission()).toBe('unavailable');
    });

    it('returns "unavailable" (never throws) if the permission call itself throws', async () => {
      mockLocationModule({ getForegroundPermissionsAsync: jest.fn().mockRejectedValue(new Error('boom')) });
      const { requestForegroundGpsPermission } = require('../gpsTracking');

      await expect(requestForegroundGpsPermission()).resolves.toBe('unavailable');
    });
  });

  describe('startGpsWatch', () => {
    it('returns null without starting a watch when permission is not granted', async () => {
      const mocks = mockLocationModule({
        getForegroundPermissionsAsync: jest.fn().mockResolvedValue({ granted: false }),
        requestForegroundPermissionsAsync: jest.fn().mockResolvedValue({ granted: false }),
      });
      const { startGpsWatch } = require('../gpsTracking');

      const handle = await startGpsWatch(jest.fn());

      expect(handle).toBeNull();
      expect(mocks.watchPositionAsync).not.toHaveBeenCalled();
    });

    it('returns null when expo-location is unavailable', async () => {
      jest.doMock('expo-location', () => {
        throw new Error('unavailable');
      });
      const { startGpsWatch } = require('../gpsTracking');

      expect(await startGpsWatch(jest.fn())).toBeNull();
    });

    it('starts watching, accumulates real movement across fed points, and calls onUpdate with the running total', async () => {
      let feedPoint: (loc: any) => void = () => undefined;
      mockLocationModule({
        getForegroundPermissionsAsync: jest.fn().mockResolvedValue({ granted: true }),
        watchPositionAsync: jest.fn().mockImplementation(async (_options: unknown, callback: (loc: any) => void) => {
          feedPoint = callback;
          return { remove: jest.fn() };
        }),
      });
      const { startGpsWatch } = require('../gpsTracking');

      const updates: any[] = [];
      const handle = await startGpsWatch((acc: unknown) => updates.push(acc));
      expect(handle).not.toBeNull();

      // 30s apart — a realistic gap between accepted fixes (~111m/30s ≈
      // 3.7 m/s), so this stays under gpsDistance.ts's speed-jump filter.
      feedPoint({ coords: { latitude: 32.0800, longitude: 34.7800, accuracy: 5 }, timestamp: 0 });
      feedPoint({ coords: { latitude: 32.0810, longitude: 34.7800, accuracy: 5 }, timestamp: 30_000 }); // ~111m

      expect(updates).toHaveLength(2);
      expect(updates[0].pointCount).toBe(1);
      expect(updates[1].pointCount).toBe(2);
      expect(updates[1].distanceMeters).toBeGreaterThan(90);
      // The raw fix's own accuracy reading survives the full pipeline
      // (Location callback -> GpsPoint -> accumulator's routePoints).
      expect(updates[1].routePoints.map((p: { accuracy?: number }) => p.accuracy)).toEqual([5, 5]);
    });

    it('discards an implausible GPS jump (e.g. multipath near a building) the same way a low-accuracy fix is discarded', async () => {
      let feedPoint: (loc: any) => void = () => undefined;
      mockLocationModule({
        getForegroundPermissionsAsync: jest.fn().mockResolvedValue({ granted: true }),
        watchPositionAsync: jest.fn().mockImplementation(async (_options: unknown, callback: (loc: any) => void) => {
          feedPoint = callback;
          return { remove: jest.fn() };
        }),
      });
      const { startGpsWatch } = require('../gpsTracking');

      const updates: any[] = [];
      const handle = await startGpsWatch((acc: unknown) => updates.push(acc));
      expect(handle).not.toBeNull();

      feedPoint({ coords: { latitude: 32.0800, longitude: 34.7800, accuracy: 5 }, timestamp: 0 });
      // ~1.1km away, 5s later — an implausible jump, not a real dog walk.
      feedPoint({ coords: { latitude: 32.0900, longitude: 34.7900, accuracy: 5 }, timestamp: 5000 });

      expect(updates).toHaveLength(2);
      expect(updates[1]).toEqual(updates[0]); // second update is a no-op — the jump was discarded
    });

    it('the returned handle\'s remove() calls the underlying subscription\'s remove()', async () => {
      const removeMock = jest.fn();
      mockLocationModule({
        getForegroundPermissionsAsync: jest.fn().mockResolvedValue({ granted: true }),
        watchPositionAsync: jest.fn().mockResolvedValue({ remove: removeMock }),
      });
      const { startGpsWatch } = require('../gpsTracking');

      const handle = await startGpsWatch(jest.fn());
      handle!.remove();

      expect(removeMock).toHaveBeenCalledTimes(1);
    });

    it('returns null (never throws) if watchPositionAsync itself throws', async () => {
      mockLocationModule({
        getForegroundPermissionsAsync: jest.fn().mockResolvedValue({ granted: true }),
        watchPositionAsync: jest.fn().mockRejectedValue(new Error('boom')),
      });
      const { startGpsWatch } = require('../gpsTracking');

      await expect(startGpsWatch(jest.fn())).resolves.toBeNull();
    });
  });
});
