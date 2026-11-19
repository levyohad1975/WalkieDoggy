import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * Walk Lifecycle v1.1 server capability.
 *
 * P0 (real iPhone, 2026-10-15): a v1.1 client was deployed against a Staging
 * database whose v1.1 migration had not been applied (it fails closed on
 * unresolved duplicate active walks). The client chose the v1.1 RPCs only
 * because the methods existed in its own code, so every start returned
 * PGRST202 for public.start_walk_v11.
 *
 * The client now asks the server (walk_lifecycle_server_capabilities, added
 * by 20261015100200_walk_lifecycle_capabilities_v11.sql) before any v1.1
 * lifecycle write and fails closed when v1.1 is absent or incomplete. It
 * deliberately does NOT fall back to the legacy start_walk()/finish_walk():
 * those do not enforce one active walk per dog, which is how duplicates can
 * arise, and they cannot express substitution, remote start or GPS fencing.
 */
export type WalkLifecycleCapability =
  | { status: 'supported'; checkedAt: string }
  | { status: 'not_installed'; checkedAt: string }
  | { status: 'incomplete'; checkedAt: string; missing: string[] };

/** Stable marker matched by errorMessages.ts; never shown raw to the user. */
export const WALK_LIFECYCLE_UNAVAILABLE_MARKER = 'walk lifecycle v1.1 is not available on this server';
export const WALK_LIFECYCLE_UNVERIFIED_OFFLINE_MARKER = 'walk lifecycle server version could not be verified offline';

export class WalkLifecycleUnavailableError extends Error {
  readonly code = 'WALK_LIFECYCLE_V11_UNAVAILABLE';
  constructor(readonly reason: 'not_installed' | 'incomplete' | 'missing_rpc', readonly detail?: string) {
    super(`${WALK_LIFECYCLE_UNAVAILABLE_MARKER} (${reason}${detail ? `: ${detail}` : ''})`);
    this.name = 'WalkLifecycleUnavailableError';
  }
}

export class WalkLifecycleUnverifiedOfflineError extends Error {
  readonly code = 'WALK_LIFECYCLE_V11_UNVERIFIED_OFFLINE';
  constructor() {
    super(WALK_LIFECYCLE_UNVERIFIED_OFFLINE_MARKER);
    this.name = 'WalkLifecycleUnverifiedOfflineError';
  }
}

/** Structural check so module re-instantiation (tests, fast refresh) cannot defeat it. */
export function isWalkLifecycleUnavailableError(error: unknown): error is WalkLifecycleUnavailableError {
  return Boolean(error && typeof error === 'object' && (error as { code?: unknown }).code === 'WALK_LIFECYCLE_V11_UNAVAILABLE');
}

type PostgrestLikeError = { code?: unknown; message?: unknown };

/** PostgREST/Postgres codes for a function that does not exist with that signature. */
export function isMissingFunctionError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const { code, message } = error as PostgrestLikeError;
  if (code === 'PGRST202' || code === '42883') return true;
  return typeof message === 'string' && /could not find the function/i.test(message);
}

/** PostgREST/Postgres codes for a table/view that does not exist. */
export function isMissingRelationError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const { code, message } = error as PostgrestLikeError;
  if (code === 'PGRST205' || code === '42P01') return true;
  return typeof message === 'string' && /could not find the table|relation .* does not exist/i.test(message);
}

export function capabilityFromProbe(data: unknown, checkedAt = new Date().toISOString()): WalkLifecycleCapability {
  const value = data && typeof data === 'object' ? (data as { lifecycle_version?: unknown; missing?: unknown }) : {};
  const missing = Array.isArray(value.missing) ? value.missing.filter((item): item is string => typeof item === 'string') : null;
  if (value.lifecycle_version !== '1.1' || missing === null) {
    return { status: 'incomplete', checkedAt, missing: ['probe:unrecognized-response'] };
  }
  return missing.length === 0 ? { status: 'supported', checkedAt } : { status: 'incomplete', checkedAt, missing };
}

export function unavailableErrorFor(capability: WalkLifecycleCapability): WalkLifecycleUnavailableError | null {
  if (capability.status === 'supported') return null;
  if (capability.status === 'not_installed') return new WalkLifecycleUnavailableError('not_installed');
  return new WalkLifecycleUnavailableError('incomplete', capability.missing.slice(0, 3).join(', '));
}

const STORAGE_KEY = '@walkie/walk-lifecycle-capability-v1';
/** A negative answer is re-checked soon so an approved migration takes effect without a reload. */
export const UNSUPPORTED_CAPABILITY_TTL_MS = 30_000;
/** A positive answer is re-checked periodically, and immediately after any missing-RPC error. */
export const SUPPORTED_CAPABILITY_TTL_MS = 10 * 60_000;

export async function readPersistedWalkLifecycleCapability(): Promise<WalkLifecycleCapability | null> {
  try {
    const value = JSON.parse((await AsyncStorage.getItem(STORAGE_KEY)) ?? 'null') as unknown;
    if (!value || typeof value !== 'object') return null;
    const status = (value as { status?: unknown }).status;
    const checkedAt = (value as { checkedAt?: unknown }).checkedAt;
    if (typeof checkedAt !== 'string') return null;
    if (status === 'supported' || status === 'not_installed') return { status, checkedAt };
    if (status === 'incomplete') {
      const missing = (value as { missing?: unknown }).missing;
      return { status, checkedAt, missing: Array.isArray(missing) ? missing.filter((m): m is string => typeof m === 'string') : [] };
    }
    return null;
  } catch {
    return null;
  }
}

export async function persistWalkLifecycleCapability(capability: WalkLifecycleCapability | null): Promise<void> {
  try {
    if (capability) await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(capability));
    else await AsyncStorage.removeItem(STORAGE_KEY);
  } catch {
    // Persistence only helps the offline path; an online probe still decides.
  }
}
