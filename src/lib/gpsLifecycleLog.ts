/**
 * Structured GPS lifecycle diagnostics (P0 2026-10-15, real iPhone).
 *
 * A Staging walk_gps_sessions row was ended ~34 s after GPS started while the
 * walk itself stayed active, and the device console is not readable on an
 * iPhone. Every transition that can start, keep or end a device GPS session
 * now records a reason code here, so the next repro names the exact path.
 *
 * Privacy: entries hold event names, reason codes, walk IDs and counts only —
 * never coordinates, accuracy or any other location value.
 */

export type GpsLifecycleEvent =
  | 'start'
  | 'first_fix'
  | 'lease_acquired'
  | 'lease_lost'
  | 'lease_released'
  | 'remote_marked'
  | 'remote_detached'
  | 'stop'
  | 'cancel';

export interface GpsLifecycleEntry {
  at: string;
  event: GpsLifecycleEvent;
  walkId: string | null;
  reason?: string;
  detail?: Record<string, string | number | boolean | null>;
}

const MAX_ENTRIES = 60;
const STORAGE_KEY = 'walkie.gpsLifecycle.v1';

function storage(): Storage | null {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null;
  } catch {
    return null;
  }
}

function load(): GpsLifecycleEntry[] {
  try {
    const raw = storage()?.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? (parsed as GpsLifecycleEntry[]).slice(-MAX_ENTRIES) : [];
  } catch {
    return [];
  }
}

let entries: GpsLifecycleEntry[] = load();

export function recordGpsLifecycle(
  event: GpsLifecycleEvent,
  walkId: string | null,
  reason?: string,
  detail?: GpsLifecycleEntry['detail'],
): GpsLifecycleEntry {
  const entry: GpsLifecycleEntry = { at: new Date().toISOString(), event, walkId, ...(reason ? { reason } : {}), ...(detail ? { detail } : {}) };
  entries = [...entries, entry].slice(-MAX_ENTRIES);
  try {
    storage()?.setItem(STORAGE_KEY, JSON.stringify(entries));
  } catch {
    // Private mode / quota: the in-memory log still serves this session.
  }
  if (process.env.NODE_ENV !== 'test') console.info('[gps-lifecycle]', JSON.stringify(entry));
  return entry;
}

export function getGpsLifecycleLog(): readonly GpsLifecycleEntry[] {
  return entries;
}

/** Test-only: clears the in-memory log. */
export function __resetGpsLifecycleLogForTests(): void {
  entries = [];
}
