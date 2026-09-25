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

function browserGeolocation(): Geolocation | null {
  if (typeof navigator === 'undefined' || !navigator.geolocation) return null;
  return navigator.geolocation;
}

function browserErrorStatus(error: GeolocationPositionError): GpsPermissionStatus {
  return error.code === error.PERMISSION_DENIED ? 'denied' : 'unavailable';
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
    geolocation.getCurrentPosition(
      () => resolve('granted'),
      (error) => resolve(browserErrorStatus(error)),
      { enableHighAccuracy: true, maximumAge: 0, timeout: 15_000 }
    );
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
export async function startGpsWatch(onUpdate: (acc: GpsAccumulator) => void): Promise<GpsWatchStartResult> {
  if (Platform.OS === 'web') {
    const geolocation = browserGeolocation();
    if (!geolocation) return { handle: null, permissionStatus: 'unavailable' };

    let acc = createGpsAccumulator();
    const accept = (location: GeolocationPosition) => {
      const point: GpsPoint = {
        latitude: location.coords.latitude,
        longitude: location.coords.longitude,
        timestamp: location.timestamp,
        accuracy: location.coords.accuracy,
      };
      acc = accumulateDistance(acc, point);
      onUpdate(acc);
    };

    // A first real fix makes the active card useful immediately instead of
    // waiting indefinitely for a watch callback that Safari may never send.
    const initialStatus = await new Promise<GpsPermissionStatus>((resolve) => {
      geolocation.getCurrentPosition(
        (location) => {
          accept(location);
          resolve('granted');
        },
        (error) => resolve(browserErrorStatus(error)),
        { enableHighAccuracy: true, maximumAge: 0, timeout: 15_000 }
      );
    });
    if (initialStatus !== 'granted') return { handle: null, permissionStatus: initialStatus };

    try {
      const watchId = geolocation.watchPosition(
        accept,
        () => undefined,
        { enableHighAccuracy: true, maximumAge: 0, timeout: 15_000 }
      );
      return { handle: { remove: () => geolocation.clearWatch(watchId) }, permissionStatus: 'granted' };
    } catch {
      return { handle: null, permissionStatus: 'unavailable' };
    }
  }

  const Location = await getLocation();
  if (!Location) return { handle: null, permissionStatus: 'unavailable' };

  const permission = await requestForegroundGpsPermission();
  if (permission !== 'granted') return { handle: null, permissionStatus: permission };

  try {
    let acc = createGpsAccumulator();
    const subscription = await Location.watchPositionAsync(
      {
        accuracy: Location.Accuracy.Balanced,
        timeInterval: 5000,
        distanceInterval: 5,
      },
      (location) => {
        const point: GpsPoint = {
          latitude: location.coords.latitude,
          longitude: location.coords.longitude,
          timestamp: location.timestamp,
          accuracy: location.coords.accuracy,
        };
        acc = accumulateDistance(acc, point);
        onUpdate(acc);
      }
    );
    return { handle: { remove: () => subscription.remove() }, permissionStatus: 'granted' };
  } catch {
    return { handle: null, permissionStatus: 'unavailable' };
  }
}

/** Test-only hook: clears the memoized module cache between tests so each test can simulate a fresh load under a different mock. Not used by production code paths. */
export function __resetGpsTrackingCacheForTests(): void {
  locationModulePromise = null;
}
