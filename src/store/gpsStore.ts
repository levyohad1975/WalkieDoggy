import { create } from 'zustand';
import type { Walk, WalkGpsSession } from '../types';
import { repository } from '../data';
import { generateId } from '../lib/id';
import { startGpsWatch, type GpsPermissionStatus, type GpsTrackingStatus, type GpsWatchHandle } from '../lib/gpsTracking';
import type { GpsAccumulator } from '../logic/gpsDistance';
import { recordGpsLifecycle } from '../lib/gpsLifecycleLog';
import { isPotentialLateGpsStart, reconstructMissingRoute, GPS_CURRENT_FIX_MAX_ACCURACY_METERS } from '../logic/gpsReconstruction';

/**
 * Every way a device GPS session may legitimately END (write ended_at and
 * release the lease). stopTracking() records it; a session must never be
 * ended without one (P0 2026-10-15: a session ended mid-walk with no trace).
 */
export type GpsStopReason = 'walk_finished' | 'walk_marked_done' | 'remote_gps_stopped_by_user' | 'remote_command_terminated';
/** Ways a provisional/unwanted watch is DISCARDED without persisting anything. */
export type GpsCancelReason = 'walk_start_failed' | 'remote_activation_failed' | 'remote_command_terminated' | 'duplicate_walk_resolved' | 'test_cleanup';

// Not store state — the live OS subscription handle. Kept outside the
// store (like localRepository's in-memory cache, or notificationService's
// module-scope caches) since a subscription handle isn't serializable
// UI state; the store only ever exposes DERIVED numbers from it
// (distanceMeters/pointCount), never the handle itself.
let activeWatch: GpsWatchHandle | null = null;
let startGeneration = 0;
// The repository may resolve a locally generated scheduled walk to the
// canonical server row after the GPS watch has already started in the
// user's tap handler (required by iOS Safari's gesture-bound permission
// flow). Keep the callback identity aligned with that canonical row.
let activeWatchWalkId: string | null = null;
let activeGpsHeartbeat: ReturnType<typeof setInterval> | null = null;
let lastPersistedGpsTimestamp = 0;
// True while a v1.1 watch is running without a valid server lease. Fixes are
// still shown, but nothing is persisted, so the UI must not report "active".
let gpsLeaseLost = false;
/**
 * Real-iPhone fix: Safari resolves the foreground watch only at the first
 * fix (or an 18s deadline), but the walk start RPC usually returns first.
 * attachGpsOwnership() used to bail out because permission was not yet
 * "granted" and nobody retried, so no v1.1 lease existed: every fix stayed
 * in memory, nothing reached the server during the walk, and the final
 * upload depended on a last-moment lease at Finish. The request is now
 * remembered and honored as soon as this same watch finishes starting.
 */
let pendingOwnership: { walk: Walk; confirmTransfer: boolean } | null = null;
/** The same-device lease acquisition currently in flight, shared by concurrent callers for that walk. */
let ownershipRequest: { walkId: string; promise: Promise<boolean> } | null = null;
const reconstructionAttempts = new Set<string>();

async function attemptMissingRouteReconstruction(
  walk: Pick<Walk, 'id' | 'familyId' | 'dogId'>,
  generation: number,
  firstFix: { latitude: number; longitude: number; timestamp: number; accuracy?: number | null },
  nextFix?: { latitude: number; longitude: number; timestamp: number },
): Promise<void> {
  if (reconstructionAttempts.has(walk.id)) return;
  reconstructionAttempts.add(walk.id);
  try {
    const dogs = await repository.getDogs(walk.familyId);
    const dog = dogs.find((item) => item.id === walk.dogId && item.familyId === walk.familyId);
    if (!dog?.homeLocation || !isPotentialLateGpsStart(dog.homeLocation, firstFix)) {
      if (!dog?.homeLocation && firstFix.accuracy != null && firstFix.accuracy <= GPS_CURRENT_FIX_MAX_ACCURACY_METERS) {
        useGpsStore.setState((state) => startGeneration === generation && activeWatchWalkId != null && state.trackingWalkId === activeWatchWalkId ? { reconstructionNotice: 'home_unverified' } : {});
      }
      return;
    }
    const walks = (await repository.getWalks(walk.familyId))
      .filter((item) => item.familyId === walk.familyId && item.dogId === walk.dogId && item.status === 'done')
      .sort((a, b) => (b.completedAt ?? '').localeCompare(a.completedAt ?? ''))
      .slice(0, 30);
    const sessions = await repository.getGpsSessionsForWalkIds(walks.map((item) => item.id));
    const reconstruction = reconstructMissingRoute({
      familyId: walk.familyId,
      dogId: walk.dogId,
      home: dog.homeLocation,
      firstFix,
      nextFix,
      historicalSessions: sessions,
    });
    useGpsStore.setState((state) => startGeneration === generation && activeWatchWalkId != null && state.trackingWalkId === activeWatchWalkId
      ? reconstruction ? { reconstruction, reconstructionNotice: null } : { reconstructionNotice: 'history_unavailable' }
      : {});
  } catch {
    useGpsStore.setState((state) => startGeneration === generation && activeWatchWalkId != null && state.trackingWalkId === activeWatchWalkId ? { reconstructionNotice: 'history_unavailable' } : {});
  } finally {
    reconstructionAttempts.delete(walk.id);
  }
}

/** Server answers that prove this device no longer holds a valid lease. */
export function isGpsLeaseLostError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : typeof (error as { message?: unknown })?.message === 'string' ? (error as { message: string }).message : String(error ?? '');
  return /GPS ownership expired or transferred|active walk not found/i.test(message);
}

interface GpsState {
  /** The walk currently being tracked, if any — null when no walk is in progress or the active walk simply isn't being tracked (permission denied/unavailable). */
  trackingWalkId: string | null;
  /** Set once startTracking() resolves permission — lets UI show WHY there's no live distance (denied vs. unavailable vs. simply not started yet). */
  permissionStatus: GpsPermissionStatus | null;
  /** Foreground acquisition/watch state, distinct from OS permission. */
  trackingStatus: GpsTrackingStatus | null;
  /** ISO timestamp of when the CURRENT tracking round actually began (the watch started, not just startTracking() being called) — null whenever trackingWalkId is null. Feeds WalkGpsSession.startedAt/endedAt on stop, which the schema/repository layer already round-trip but this store never used to populate. */
  trackingStartedAt: string | null;
  /** Live running total while trackingWalkId is set — meaningless/stale once tracking stops (read sessionsByWalkId for the persisted, authoritative value instead). */
  distanceMeters: number;
  pointCount: number;
  routePoints: Array<{ latitude: number; longitude: number; timestamp: number }>;
  reconstruction: WalkGpsSession['reconstruction'] | null;
  reconstructionNotice: 'history_unavailable' | 'home_unverified' | null;
  gpsFencingEpoch: number | null;
  /**
   * Who started the current tracking session. 'local' is this device's own
   * Start / "הפעל GPS" / transfer tap; 'remote' is a family admin's Remote GPS
   * command that this device has acknowledged as tracking. Only a 'remote'
   * session may be stopped by RemoteGpsPanel's command poller when its
   * command ends — a local session never has a remote command, and treating
   * that absence as "stopped" reset real-iPhone tracking seconds after the
   * first fix (P0 2026-10-15).
   */
  trackingSource: 'local' | 'remote' | null;
  /** The acknowledged Remote GPS command behind a 'remote' session. */
  remoteGpsCommandId: string | null;
  /** Why GPS last ended or was discarded on this device — shown on the walk card (diagnostic, no location data). */
  lastGpsStop: { walkId: string; kind: 'stop' | 'cancel'; reason: string; at: string } | null;
  /** Persisted sessions this device has loaded/saved, keyed by walkId — a cache, not the source of truth (the repository is); populated by loadSession()/stopTracking()/correctDistance(). */
  sessionsByWalkId: Record<string, WalkGpsSession>;

  /**
   * Begins foreground tracking for a walk that just started. Best-effort by
   * design (PRD §7: GPS is assistive, never a precondition) — permission
   * denial or an unavailable module resolves permissionStatus accordingly
   * and simply leaves trackingWalkId null; it never throws and never blocks
   * the walk itself.
   */
  startTracking: (walk: Pick<Walk, 'id' | 'familyId' | 'dogId'>) => Promise<void>;
  attachGpsOwnership: (walk: Walk, confirmTransfer?: boolean) => Promise<boolean>;
  /** Marks the running session as owned by an acknowledged Remote GPS command (see trackingSource). Returns false if this walk is not the one being tracked. */
  markRemoteTracking: (walkId: string, commandId?: string | null) => boolean;
  /** A remote command ended without an authorized termination: keep the walker's session running as a local one. */
  detachRemoteTracking: (walkId: string, outcome: string) => boolean;
  /** Adopt the authoritative server walk ID after start_walk resolves a local schedule occurrence to its canonical row. */
  rebindTrackingWalk: (
    localWalk: Pick<Walk, 'id' | 'familyId' | 'dogId' | 'scheduleEntryId'>,
    canonicalWalk: Pick<Walk, 'id' | 'familyId' | 'dogId' | 'scheduleEntryId'>,
  ) => boolean;
  /**
   * Stops tracking (if this walk was the one being tracked), computes the
   * final reading, and persists it as a new/updated WalkGpsSession. Returns
   * the saved session, or null if this walk had no active tracking session
   * to stop (tracking never started, or a different walk is being tracked).
   * Takes the same walk identity shape as startTracking (not just an id) —
   * a fresh session being created here needs its own family_id/dog_id, and
   * relying on component/store state captured earlier to still be around
   * would be a race waiting to happen; the caller already has the full walk.
   */
  stopTracking: (walk: Pick<Walk, 'id' | 'familyId' | 'dogId'>, userId: string | null | undefined, reason?: GpsStopReason, detail?: string) => Promise<WalkGpsSession | null>;
  /** Discards a provisional watch when walk creation/start fails; never persists points for an unstarted walk. */
  cancelTracking: (walkId: string, reason?: GpsCancelReason) => void;
  /** Loads a walk's already-persisted session (e.g. to show a past walk's distance) without starting any tracking. */
  loadSession: (walkId: string) => Promise<WalkGpsSession | undefined>;
  /** PRD §7's required correction flow: records a family member's confirmed/edited distance — see WalkGpsSession.correctedDistanceMeters' own doc comment for why this, not distanceMeters, then becomes authoritative. */
  correctDistance: (walkId: string, correctedMeters: number, userId: string | null | undefined) => Promise<WalkGpsSession | undefined>;
}

async function persistGpsRoute(
  walkId: string,
  accumulator: Pick<GpsAccumulator, 'distanceMeters' | 'pointCount' | 'routePoints'>,
  endedAt?: string,
): Promise<void> {
  if (!repository.appendGpsRouteV11) return;
  const gps = useGpsStore.getState();
  const epoch = gps.gpsFencingEpoch;
  if (epoch === null || gps.trackingWalkId !== walkId) return;
  const points = (accumulator.routePoints ?? []).filter((point) => point.timestamp > lastPersistedGpsTimestamp);
  if (!points.length && !endedAt) return;
  // The server deduplicates by point timestamp as an additional safeguard
  // against a request retry after the response is lost.
  for (let offset = 0; offset < Math.max(points.length, 1); offset += 200) {
    const batch = points.slice(offset, offset + 200);
    const saved = await repository.appendGpsRouteV11({
      walkId,
      fencingEpoch: epoch,
      points: batch,
      distanceMeters: accumulator.distanceMeters,
      pointCount: accumulator.pointCount,
      startedAt: gps.trackingStartedAt ?? undefined,
      endedAt,
    });
    if (batch.length) lastPersistedGpsTimestamp = Math.max(lastPersistedGpsTimestamp, ...batch.map((point) => point.timestamp));
    useGpsStore.setState((state) => ({ sessionsByWalkId: { ...state.sessionsByWalkId, [walkId]: saved } }));
  }
}

async function releaseGpsOwnership(walkId: string, fencingEpoch: number | null): Promise<void> {
  if (fencingEpoch === null || !repository.releaseGpsOwnershipV11) return;
  try {
    await repository.releaseGpsOwnershipV11(walkId, fencingEpoch);
    recordGpsLifecycle('lease_released', walkId, undefined, { epoch: fencingEpoch });
  } catch (error) {
    // A missed release is bounded by the server lease; never discard a
    // captured route or claim the lease was released when the request failed.
    console.warn('[gpsStore] GPS ownership release failed; server lease will expire', error);
  }
}

export const useGpsStore = create<GpsState>((set, get) => ({
  trackingWalkId: null,
  permissionStatus: null,
  trackingStatus: null,
  trackingStartedAt: null,
  distanceMeters: 0,
  pointCount: 0,
  routePoints: [],
  reconstruction: null,
  reconstructionNotice: null,
  gpsFencingEpoch: null,
  trackingSource: null,
  remoteGpsCommandId: null,
  lastGpsStop: null,
  sessionsByWalkId: {},

  startTracking: async (walk) => {
    const current = get();
    // A second caller (e.g. remote-command polling plus the Start button)
    // must not create a competing browser/native subscription. Failed rounds
    // remain explicitly retryable.
    if (current.trackingWalkId === walk.id && current.trackingStatus !== 'timeout' && current.trackingStatus !== 'unavailable' && current.trackingStatus !== 'denied' && current.trackingStatus !== 'interrupted') return;
    const preserveCapturedRoute = current.trackingWalkId === walk.id && current.pointCount > 0 && current.routePoints.length > 0;
    const priorRoute = preserveCapturedRoute ? current.routePoints : [];
    const priorDistance = preserveCapturedRoute ? current.distanceMeters : 0;
    const priorPointCount = preserveCapturedRoute ? current.pointCount : 0;
    const priorStartedAt = preserveCapturedRoute ? current.trackingStartedAt : null;
    const generation = ++startGeneration;
    const trackingStartedAt = new Date().toISOString();
    // A previous walk's watch left running (shouldn't normally happen —
    // stopTracking() always tears it down — but never leak a subscription
    // across walks if it does).
    if (activeWatch) {
      activeWatch.remove();
      activeWatch = null;
    }
    activeWatchWalkId = walk.id;
    if (activeGpsHeartbeat) clearInterval(activeGpsHeartbeat);
    activeGpsHeartbeat = null;
    lastPersistedGpsTimestamp = 0;
    gpsLeaseLost = false;
    if (pendingOwnership && pendingOwnership.walk.id !== walk.id) pendingOwnership = null;
    // A retry of the same walk keeps its origin; any new session is local
    // until a Remote GPS command acknowledgement says otherwise.
    const sameWalk = current.trackingWalkId === walk.id;
    const trackingSource = sameWalk ? current.trackingSource ?? 'local' : 'local';
    const remoteGpsCommandId = sameWalk ? current.remoteGpsCommandId : null;
    recordGpsLifecycle('start', walk.id, sameWalk ? 'retry_same_walk' : 'new_session', { source: trackingSource, priorPoints: priorPointCount });
    if (!sameWalk) reconstructionAttempts.delete(walk.id);
    const priorReconstruction = sameWalk ? current.reconstruction : null;
    set({ trackingWalkId: walk.id, permissionStatus: null, trackingStatus: 'requesting', trackingStartedAt: priorStartedAt, distanceMeters: priorDistance, pointCount: priorPointCount, routePoints: priorRoute, reconstruction: priorReconstruction, reconstructionNotice: null, gpsFencingEpoch: null, trackingSource, remoteGpsCommandId });

    const result = await startGpsWatch((acc: GpsAccumulator) => {
      // Ignore a late callback from a watch that's since been stopped/
      // superseded (e.g. the walk ended right as a fix arrived).
      if (startGeneration !== generation || get().trackingWalkId !== activeWatchWalkId) return;
      const newPoints = (acc.routePoints ?? []).map(({ latitude, longitude, timestamp }) => ({ latitude, longitude, timestamp }));
      const combinedRoute = preserveCapturedRoute
        ? [...priorRoute, ...newPoints.filter((point) => !priorRoute.some((saved) => saved.timestamp === point.timestamp))]
        : newPoints;
      const combined = { distanceMeters: priorDistance + acc.distanceMeters, pointCount: priorPointCount + acc.pointCount, routePoints: combinedRoute };
      const isFirstReliableFix = get().pointCount === 0 && combined.pointCount > 0;
      if (get().pointCount === 0 && combined.pointCount > 0) recordGpsLifecycle('first_fix', activeWatchWalkId);
      set({ distanceMeters: combined.distanceMeters, pointCount: combined.pointCount, trackingStatus: gpsLeaseLost ? 'interrupted' : 'active', routePoints: combinedRoute });
      if (!preserveCapturedRoute && isFirstReliableFix && acc.routePoints?.[0]) {
        void attemptMissingRouteReconstruction(walk, generation, acc.routePoints[0], acc.routePoints[1]);
      }
      if (activeWatchWalkId) void persistGpsRoute(activeWatchWalkId, combined).catch((error) => console.warn('[gpsStore] route persistence failed', error));
    }, (trackingStatus) => {
      if (startGeneration === generation && get().trackingWalkId === activeWatchWalkId) set({ trackingStatus });
    });

    // The server can adopt the canonical ID while Safari's permission prompt
    // / watch initialization is still pending. Compare against the mutable
    // active identity, not the original tap-time ID, or this valid watch is
    // removed just as it is created.
    if (startGeneration !== generation || !activeWatchWalkId || get().trackingWalkId !== activeWatchWalkId) {
      // startTracking() was called again for a different walk while this
      // permission/start round-trip was in flight — this handle belongs to
      // an already-superseded session; tear it down instead of leaking it.
      result.handle?.remove();
      return;
    }
    if (!result.handle) {
      // Keep the active walk attached to the store even when the OS/browser
      // denies location or cannot create a watch. The Home card can then
      // explain the GPS state instead of silently losing the GPS section.
      set({ trackingWalkId: activeWatchWalkId, permissionStatus: result.permissionStatus, trackingStatus: result.trackingStatus });
      return;
    }
    activeWatch = result.handle;
    set({ permissionStatus: 'granted', trackingStatus: get().pointCount > 0 ? 'active' : result.trackingStatus, trackingStartedAt: priorStartedAt ?? trackingStartedAt });
    const deferred = pendingOwnership;
    if (deferred && deferred.walk.id === activeWatchWalkId) {
      pendingOwnership = null;
      void get().attachGpsOwnership(deferred.walk, deferred.confirmTransfer);
    }
  },

  attachGpsOwnership: async (walk, confirmTransfer = false) => {
    if (!repository.acquireGpsOwnershipV11) return true;
    if (get().trackingWalkId !== walk.id || activeWatchWalkId !== walk.id) return false;
    if (get().permissionStatus !== 'granted') {
      // Still starting up (permission prompt / first fix pending): defer to
      // the end of startTracking() instead of dropping the request.
      const startingUp = get().permissionStatus === null && !activeWatch;
      if (startingUp) pendingOwnership = { walk, confirmTransfer };
      return false;
    }
    if (get().gpsFencingEpoch !== null && !confirmTransfer) return true;
    // One lease request per walk at a time: a second "הפעל GPS" tap during
    // Safari's startup (its deferred request plus the tap's own .then) joins
    // the acquisition already in flight instead of racing it for a second
    // fencing epoch. An explicit transfer confirmation always goes through.
    if (!confirmTransfer && ownershipRequest?.walkId === walk.id) return ownershipRequest.promise;
    const request = (async (): Promise<boolean> => {
      try {
        const lease = await repository.acquireGpsOwnershipV11!(walk.id, confirmTransfer);
        if (get().trackingWalkId !== walk.id || activeWatchWalkId !== walk.id) return false;
        const recoveredLease = gpsLeaseLost;
        gpsLeaseLost = false;
        set({
          gpsFencingEpoch: lease.fencingEpoch,
          ...(recoveredLease && get().trackingStatus === 'interrupted' && get().pointCount > 0 ? { trackingStatus: 'active' as const } : {}),
        });
        recordGpsLifecycle('lease_acquired', walk.id, recoveredLease ? 'renewed_after_loss' : confirmTransfer ? 'transfer_confirmed' : 'acquired', { epoch: lease.fencingEpoch });
        lastPersistedGpsTimestamp = 0;
        if (activeGpsHeartbeat) clearInterval(activeGpsHeartbeat);
        activeGpsHeartbeat = repository.heartbeatGpsOwnershipV11
          ? setInterval(() => {
              void repository.heartbeatGpsOwnershipV11!(walk.id, lease.fencingEpoch).catch((error) => {
                if (get().trackingWalkId !== walk.id || get().gpsFencingEpoch !== lease.fencingEpoch) return;
                if (!isGpsLeaseLostError(error)) {
                  // A dropped request does not prove the server lease ended.
                  // Keep the epoch; the next heartbeat (or the server's own
                  // expiry answer) decides. Route writes stay fenced server-side.
                  console.warn('[gpsStore] GPS ownership heartbeat failed; retrying on the next interval', error);
                  return;
                }
                // Typical on iPhone Safari after the screen was locked longer
                // than the lease. Renew on this same device without transfer
                // confirmation; the server refuses that if another device now
                // owns GPS for this walk, which leaves the walk interrupted.
                console.warn('[gpsStore] GPS ownership lease ended; renewing on this device', error);
                if (activeGpsHeartbeat) clearInterval(activeGpsHeartbeat);
                activeGpsHeartbeat = null;
                gpsLeaseLost = true;
                recordGpsLifecycle('lease_lost', walk.id, 'heartbeat_rejected', { epoch: lease.fencingEpoch });
                set({ gpsFencingEpoch: null, trackingStatus: 'interrupted' });
                void get().attachGpsOwnership(walk);
              });
            }, 15_000)
          : null;
        await persistGpsRoute(walk.id, {
          distanceMeters: get().distanceMeters,
          pointCount: get().pointCount,
          routePoints: get().routePoints,
        });
        return true;
      } catch (error) {
        console.warn('[gpsStore] GPS ownership was not acquired', error);
        recordGpsLifecycle('lease_lost', walk.id, 'acquire_rejected', { message: error instanceof Error ? error.message.slice(0, 120) : null });
        if (get().trackingWalkId === walk.id) {
          gpsLeaseLost = true;
          if (activeGpsHeartbeat) clearInterval(activeGpsHeartbeat);
          activeGpsHeartbeat = null;
        }
        set({ gpsFencingEpoch: null, trackingStatus: get().permissionStatus === 'denied' ? 'denied' : 'interrupted' });
        return false;
      }
    })();
    if (!confirmTransfer) ownershipRequest = { walkId: walk.id, promise: request };
    try {
      return await request;
    } finally {
      if (ownershipRequest?.promise === request) ownershipRequest = null;
    }
  },

  markRemoteTracking: (walkId, commandId = null) => {
    if (get().trackingWalkId !== walkId || activeWatchWalkId !== walkId) return false;
    set({ trackingSource: 'remote', remoteGpsCommandId: commandId });
    recordGpsLifecycle('remote_marked', walkId, 'command_acknowledged', { commandId });
    return true;
  },

  detachRemoteTracking: (walkId, outcome) => {
    if (get().trackingWalkId !== walkId || get().trackingSource !== 'remote') return false;
    recordGpsLifecycle('remote_detached', walkId, outcome, { commandId: get().remoteGpsCommandId });
    set({ trackingSource: 'local', remoteGpsCommandId: null });
    return true;
  },

  rebindTrackingWalk: (localWalk, canonicalWalk) => {
    const current = get();
    if (current.trackingWalkId !== localWalk.id || activeWatchWalkId !== localWalk.id) return false;
    if (localWalk.familyId !== canonicalWalk.familyId || localWalk.dogId !== canonicalWalk.dogId) return false;
    // Only adopt a new ID for the same scheduled occurrence. A pair of
    // spontaneous walks both have an undefined schedule ID, which is not
    // enough evidence to treat them as the same walk.
    if (!localWalk.scheduleEntryId || localWalk.scheduleEntryId !== canonicalWalk.scheduleEntryId) return false;
    if (localWalk.id === canonicalWalk.id) return true;
    activeWatchWalkId = canonicalWalk.id;
    set({ trackingWalkId: canonicalWalk.id });
    return true;
  },

  cancelTracking: (walkId, reason) => {
    if (get().trackingWalkId !== walkId || activeWatchWalkId !== walkId) return;
    const cancelReason = reason ?? 'unspecified';
    recordGpsLifecycle('cancel', walkId, cancelReason, { points: get().pointCount });
    startGeneration += 1;
    pendingOwnership = null;
    ownershipRequest = null;
    activeWatch?.remove();
    activeWatch = null;
    if (activeGpsHeartbeat) clearInterval(activeGpsHeartbeat);
    activeGpsHeartbeat = null;
    activeWatchWalkId = null;
    gpsLeaseLost = false;
    reconstructionAttempts.delete(walkId);
    set({ trackingWalkId: null, permissionStatus: null, trackingStatus: null, trackingStartedAt: null, distanceMeters: 0, pointCount: 0, routePoints: [], reconstruction: null, reconstructionNotice: null, gpsFencingEpoch: null, trackingSource: null, remoteGpsCommandId: null, lastGpsStop: { walkId, kind: 'cancel', reason: cancelReason, at: new Date().toISOString() } });
  },

  stopTracking: async (walk, userId, reason, detail) => {
    const wasTracking = get().trackingWalkId === walk.id;
    const stopReason = `${reason ?? 'unspecified'}${detail ? `:${detail}` : ''}`;
    if (wasTracking) recordGpsLifecycle('stop', walk.id, stopReason, { points: get().pointCount, leased: get().gpsFencingEpoch !== null, source: get().trackingSource });
    const stopMark = { walkId: walk.id, kind: 'stop' as const, reason: stopReason, at: new Date().toISOString() };
    if (wasTracking) startGeneration += 1;
    if (wasTracking) pendingOwnership = null;
    if (wasTracking) ownershipRequest = null;
    if (activeWatch && wasTracking) {
      activeWatch.remove();
      activeWatch = null;
    }
    if (!wasTracking) return null; // this walk was never the one being tracked

    const { distanceMeters, pointCount, trackingStartedAt, gpsFencingEpoch } = get();
    const now = new Date().toISOString();

    // Nothing was ever actually captured (denied/unavailable, or stopped
    // before any fix arrived) — no session worth persisting.
    if (pointCount === 0) {
      await releaseGpsOwnership(walk.id, gpsFencingEpoch);
      if (activeGpsHeartbeat) clearInterval(activeGpsHeartbeat);
      activeGpsHeartbeat = null;
      activeWatchWalkId = null;
      gpsLeaseLost = false;
      set({ trackingWalkId: null, trackingStartedAt: null, trackingStatus: null, permissionStatus: null, gpsFencingEpoch: null, trackingSource: null, remoteGpsCommandId: null, reconstruction: null, reconstructionNotice: null, lastGpsStop: stopMark });
      return null;
    }

    const existing = get().sessionsByWalkId[walk.id];
    const session: WalkGpsSession = {
      id: existing?.id ?? generateId('gps-session'),
      walkId: walk.id,
      familyId: walk.familyId,
      dogId: walk.dogId,
      distanceMeters,
      pointCount,
      routePoints: get().routePoints,
      reconstruction: get().reconstruction ?? undefined,
      source: 'device_gps',
      // Schema/repository layer already round-trips these (migration
      // 0051); this store previously never populated them at all. Bug
      // fix, found during the GPS audit — trackingStartedAt is set the
      // moment startTracking()'s watch actually begins (not merely when
      // it's called), `now` is this stop.
      startedAt: trackingStartedAt ?? undefined,
      endedAt: now,
      createdByUserId: existing?.createdByUserId ?? userId ?? undefined,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
    if (repository.appendGpsRouteV11) {
      // Persist estimate metadata via an estimate-only, identity-fenced RPC
      // before attempting the online, GPS-lease-fenced measured route upload.
      // Offline replay must never send raw points or bypass the GPS lease.
      if (session.reconstruction && repository.saveGpsReconstructionV1) {
        try { await repository.saveGpsReconstructionV1(session); }
        catch (error) { console.warn('[gpsStore] estimated route retained locally for sync', error); }
      }
      if (gpsFencingEpoch === null) {
        set({ trackingStatus: 'interrupted' });
        throw new Error('GPS route was not saved because this device no longer owns GPS for the walk');
      }
      let saved: WalkGpsSession;
      try {
        saved = await repository.appendGpsRouteV11({
          walkId: walk.id,
          fencingEpoch: gpsFencingEpoch,
          points: session.routePoints ?? [],
          distanceMeters,
          pointCount,
          startedAt: session.startedAt,
          endedAt: now,
        });
      } catch (error) {
        // Keep the captured route and lease epoch in memory if persistence
        // fails. The walk remains active and retryable; never clear the only
        // copy and then report a successful completion.
        if (activeGpsHeartbeat) clearInterval(activeGpsHeartbeat);
        activeGpsHeartbeat = null;
        set({ trackingStatus: 'interrupted' });
        throw error;
      }
      await releaseGpsOwnership(walk.id, gpsFencingEpoch);
      if (activeGpsHeartbeat) clearInterval(activeGpsHeartbeat);
      activeGpsHeartbeat = null;
      activeWatchWalkId = null;
      gpsLeaseLost = false;
      set({ trackingWalkId: null, trackingStartedAt: null, trackingStatus: null, permissionStatus: null, gpsFencingEpoch: null, trackingSource: null, remoteGpsCommandId: null, reconstruction: null, reconstructionNotice: null, lastGpsStop: stopMark });
      reconstructionAttempts.delete(walk.id);
      const completeSaved = { ...saved, reconstruction: session.reconstruction };
      set((s) => ({ sessionsByWalkId: { ...s.sessionsByWalkId, [walk.id]: completeSaved } }));
      set({ routePoints: [] });
      return completeSaved;
    }
    await repository.upsertGpsSession(session);
    await releaseGpsOwnership(walk.id, gpsFencingEpoch);
    if (activeGpsHeartbeat) clearInterval(activeGpsHeartbeat);
    activeGpsHeartbeat = null;
    activeWatchWalkId = null;
    gpsLeaseLost = false;
    set({ trackingWalkId: null, trackingStartedAt: null, trackingStatus: null, permissionStatus: null, gpsFencingEpoch: null, trackingSource: null, remoteGpsCommandId: null, reconstruction: null, reconstructionNotice: null, lastGpsStop: stopMark });
    reconstructionAttempts.delete(walk.id);
    set((s) => ({ sessionsByWalkId: { ...s.sessionsByWalkId, [walk.id]: session } }));
    set({ routePoints: [] });
    return session;
  },

  loadSession: async (walkId) => {
    const session = await repository.getGpsSession(walkId);
    if (session) set((s) => ({ sessionsByWalkId: { ...s.sessionsByWalkId, [walkId]: session } }));
    return session;
  },

  correctDistance: async (walkId, correctedMeters, userId) => {
    const existing = get().sessionsByWalkId[walkId] ?? (await get().loadSession(walkId));
    if (!existing) return undefined;
    const corrected: WalkGpsSession = {
      ...existing,
      correctedDistanceMeters: correctedMeters,
      correctedByUserId: userId ?? undefined,
      updatedAt: new Date().toISOString(),
    };
    await repository.upsertGpsSession(corrected);
    set((s) => ({ sessionsByWalkId: { ...s.sessionsByWalkId, [walkId]: corrected } }));
    return corrected;
  },
}));
