import { create } from 'zustand';
import type { Walk, WalkGpsSession } from '../types';
import { repository } from '../data';
import { generateId } from '../lib/id';
import { startGpsWatch, type GpsPermissionStatus, type GpsTrackingStatus, type GpsWatchHandle } from '../lib/gpsTracking';
import type { GpsAccumulator } from '../logic/gpsDistance';

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
  gpsFencingEpoch: number | null;
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
  stopTracking: (walk: Pick<Walk, 'id' | 'familyId' | 'dogId'>, userId: string | null | undefined) => Promise<WalkGpsSession | null>;
  /** Discards a provisional watch when walk creation/start fails; never persists points for an unstarted walk. */
  cancelTracking: (walkId: string) => void;
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
  gpsFencingEpoch: null,
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
    set({ trackingWalkId: walk.id, permissionStatus: null, trackingStatus: 'requesting', trackingStartedAt: priorStartedAt, distanceMeters: priorDistance, pointCount: priorPointCount, routePoints: priorRoute, gpsFencingEpoch: null });

    const result = await startGpsWatch((acc: GpsAccumulator) => {
      // Ignore a late callback from a watch that's since been stopped/
      // superseded (e.g. the walk ended right as a fix arrived).
      if (startGeneration !== generation || get().trackingWalkId !== activeWatchWalkId) return;
      const newPoints = (acc.routePoints ?? []).map(({ latitude, longitude, timestamp }) => ({ latitude, longitude, timestamp }));
      const combinedRoute = preserveCapturedRoute
        ? [...priorRoute, ...newPoints.filter((point) => !priorRoute.some((saved) => saved.timestamp === point.timestamp))]
        : newPoints;
      const combined = { distanceMeters: priorDistance + acc.distanceMeters, pointCount: priorPointCount + acc.pointCount, routePoints: combinedRoute };
      set({ distanceMeters: combined.distanceMeters, pointCount: combined.pointCount, trackingStatus: gpsLeaseLost ? 'interrupted' : 'active', routePoints: combinedRoute });
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
  },

  attachGpsOwnership: async (walk, confirmTransfer = false) => {
    if (!repository.acquireGpsOwnershipV11) return true;
    if (get().trackingWalkId !== walk.id || activeWatchWalkId !== walk.id) return false;
    if (get().permissionStatus !== 'granted') return false;
    if (get().gpsFencingEpoch !== null && !confirmTransfer) return true;
    try {
      const lease = await repository.acquireGpsOwnershipV11(walk.id, confirmTransfer);
      if (get().trackingWalkId !== walk.id || activeWatchWalkId !== walk.id) return false;
      const recoveredLease = gpsLeaseLost;
      gpsLeaseLost = false;
      set({
        gpsFencingEpoch: lease.fencingEpoch,
        ...(recoveredLease && get().trackingStatus === 'interrupted' && get().pointCount > 0 ? { trackingStatus: 'active' as const } : {}),
      });
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
      if (get().trackingWalkId === walk.id) {
        gpsLeaseLost = true;
        if (activeGpsHeartbeat) clearInterval(activeGpsHeartbeat);
        activeGpsHeartbeat = null;
      }
      set({ gpsFencingEpoch: null, trackingStatus: get().permissionStatus === 'denied' ? 'denied' : 'interrupted' });
      return false;
    }
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

  cancelTracking: (walkId) => {
    if (get().trackingWalkId !== walkId || activeWatchWalkId !== walkId) return;
    startGeneration += 1;
    activeWatch?.remove();
    activeWatch = null;
    if (activeGpsHeartbeat) clearInterval(activeGpsHeartbeat);
    activeGpsHeartbeat = null;
    activeWatchWalkId = null;
    gpsLeaseLost = false;
    set({ trackingWalkId: null, permissionStatus: null, trackingStatus: null, trackingStartedAt: null, distanceMeters: 0, pointCount: 0, routePoints: [], gpsFencingEpoch: null });
  },

  stopTracking: async (walk, userId) => {
    const wasTracking = get().trackingWalkId === walk.id;
    if (wasTracking) startGeneration += 1;
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
      set({ trackingWalkId: null, trackingStartedAt: null, trackingStatus: null, permissionStatus: null, gpsFencingEpoch: null });
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
      set({ trackingWalkId: null, trackingStartedAt: null, trackingStatus: null, permissionStatus: null, gpsFencingEpoch: null });
      set((s) => ({ sessionsByWalkId: { ...s.sessionsByWalkId, [walk.id]: saved } }));
      set({ routePoints: [] });
      return saved;
    }
    await repository.upsertGpsSession(session);
    await releaseGpsOwnership(walk.id, gpsFencingEpoch);
    if (activeGpsHeartbeat) clearInterval(activeGpsHeartbeat);
    activeGpsHeartbeat = null;
    activeWatchWalkId = null;
    gpsLeaseLost = false;
    set({ trackingWalkId: null, trackingStartedAt: null, trackingStatus: null, permissionStatus: null, gpsFencingEpoch: null });
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
