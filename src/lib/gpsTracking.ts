import { Platform } from 'react-native';
import type * as ExpoLocation from 'expo-location';
import { accumulateDistance, createGpsAccumulator, type GpsAccumulator, type GpsPoint } from '../logic/gpsDistance';

/**
 * Foreground-only GPS session tracking (Phase 4, PRD §7 — first-stage
 * scope: "בשלב ראשון GPS הוא Assistive... בהמשך ניתן להוסיף... Auto-detected
 * walk" — background/auto-detection are later increments, not this one).
 *
 * Lazily loads expo-location — never a module-scope `import * as Location`
 * — mirroring notifications/notificationService.ts's getNotifications()
 * pattern for the same reason: a native module that might not be present
 * (a stripped-down test/CI environment, an unusual build) must degrade to
 * "unavailable" rather than crash at import time. UNLIKE notifications,
 * this does NOT blanket-disable in Expo Go or on Web. Native keeps the lazy
 * Expo adapter; Web uses the browser's Geolocation API directly because
 * Safari does not consistently provide the Permissions API expected by
 * expo-location's Web adapter. Any environment that genuinely cannot use
 * location resolves to an explicit unavailable status rather than crashing.
 *
 * No raw position is ever exposed to a caller beyond one `onUpdate`
 * callback carrying the running ACCUMULATOR (distance + point count) — see
 * logic/gpsDistance.ts's own header for why that boundary is deliberate,
 * not an oversight.
 */

let locationModulePromise: Promise<typeof ExpoLocation | null> | null = null;

async function getLocation(): Promise<typeof ExpoLocation | null> {
  if (!locationModulePromise) {
    locationModulePromise = (async () => {
      try {
        return require('expo-location') as typeof ExpoLocation;
      } catch {
        return null;
      }
    })();
  }
  return locationModulePromise;
}

export type GpsPermissionStatus = 'granted' | 'denied' | 'unavailable';
export type GpsTrackingStatus = 'requesting' | 'waiting' | 'active' | 'denied' | 'timeout' | 'unavailable' | 'interrupted';

function browserGeolocation(): Geolocation | null {
  if (typeof navigator === 'undefined' || !navigator.geolocation) return null;
  return navigator.geolocation;
}

function browserErrorStatus(error: GeolocationPositionError): GpsTrackingStatus {
  if (error.code === error.PERMISSION_DENIED) return 'denied';
  if (error.code === error.TIMEOUT) return 'timeout';
  return 'unavailable';
}

/**
 * Safari does not consistently expose navigator.permissions, which
 * expo-location's Web permission adapter requires before it asks for a
 * position. Use the browser's actual Geolocation API for the Web path.
 */
function requestBrowserGpsPermission(): Promise<GpsPermissionStatus> {
  const geolocation = browserGeolocation();
  if (!geolocation) return Promise.resolve('unavailable');

  return new Promise((resolve) => {
    let settled = false;
    const finish = (status: GpsPermissionStatus) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(status);
    };
    const timer = setTimeout(() => finish('unavailable'), 18_000);
    try {
      geolocation.getCurrentPosition(
        () => finish('granted'),
        (error) => finish(browserErrorStatus(error) === 'denied' ? 'denied' : 'unavailable'),
        { enableHighAccuracy: true, maximumAge: 0, timeout: 12_000 }
      );
    } catch {
      finish('unavailable');
    }
  });
}

/**
 * Foreground-only — PRD §7 requires "מצבי denied/limited/background" to be
 * distinguishable; background is simply never requested in this phase, so
 * there is no background permission state to report yet. Checks the
 * current status first (never re-prompts someone who already granted or
 * already denied — requestForegroundPermissionsAsync would otherwise
 * re-surface an OS prompt this device already answered).
 */
export async function requestForegroundGpsPermission(): Promise<GpsPermissionStatus> {
  if (Platform.OS === 'web') return requestBrowserGpsPermission();

  const Location = await getLocation();
  if (!Location) return 'unavailable';
  try {
    const current = await Location.getForegroundPermissionsAsync();
    if (current.granted) return 'granted';
    const requested = await Location.requestForegroundPermissionsAsync();
    return requested.granted ? 'granted' : 'denied';
  } catch {
    return 'unavailable';
  }
}

export interface GpsWatchHandle {
  remove: () => void;
}

/** Result carries the actionable reason a foreground watch did not start. */
export interface GpsWatchStartResult {
  handle: GpsWatchHandle | null;
  permissionStatus: GpsPermissionStatus;
  trackingStatus: GpsTrackingStatus;
}

/**
 * Starts watching position, folding every fix into a running
 * logic/gpsDistance.ts accumulator and handing the latest one to
 * `onUpdate`. It reports an actionable status rather than throwing if
 * location is unavailable or permission isn't granted, so the caller can
 * explain the absence of GPS without blocking Start/End (PRD §7: GPS is
 * assistive, never a precondition for the walk lifecycle).
 *
 * `distanceInterval: 5` (meters) alongside a 5s `timeInterval` — the PRD's
 * own "צריכת סוללה סבירה" (reasonable battery use) requirement: sampling
 * far more often than a person can meaningfully move during a walk would
 * just burn battery for noise logic/gpsDistance.ts's own movement floor
 * would discard anyway.
 */
export async function startGpsWatch(
  onUpdate: (acc: GpsAccumulator) => void,
  onStatus: (status: GpsTrackingStatus) => void = () => undefined,
): Promise<GpsWatchStartResult> {
  if (Platform.OS === 'web') {
    const geolocation = browserGeolocation();
    if (!geolocation) return { handle: null, permissionStatus: 'unavailable', trackingStatus: 'unavailable' };

    let acc = createGpsAccumulator();
    let watchId: number | null = null;
    let removed = false;
    let retries = 0;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let startupTimer: ReturnType<typeof setTimeout> | null = null;
    let settled = false;
    let resolveStartup: ((result: GpsWatchStartResult) => void) | null = null;
    const browserDocument = typeof document !== 'undefined' ? document : null;
    let visibilityListener: (() => void) | null = null;
    const removeCurrentWatch = () => {
      if (watchId !== null) {
        try { geolocation.clearWatch(watchId); } catch { /* best effort */ }
        watchId = null;
      }
    };
    const handle: GpsWatchHandle = {
      remove: () => {
        removed = true;
        if (retryTimer) clearTimeout(retryTimer);
        if (startupTimer) clearTimeout(startupTimer);
        removeCurrentWatch();
        if (browserDocument && visibilityListener) {
          browserDocument.removeEventListener('visibilitychange', visibilityListener);
          visibilityListener = null;
        }
      },
    };
    const finishStartup = (permissionStatus: GpsPermissionStatus, trackingStatus: GpsTrackingStatus) => {
      if (settled) return;
      settled = true;
      if (startupTimer) clearTimeout(startupTimer);
      if (!handle || permissionStatus !== 'granted') handle.remove();
      resolveStartup?.({ handle: permissionStatus === 'granted' ? handle : null, permissionStatus, trackingStatus });
    };
    const accept = (location: GeolocationPosition) => {
      if (removed) return;
      const point: GpsPoint = {
        latitude: location.coords.latitude,
        longitude: location.coords.longitude,
        timestamp: location.timestamp,
        accuracy: location.coords.accuracy,
      };
      acc = accumulateDistance(acc, point);
      onUpdate(acc);
      retries = 0;
      onStatus('active');
      finishStartup('granted', 'active');
    };
    const onError = (error: GeolocationPositionError) => {
      if (removed) return;
      const status = browserErrorStatus(error);
      if (!settled) {
        onStatus(status);
        if (status === 'denied' || status === 'unavailable') {
          finishStartup(status === 'denied' ? 'denied' : 'unavailable', status);
        }
        // Safari can report TIMEOUT before it has produced a fix. Keep the
        // one watch alive until our independent startup deadline expires.
        return;
      }
      if (status === 'denied') {
        onStatus('denied');
        handle.remove();
        return;
      }
      onStatus('interrupted');
      removeCurrentWatch();
      if (retries >= 3 || retryTimer) {
        if (retries >= 3) onStatus(status === 'timeout' ? 'timeout' : 'unavailable');
        return;
      }
      retries += 1;
      retryTimer = setTimeout(() => {
        retryTimer = null;
        if (!removed) startWatch();
      }, 1500 * retries);
    };
    const startWatch = () => {
      if (removed) return;
      try {
        const nextWatchId = geolocation.watchPosition(accept, onError, {
          enableHighAccuracy: true,
          maximumAge: 0,
          timeout: 12_000,
        });
        watchId = nextWatchId;
        // A few test doubles (and unusual shims) invoke callbacks
        // synchronously before returning the watch id.
        if (removed || retryTimer) removeCurrentWatch();
      } catch {
        if (!settled) finishStartup('unavailable', 'unavailable');
        else onError({ code: 2, message: 'location unavailable', PERMISSION_DENIED: 1, POSITION_UNAVAILABLE: 2, TIMEOUT: 3 } as GeolocationPositionError);
      }
    };
    onStatus('waiting');
    const startup = new Promise<GpsWatchStartResult>((resolve) => { resolveStartup = resolve; });
    // A slow first fix is not a permission failure. Resolve startup so the
    // walk UI can report timeout, but keep this same watch alive: iPhone
    // Safari may deliver its first position after its per-request timeout.
    startupTimer = setTimeout(() => {
      onStatus('timeout');
      finishStartup('granted', 'timeout');
    }, 18_000);
    if (browserDocument) {
      visibilityListener = () => {
        if (removed || !settled || browserDocument.visibilityState !== 'visible') return;
        // iPhone Safari can suspend geolocation callbacks while backgrounded.
        // Reattach on foreground while retaining this watch's accumulator.
        removeCurrentWatch();
        startWatch();
      };
      browserDocument.addEventListener('visibilitychange', visibilityListener);
    }
    startWatch();
    return startup;
  }

  const Location = await getLocation();
  if (!Location) return { handle: null, permissionStatus: 'unavailable', trackingStatus: 'unavailable' };

  onStatus('requesting');
  const permission = await requestForegroundGpsPermission();
  if (permission !== 'granted') return { handle: null, permissionStatus: permission, trackingStatus: permission === 'denied' ? 'denied' : 'unavailable' };

  try {
    let acc = createGpsAccumulator();
    let hasFix = false;
    let removed = false;
    let firstFixTimer: ReturnType<typeof setTimeout> | null = null;
    onStatus('waiting');
    const subscription = await Location.watchPositionAsync(
      {
        accuracy: Location.Accuracy.Balanced,
        timeInterval: 5000,
        distanceInterval: 5,
      },
      (location) => {
        if (removed) return;
        const point: GpsPoint = {
          latitude: location.coords.latitude,
          longitude: location.coords.longitude,
          timestamp: location.timestamp,
          accuracy: location.coords.accuracy,
        };
        acc = accumulateDistance(acc, point);
        onUpdate(acc);
        hasFix = true;
        if (firstFixTimer) clearTimeout(firstFixTimer);
        onStatus('active');
      }
    );
    const handle: GpsWatchHandle = { remove: () => { if (removed) return; removed = true; if (firstFixTimer) clearTimeout(firstFixTimer); subscription.remove(); } };
    if (!hasFix) {
      firstFixTimer = setTimeout(() => {
        if (removed || hasFix) return;
        // Keep the subscription alive. A late first position should recover
        // this session without requiring a second tap or losing its route.
        onStatus('timeout');
      }, 18_000);
    }
    return { handle, permissionStatus: 'granted', trackingStatus: hasFix ? 'active' : 'waiting' };
  } catch {
    return { handle: null, permissionStatus: 'unavailable', trackingStatus: 'unavailable' };
  }
}

/** Test-only hook: clears the memoized module cache between tests so each test can simulate a fresh load under a different mock. Not used by production code paths. */
export function __resetGpsTrackingCacheForTests(): void {
  locationModulePromise = null;
}
