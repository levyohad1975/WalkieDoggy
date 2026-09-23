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
 * this does NOT blanket-disable in Expo Go or on Web — expo-location's
 * foreground APIs are not subject to the SDK-53 Expo-Go-Android regression
 * notificationService.ts works around (that was specific to
 * expo-notifications), and expo-location has genuine Web support (it wraps
 * the browser's own Geolocation API there) — so Web must not be excluded
 * the way local push notifications are. The lazy try/catch below is
 * sufficient on its own: any environment that genuinely can't load/use the
 * module resolves to `null`/'unavailable' safely, without a separate
 * environment-detection heuristic layered on top.
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

/**
 * Foreground-only — PRD §7 requires "מצבי denied/limited/background" to be
 * distinguishable; background is simply never requested in this phase, so
 * there is no background permission state to report yet. Checks the
 * current status first (never re-prompts someone who already granted or
 * already denied — requestForegroundPermissionsAsync would otherwise
 * re-surface an OS prompt this device already answered).
 */
export async function requestForegroundGpsPermission(): Promise<GpsPermissionStatus> {
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

/**
 * Starts watching position, folding every fix into a running
 * logic/gpsDistance.ts accumulator and handing the latest one to
 * `onUpdate`. Returns `null` (rather than throwing) if location is
 * unavailable or permission isn't granted — the caller (gpsStore) treats a
 * null return as "tracking didn't start" and falls back to letting the
 * walk proceed with no GPS data, never blocking the walk itself (PRD §7:
 * GPS is assistive, never a precondition for Start/End).
 *
 * `distanceInterval: 5` (meters) alongside a 5s `timeInterval` — the PRD's
 * own "צריכת סוללה סבירה" (reasonable battery use) requirement: sampling
 * far more often than a person can meaningfully move during a walk would
 * just burn battery for noise logic/gpsDistance.ts's own movement floor
 * would discard anyway.
 */
export async function startGpsWatch(onUpdate: (acc: GpsAccumulator) => void): Promise<GpsWatchHandle | null> {
  const Location = await getLocation();
  if (!Location) return null;

  const permission = await requestForegroundGpsPermission();
  if (permission !== 'granted') return null;

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
    return { remove: () => subscription.remove() };
  } catch {
    return null;
  }
}

/** Test-only hook: clears the memoized module cache between tests so each test can simulate a fresh load under a different mock. Not used by production code paths. */
export function __resetGpsTrackingCacheForTests(): void {
  locationModulePromise = null;
}
