import { Platform } from 'react-native';

/**
 * Remembers, on this device only, which in-progress walk this device was
 * collecting GPS for. iPhone home-screen apps are often closed by the system
 * while the screen is locked; on relaunch the in-memory GPS store is empty and
 * nothing restarted tracking, so the rest of the walk had no route
 * (field report 2026-11-04). The marker lets Home resume tracking for that
 * same walk on this same device. It carries no location data.
 */
const KEY_PREFIX = 'walkie:gps-device-walk:';

function storage(): Storage | null {
  if (Platform.OS !== 'web' || typeof localStorage === 'undefined') return null;
  return localStorage;
}

export function markGpsTrackingOnThisDevice(walkId: string): void {
  try { storage()?.setItem(KEY_PREFIX + walkId, String(Date.now())); } catch { /* storage may be denied */ }
}

export function clearGpsTrackingMarker(walkId: string): void {
  try { storage()?.removeItem(KEY_PREFIX + walkId); } catch { /* storage may be denied */ }
}

export function wasTrackingGpsOnThisDevice(walkId: string): boolean {
  try { return Boolean(storage()?.getItem(KEY_PREFIX + walkId)); } catch { return false; }
}

/**
 * True only when the browser reports location permission as already granted,
 * so resuming cannot surface a permission prompt without a user tap.
 * Unknown/unsupported answers return false and the "הפעל GPS" button remains.
 */
export async function isGeolocationAlreadyGranted(): Promise<boolean> {
  if (Platform.OS !== 'web') return false;
  try {
    const permissions = (typeof navigator !== 'undefined' ? navigator.permissions : undefined) as Permissions | undefined;
    if (!permissions?.query) return false;
    const status = await permissions.query({ name: 'geolocation' as PermissionName });
    return status.state === 'granted';
  } catch {
    return false;
  }
}

/**
 * True unless the browser says location is DENIED. Used to resume a walk
 * this device was already tracking (field report 2026-11-11): on an iPhone
 * home-screen app the Permissions API reports "prompt" even after the walker
 * allowed location for this walk, so requiring "granted" meant the resume
 * never ran and the rest of the walk had no route. Resuming then may show the
 * system location prompt once, which is expected mid-walk; "denied" still
 * leaves the "הפעל GPS" button.
 */
export async function isGeolocationNotDenied(): Promise<boolean> {
  if (Platform.OS !== 'web') return false;
  try {
    const permissions = (typeof navigator !== 'undefined' ? navigator.permissions : undefined) as Permissions | undefined;
    if (!permissions?.query) return true;
    const status = await permissions.query({ name: 'geolocation' as PermissionName });
    return status.state !== 'denied';
  } catch {
    return true;
  }
}
