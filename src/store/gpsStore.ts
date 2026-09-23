import { create } from 'zustand';
import type { Walk, WalkGpsSession } from '../types';
import { repository } from '../data';
import { generateId } from '../lib/id';
import { startGpsWatch, type GpsPermissionStatus, type GpsWatchHandle } from '../lib/gpsTracking';
import type { GpsAccumulator } from '../logic/gpsDistance';

// Not store state — the live OS subscription handle. Kept outside the
// store (like localRepository's in-memory cache, or notificationService's
// module-scope caches) since a subscription handle isn't serializable
// UI state; the store only ever exposes DERIVED numbers from it
// (distanceMeters/pointCount), never the handle itself.
let activeWatch: GpsWatchHandle | null = null;

interface GpsState {
  /** The walk currently being tracked, if any — null when no walk is in progress or the active walk simply isn't being tracked (permission denied/unavailable). */
  trackingWalkId: string | null;
  /** Set once startTracking() resolves permission — lets UI show WHY there's no live distance (denied vs. unavailable vs. simply not started yet). */
  permissionStatus: GpsPermissionStatus | null;
  /** Live running total while trackingWalkId is set — meaningless/stale once tracking stops (read sessionsByWalkId for the persisted, authoritative value instead). */
  distanceMeters: number;
  pointCount: number;
  routePoints: Array<{ latitude: number; longitude: number; timestamp: number }>;
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
  /** Loads a walk's already-persisted session (e.g. to show a past walk's distance) without starting any tracking. */
  loadSession: (walkId: string) => Promise<WalkGpsSession | undefined>;
  /** PRD §7's required correction flow: records a family member's confirmed/edited distance — see WalkGpsSession.correctedDistanceMeters' own doc comment for why this, not distanceMeters, then becomes authoritative. */
  correctDistance: (walkId: string, correctedMeters: number, userId: string | null | undefined) => Promise<WalkGpsSession | undefined>;
}

export const useGpsStore = create<GpsState>((set, get) => ({
  trackingWalkId: null,
  permissionStatus: null,
  distanceMeters: 0,
  pointCount: 0,
  routePoints: [],
  sessionsByWalkId: {},

  startTracking: async (walk) => {
    // A previous walk's watch left running (shouldn't normally happen —
    // stopTracking() always tears it down — but never leak a subscription
    // across walks if it does).
    if (activeWatch) {
      activeWatch.remove();
      activeWatch = null;
    }
    set({ trackingWalkId: walk.id, permissionStatus: null, distanceMeters: 0, pointCount: 0, routePoints: [] });

    const handle = await startGpsWatch((acc: GpsAccumulator) => {
      // Ignore a late callback from a watch that's since been stopped/
      // superseded (e.g. the walk ended right as a fix arrived).
      if (get().trackingWalkId !== walk.id) return;
      set({ distanceMeters: acc.distanceMeters, pointCount: acc.pointCount, routePoints: acc.routePoints.map(({ latitude, longitude, timestamp }) => ({ latitude, longitude, timestamp })) });
    });

    if (get().trackingWalkId !== walk.id) {
      // startTracking() was called again for a different walk while this
      // permission/start round-trip was in flight — this handle belongs to
      // an already-superseded session; tear it down instead of leaking it.
      handle?.remove();
      return;
    }
    if (!handle) {
      set({ trackingWalkId: null, permissionStatus: 'denied' });
      // requestForegroundGpsPermission() itself already distinguishes
      // denied/unavailable, but startGpsWatch() collapses both to `null` —
      // re-deriving here would need a second call. Re-checking isn't worth
      // the round trip for a purely informational status; 'denied' is the
      // more actionable message either way ("enable location" beats a
      // generic "GPS unavailable" when the real cause could be either).
      return;
    }
    activeWatch = handle;
    set({ permissionStatus: 'granted' });
  },

  stopTracking: async (walk, userId) => {
    const wasTracking = get().trackingWalkId === walk.id;
    if (activeWatch && wasTracking) {
      activeWatch.remove();
      activeWatch = null;
    }
    if (!wasTracking) return null; // this walk was never the one being tracked

    const { distanceMeters, pointCount } = get();
    set({ trackingWalkId: null });

    // Nothing was ever actually captured (denied/unavailable, or stopped
    // before any fix arrived) — no session worth persisting.
    if (pointCount === 0) return null;

    const now = new Date().toISOString();
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
      createdByUserId: existing?.createdByUserId ?? userId ?? undefined,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
    await repository.upsertGpsSession(session);
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
