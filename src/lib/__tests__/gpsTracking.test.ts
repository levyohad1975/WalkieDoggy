/**
 * gpsTracking.ts loads expo-location lazily via require() (no module-scope
 * import) — same reason as notificationService.ts's getNotifications(), so
 * each test here uses jest.doMock + jest.resetModules() + a fresh require(),
 * the same established pattern src/lib/__tests__/pushTokensNative.test.ts
 * documents for a lazily-required native module, rather than a global
 * static mock.
 */
describe('gpsTracking', () => {
  const originalNavigator = Object.getOwnPropertyDescriptor(global, 'navigator');
  let platformOsDescriptor: PropertyDescriptor | undefined;

  beforeEach(() => {
    jest.resetModules();
  });

  afterEach(() => {
    if (platformOsDescriptor) {
      Object.defineProperty(require('react-native').Platform, 'OS', platformOsDescriptor);
      platformOsDescriptor = undefined;
    }
    if (originalNavigator) Object.defineProperty(global, 'navigator', originalNavigator);
    else delete (global as { navigator?: Navigator }).navigator;
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
    it('reports unavailable when the browser does not expose geolocation', async () => {
      const { Platform } = require('react-native');
      platformOsDescriptor = Object.getOwnPropertyDescriptor(Platform, 'OS');
      Object.defineProperty(Platform, 'OS', { configurable: true, value: 'web' });
      Object.defineProperty(global, 'navigator', { configurable: true, value: {} });
      const { startGpsWatch } = require('../gpsTracking');

      await expect(startGpsWatch(jest.fn())).resolves.toMatchObject({ handle: null, permissionStatus: 'unavailable', trackingStatus: 'unavailable' });
    });

    it('uses one foreground watch on Web without navigator.permissions (Safari regression)', async () => {
      const { Platform } = require('react-native');
      platformOsDescriptor = Object.getOwnPropertyDescriptor(Platform, 'OS');
      Object.defineProperty(Platform, 'OS', { configurable: true, value: 'web' });
      const getCurrentPosition = jest.fn((success: (position: any) => void) => {
        success({ coords: { latitude: 32.0800, longitude: 34.7800, accuracy: 5 }, timestamp: 1 });
      });
      const watchPosition = jest.fn((success: (position: any) => void) => {
        success({ coords: { latitude: 32.0800, longitude: 34.7800, accuracy: 5 }, timestamp: 1 });
        return 42;
      });
      const clearWatch = jest.fn();
      Object.defineProperty(global, 'navigator', {
        configurable: true,
        value: { geolocation: { getCurrentPosition, watchPosition, clearWatch } },
      });
      // Safari's missing navigator.permissions must not make the browser
      // path depend on expo-location's Web permission adapter.
      jest.doMock('expo-location', () => {
        throw new Error('must not load for Web GPS');
      });
      const { startGpsWatch } = require('../gpsTracking');

      const updates: any[] = [];
      const result = await startGpsWatch((acc: unknown) => updates.push(acc));

      expect(result.permissionStatus).toBe('granted');
      expect(result.trackingStatus).toBe('active');
      expect(result.handle).not.toBeNull();
      expect(getCurrentPosition).not.toHaveBeenCalled();
      expect(watchPosition).toHaveBeenCalledTimes(1);
      expect(updates).toHaveLength(1);
      result.handle!.remove();
      expect(clearWatch).toHaveBeenCalledWith(42);
    });

    it('keeps a Safari watch alive after a slow first fix and accepts the delayed position', async () => {
      jest.useFakeTimers();
      const { Platform } = require('react-native');
      platformOsDescriptor = Object.getOwnPropertyDescriptor(Platform, 'OS');
      Object.defineProperty(Platform, 'OS', { configurable: true, value: 'web' });
      let succeed!: (position: any) => void;
      const clearWatch = jest.fn();
      const watchPosition = jest.fn((success: (position: any) => void) => { succeed = success; return 7; });
      Object.defineProperty(global, 'navigator', { configurable: true, value: { geolocation: { getCurrentPosition: jest.fn(), watchPosition, clearWatch } } });
      const { startGpsWatch } = require('../gpsTracking');

      const updates: any[] = [];
      const starting = startGpsWatch((acc: unknown) => updates.push(acc));
      await jest.advanceTimersByTimeAsync(18_000);
      const result = await starting;
      expect(result).toMatchObject({ permissionStatus: 'granted', trackingStatus: 'timeout' });
      expect(result.handle).not.toBeNull();
      expect(watchPosition).toHaveBeenCalledTimes(1);
      expect(clearWatch).not.toHaveBeenCalled();
      succeed({ coords: { latitude: 32.08, longitude: 34.78, accuracy: 5 }, timestamp: 1 });
      expect(updates).toHaveLength(1);
      result.handle!.remove();
      expect(clearWatch).toHaveBeenCalledWith(7);
      jest.useRealTimers();
    });

    it('restarts the browser watch on foreground while preserving accumulated route and distance', async () => {
      const { Platform } = require('react-native');
      platformOsDescriptor = Object.getOwnPropertyDescriptor(Platform, 'OS');
      Object.defineProperty(Platform, 'OS', { configurable: true, value: 'web' });
      const callbacks: Array<(position: any) => void> = [];
      const clearWatch = jest.fn();
      const watchPosition = jest.fn((success: (position: any) => void) => { callbacks.push(success); return callbacks.length; });
      Object.defineProperty(global, 'navigator', { configurable: true, value: { geolocation: { watchPosition, clearWatch } } });
      Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
      const { startGpsWatch } = require('../gpsTracking');
      const updates: any[] = [];
      const starting = startGpsWatch((acc: unknown) => updates.push(acc));
      callbacks[0]({ coords: { latitude: 32.08, longitude: 34.78, accuracy: 5 }, timestamp: 1 });
      const result = await starting;

      document.dispatchEvent(new Event('visibilitychange'));
      expect(watchPosition).toHaveBeenCalledTimes(2);
      expect(clearWatch).toHaveBeenCalledWith(1);
      callbacks[1]({ coords: { latitude: 32.081, longitude: 34.78, accuracy: 5 }, timestamp: 2 });
      expect(updates.at(-1).pointCount).toBe(2);

      result.handle!.remove();
      expect(clearWatch).toHaveBeenCalledWith(2);
      document.dispatchEvent(new Event('visibilitychange'));
      expect(watchPosition).toHaveBeenCalledTimes(2);
    });

    it('reports permission denial from the browser watch without leaking a subscription', async () => {
      const { Platform } = require('react-native');
      platformOsDescriptor = Object.getOwnPropertyDescriptor(Platform, 'OS');
      Object.defineProperty(Platform, 'OS', { configurable: true, value: 'web' });
      const clearWatch = jest.fn();
      const watchPosition = jest.fn((_success: unknown, error: (e: any) => void) => {
        error({ code: 1, message: 'denied', PERMISSION_DENIED: 1, POSITION_UNAVAILABLE: 2, TIMEOUT: 3 });
        return 9;
      });
      Object.defineProperty(global, 'navigator', { configurable: true, value: { geolocation: { watchPosition, clearWatch } } });
      const { startGpsWatch } = require('../gpsTracking');

      await expect(startGpsWatch(jest.fn())).resolves.toMatchObject({ handle: null, permissionStatus: 'denied', trackingStatus: 'denied' });
      expect(clearWatch).toHaveBeenCalledWith(9);
    });

    it('turns a synchronous browser exception into unavailable rather than throwing', async () => {
      const { Platform } = require('react-native');
      platformOsDescriptor = Object.getOwnPropertyDescriptor(Platform, 'OS');
      Object.defineProperty(Platform, 'OS', { configurable: true, value: 'web' });
      Object.defineProperty(global, 'navigator', { configurable: true, value: { geolocation: { watchPosition: jest.fn(() => { throw new Error('blocked'); }), clearWatch: jest.fn() } } });
      const { startGpsWatch } = require('../gpsTracking');

      await expect(startGpsWatch(jest.fn())).resolves.toMatchObject({ handle: null, permissionStatus: 'unavailable', trackingStatus: 'unavailable' });
    });

    it('restarts a failed continuous watch once and resumes updates without duplicate watches', async () => {
      jest.useFakeTimers();
      const { Platform } = require('react-native');
      platformOsDescriptor = Object.getOwnPropertyDescriptor(Platform, 'OS');
      Object.defineProperty(Platform, 'OS', { configurable: true, value: 'web' });
      const callbacks: Array<{ success: (p: any) => void; error: (e: any) => void }> = [];
      let id = 0;
      const clearWatch = jest.fn();
      const watchPosition = jest.fn((success: (p: any) => void, error: (e: any) => void) => { callbacks.push({ success, error }); return ++id; });
      Object.defineProperty(global, 'navigator', { configurable: true, value: { geolocation: { watchPosition, clearWatch } } });
      const { startGpsWatch } = require('../gpsTracking');
      const updates: any[] = [];
      const starting = startGpsWatch((acc: unknown) => updates.push(acc));
      callbacks[0].success({ coords: { latitude: 32.08, longitude: 34.78, accuracy: 5 }, timestamp: 1 });
      const result = await starting;
      callbacks[0].error({ code: 3, message: 'timeout', PERMISSION_DENIED: 1, POSITION_UNAVAILABLE: 2, TIMEOUT: 3 });
      expect(clearWatch).toHaveBeenCalledWith(1);
      expect(watchPosition).toHaveBeenCalledTimes(1);
      await jest.advanceTimersByTimeAsync(1500);
      expect(watchPosition).toHaveBeenCalledTimes(2);
      callbacks[1].success({ coords: { latitude: 32.081, longitude: 34.78, accuracy: 5 }, timestamp: 2 });
      expect(updates.at(-1).pointCount).toBe(2);
      result.handle!.remove();
      jest.useRealTimers();
    });

    it('returns a denied status without starting a watch when permission is not granted', async () => {
      const mocks = mockLocationModule({
        getForegroundPermissionsAsync: jest.fn().mockResolvedValue({ granted: false }),
        requestForegroundPermissionsAsync: jest.fn().mockResolvedValue({ granted: false }),
      });
      const { startGpsWatch } = require('../gpsTracking');

      const result = await startGpsWatch(jest.fn());

      expect(result).toEqual({ handle: null, permissionStatus: 'denied', trackingStatus: 'denied' });
      expect(mocks.watchPositionAsync).not.toHaveBeenCalled();
    });

    it('returns unavailable when expo-location is unavailable', async () => {
      jest.doMock('expo-location', () => {
        throw new Error('unavailable');
      });
      const { startGpsWatch } = require('../gpsTracking');

      await expect(startGpsWatch(jest.fn())).resolves.toEqual({ handle: null, permissionStatus: 'unavailable', trackingStatus: 'unavailable' });
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
      const result = await startGpsWatch((acc: unknown) => updates.push(acc));
      expect(result.permissionStatus).toBe('granted');
      expect(result.handle).not.toBeNull();

      feedPoint({ coords: { latitude: 32.0800, longitude: 34.7800, accuracy: 5 }, timestamp: 1 });
      feedPoint({ coords: { latitude: 32.0810, longitude: 34.7800, accuracy: 5 }, timestamp: 2 }); // ~111m

      expect(updates).toHaveLength(2);
      expect(updates[0].pointCount).toBe(1);
      expect(updates[1].pointCount).toBe(2);
      expect(updates[1].distanceMeters).toBeGreaterThan(90);
    });

    it('reports a bounded first-fix timeout on the native watch too', async () => {
      jest.useFakeTimers();
      const remove = jest.fn();
      let feedPoint!: (location: any) => void;
      const mocks = mockLocationModule({
        getForegroundPermissionsAsync: jest.fn().mockResolvedValue({ granted: true }),
        watchPositionAsync: jest.fn().mockImplementation(async (_options: unknown, callback: (location: any) => void) => { feedPoint = callback; return { remove }; }),
      });
      const statuses: string[] = [];
      const { startGpsWatch } = require('../gpsTracking');
      const result = await startGpsWatch(jest.fn(), (status: string) => statuses.push(status));
      await jest.advanceTimersByTimeAsync(18_000);
      expect(statuses).toContain('timeout');
      expect(remove).not.toHaveBeenCalled();
      feedPoint({ coords: { latitude: 32.08, longitude: 34.78, accuracy: 5 }, timestamp: 1 });
      expect(statuses).toContain('active');
      expect(remove).not.toHaveBeenCalled();
      result.handle!.remove();
      expect(remove).toHaveBeenCalledTimes(1);
      expect(mocks.watchPositionAsync).toHaveBeenCalledTimes(1);
      jest.useRealTimers();
    });

    it('the returned handle\'s remove() calls the underlying subscription\'s remove()', async () => {
      const removeMock = jest.fn();
      mockLocationModule({
        getForegroundPermissionsAsync: jest.fn().mockResolvedValue({ granted: true }),
        watchPositionAsync: jest.fn().mockResolvedValue({ remove: removeMock }),
      });
      const { startGpsWatch } = require('../gpsTracking');

      const result = await startGpsWatch(jest.fn());
      result.handle!.remove();

      expect(removeMock).toHaveBeenCalledTimes(1);
    });

    it('returns unavailable (never throws) if watchPositionAsync itself throws', async () => {
      mockLocationModule({
        getForegroundPermissionsAsync: jest.fn().mockResolvedValue({ granted: true }),
        watchPositionAsync: jest.fn().mockRejectedValue(new Error('boom')),
      });
      const { startGpsWatch } = require('../gpsTracking');

      await expect(startGpsWatch(jest.fn())).resolves.toEqual({ handle: null, permissionStatus: 'unavailable', trackingStatus: 'unavailable' });
    });
  });
});
