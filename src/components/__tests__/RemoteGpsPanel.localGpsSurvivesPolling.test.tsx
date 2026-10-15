import React from 'react';
import { AppState, Text } from 'react-native';
import { act, render, screen } from '@testing-library/react-native';
import type { Walk } from '../../types';
import { accumulateDistance, createGpsAccumulator, formatDistanceMeters, type GpsAccumulator, type GpsPoint } from '../../logic/gpsDistance';
import type { GpsTrackingStatus, GpsWatchStartResult } from '../../lib/gpsTracking';
import { RemoteGpsPanel } from '../RemoteGpsPanel';
import { RoutePreview } from '../RoutePreview';
import { useGpsStore } from '../../store/gpsStore';

/**
 * P0 real-iPhone regression (2026-10-15, PR #150 feature Preview).
 *
 * Observed on iPhone Safari: tap "הפעל GPS" → "8 מ'" appears for a moment →
 * it disappears → the live map returns to "ממתין למיקום GPS ראשון…" and the
 * card offers "הפעל GPS" again. Reproducible on every tap.
 *
 * Cause: RemoteGpsPanel's 6-second remote-command poller stopped ANY GPS
 * tracking on this device that had no matching remote `tracking` command —
 * including the walker's own local tracking, which never has one. The stop
 * persisted the route with endedAt mid-walk, released the v1.1 lease and
 * cleared trackingWalkId.
 *
 * "8 מ'" is the live route DISTANCE (NextWalkCard → formatDistanceMeters),
 * which is > 0 only after two accepted fixes ≥ 3 m apart; it is not accuracy.
 */

const mockScheduleState: { walks: Walk[] } = { walks: [] };
const mockFamilyState: { users: unknown[]; family: { id: string } | null } = { users: [], family: { id: 'family-1' } };
const mockStartGpsWatch = jest.fn();

jest.mock('../../data', () => ({
  repository: {
    acquireGpsOwnershipV11: jest.fn(),
    heartbeatGpsOwnershipV11: jest.fn(),
    releaseGpsOwnershipV11: jest.fn(),
    appendGpsRouteV11: jest.fn(),
    upsertGpsSession: jest.fn(),
    getGpsSession: jest.fn(),
  },
}));
jest.mock('../../lib/gpsTracking', () => ({
  startGpsWatch: (...args: unknown[]) => mockStartGpsWatch(...args),
}));
jest.mock('../../lib/supabase', () => ({ isSupabaseConfigured: true }));
jest.mock('../../lib/remoteGps', () => ({
  getRemoteGpsSettings: jest.fn(),
  getMyRemoteGpsCommands: jest.fn(),
  getRemoteGpsWalkStatus: jest.fn(),
  heartbeatRemoteGpsTracking: jest.fn(),
  stopRemoteGpsTracking: jest.fn(),
  acknowledgeRemoteGpsStart: jest.fn(),
  listRemoteGpsTargets: jest.fn(),
  requestRemoteGpsStart: jest.fn(),
  sendRemoteGpsNotification: jest.fn(),
  setFamilyRemoteGpsEnabled: jest.fn(),
  setRemoteGpsConsent: jest.fn(),
}));
jest.mock('../../store/scheduleStore', () => ({
  useScheduleStore: { getState: () => mockScheduleState },
}));
jest.mock('../../store/familyStore', () => {
  const hook = (selector?: (state: unknown) => unknown) => (selector ? selector(mockFamilyState) : mockFamilyState);
  return { useFamilyStore: Object.assign(hook, { getState: () => mockFamilyState }) };
});
jest.mock('react-native-svg', () => ({ __esModule: true, default: 'Svg', Circle: 'Circle', Polyline: 'Polyline' }));

const repository = require('../../data').repository as Record<string, jest.Mock>;
const remoteGps = require('../../lib/remoteGps') as Record<string, jest.Mock>;

const WALKER = 'user-walker';
const walk = {
  id: 'walk-1',
  familyId: 'family-1',
  dogId: 'dog-1',
  status: 'in_progress',
  responsibleUserId: WALKER,
  actualWalkerUserId: WALKER,
  date: '2026-10-15',
  scheduledTime: '13:00',
} as unknown as Walk;

// Tel Aviv; B is ~8.0 m north of A — the distance the iPhone briefly showed.
const METERS_PER_DEGREE_LAT = (6371000 * Math.PI) / 180;
const fixA: GpsPoint = { latitude: 32.0853, longitude: 34.7818, timestamp: 1_760_000_000_000, accuracy: 6 };
const fixB: GpsPoint = { latitude: 32.0853 + 8 / METERS_PER_DEGREE_LAT, longitude: 34.7818, timestamp: 1_760_000_001_000, accuracy: 5 };

interface SafariWatch {
  handle: { remove: jest.Mock };
  deliver: (point: GpsPoint) => void;
  signalLoss: () => void;
}

/** Mirrors lib/gpsTracking's Web path: startup resolves only at Safari's first fix. */
function installSafariWatch(): SafariWatch {
  const handle = { remove: jest.fn() };
  let onUpdate: (acc: GpsAccumulator) => void = () => undefined;
  let onStatus: (status: GpsTrackingStatus) => void = () => undefined;
  let resolveStartup: (result: GpsWatchStartResult) => void = () => undefined;
  let acc = createGpsAccumulator();
  let started = false;
  mockStartGpsWatch.mockImplementation((update: typeof onUpdate, status: typeof onStatus) => {
    onUpdate = update;
    onStatus = status;
    onStatus('waiting');
    return new Promise<GpsWatchStartResult>((resolve) => { resolveStartup = resolve; });
  });
  return {
    handle,
    deliver: (point) => {
      acc = accumulateDistance(acc, point);
      onUpdate(acc);
      onStatus('active');
      if (!started) {
        started = true;
        resolveStartup({ handle, permissionStatus: 'granted', trackingStatus: 'active' });
      }
    },
    signalLoss: () => onStatus('interrupted'),
  };
}

/** The same gating HomeScreen/NextWalkCard use: values only while this walk is the tracked one. */
function LiveWalkGpsProbe({ walkId }: { walkId: string }) {
  const trackingWalkId = useGpsStore((s) => s.trackingWalkId);
  const distance = useGpsStore((s) => s.distanceMeters);
  const status = useGpsStore((s) => s.trackingStatus);
  const route = useGpsStore((s) => s.routePoints);
  const tracked = trackingWalkId === walkId;
  const line = !tracked
    ? 'GPS לא פעיל במכשיר הזה'
    : status === 'active' && distance > 0
      ? formatDistanceMeters(distance)
      : `status:${status}`;
  return (
    <>
      <Text testID="gps-line">{line}</Text>
      <RoutePreview live session={{ routePoints: tracked ? route : [] } as never} />
    </>
  );
}

async function flush(rounds = 12) {
  for (let i = 0; i < rounds; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    await act(async () => { await Promise.resolve(); });
  }
}

async function advance(ms: number) {
  await act(async () => { await jest.advanceTimersByTimeAsync(ms); });
  await flush();
}

function renderHome() {
  return render(
    <>
      <LiveWalkGpsProbe walkId={walk.id} />
      <RemoteGpsPanel walk={walk} currentUserId={WALKER} familyRole="member" ready mode="home" />
    </>
  );
}

/** HomeScreen's "הפעל GPS" handler, verbatim. */
function tapActivateGps() {
  return useGpsStore.getState().startTracking(walk).then(() => useGpsStore.getState().attachGpsOwnership(walk));
}

const finalRouteWrites = () => repository.appendGpsRouteV11.mock.calls.filter(([input]) => (input as { endedAt?: string }).endedAt !== undefined);

beforeAll(() => {
  try {
    Object.defineProperty(AppState, 'currentState', { configurable: true, get: () => 'active' });
  } catch {
    (AppState as unknown as { currentState: string }).currentState = 'active';
  }
  jest.spyOn(AppState, 'addEventListener').mockImplementation(() => ({ remove: jest.fn() }) as never);
});

beforeEach(() => {
  jest.useFakeTimers();
  jest.clearAllMocks();
  mockScheduleState.walks = [walk];
  useGpsStore.setState({ trackingWalkId: null, permissionStatus: null, trackingStatus: null, trackingStartedAt: null, distanceMeters: 0, pointCount: 0, routePoints: [], gpsFencingEpoch: null, sessionsByWalkId: {} });
  // A family with Remote GPS enabled and this walker's consent on: the
  // poller is live on Home, exactly as on the tester's Staging family.
  remoteGps.getRemoteGpsSettings.mockResolvedValue({ familyEnabled: true, consentEnabled: true, isAdmin: false });
  remoteGps.getMyRemoteGpsCommands.mockResolvedValue([]);
  remoteGps.getRemoteGpsWalkStatus.mockResolvedValue([]);
  remoteGps.heartbeatRemoteGpsTracking.mockResolvedValue(undefined);
  remoteGps.stopRemoteGpsTracking.mockResolvedValue(undefined);
  remoteGps.acknowledgeRemoteGpsStart.mockResolvedValue(undefined);
  repository.acquireGpsOwnershipV11.mockResolvedValue({ fencingEpoch: 3, expiresAt: '2026-10-15T11:00:00Z' });
  repository.heartbeatGpsOwnershipV11.mockResolvedValue(undefined);
  repository.releaseGpsOwnershipV11.mockResolvedValue(undefined);
  repository.appendGpsRouteV11.mockImplementation(async (input: { walkId: string; distanceMeters: number; pointCount: number }) => ({
    id: 'gps-session-1', walkId: input.walkId, familyId: 'family-1', dogId: 'dog-1', distanceMeters: input.distanceMeters, pointCount: input.pointCount, source: 'device_gps', createdAt: 'x', updatedAt: 'x',
  }));
});

afterEach(async () => {
  // Leave no store interval (lease heartbeat) behind for the next test.
  useGpsStore.getState().cancelTracking(walk.id);
  jest.useRealTimers();
});

describe('Local "הפעל GPS" tracking survives the Remote GPS poller (P0 real-iPhone regression)', () => {
  it('keeps "8 מ\'" and the live route instead of resetting to "ממתין למיקום GPS ראשון…"', async () => {
    const safari = installSafariWatch();
    renderHome();
    await flush();

    const tap = tapActivateGps();
    await flush();
    expect(screen.getByTestId('gps-line').props.children).toBe('status:waiting');

    safari.deliver(fixA);
    safari.deliver(fixB);
    await act(async () => { await tap; });
    await flush();

    expect(screen.getByTestId('gps-line').props.children).toBe("8 מ'");
    expect(screen.queryByText(/ממתין למיקום GPS ראשון/)).toBeNull();
    expect(useGpsStore.getState().gpsFencingEpoch).toBe(3);

    // Three poller cycles (6 s each). Before the fix the first one stopped
    // tracking: the value vanished and the map went back to first-fix waiting.
    await advance(6_000);
    await advance(6_000);
    await advance(6_000);

    expect(screen.getByTestId('gps-line').props.children).toBe("8 מ'");
    expect(screen.queryByText(/ממתין למיקום GPS ראשון/)).toBeNull();
    expect(screen.queryByText('GPS לא פעיל במכשיר הזה')).toBeNull();
    const state = useGpsStore.getState();
    expect(state).toMatchObject({ trackingWalkId: walk.id, trackingStatus: 'active', gpsFencingEpoch: 3, pointCount: 2 });
    expect(state.routePoints).toHaveLength(2);
    // Lease kept, watch kept, no mid-walk "final" route write.
    expect(repository.releaseGpsOwnershipV11).not.toHaveBeenCalled();
    expect(safari.handle.remove).not.toHaveBeenCalled();
    expect(finalRouteWrites()).toHaveLength(0);
    expect(mockStartGpsWatch).toHaveBeenCalledTimes(1);
  });

  it('a poller tick between Safari\'s late first fix and lease acquisition does not stop tracking', async () => {
    const safari = installSafariWatch();
    let grantLease: (lease: { fencingEpoch: number; expiresAt: string }) => void = () => undefined;
    repository.acquireGpsOwnershipV11.mockImplementationOnce(() => new Promise((resolve) => { grantLease = resolve; }));
    renderHome();
    await flush();

    const tap = tapActivateGps();
    await advance(10_000); // Safari is slow to produce its first fix
    safari.deliver(fixA);
    await flush();
    // First fix in, lease request in flight; the poller fires now.
    await advance(6_000);
    await act(async () => { grantLease({ fencingEpoch: 4, expiresAt: '2026-10-15T11:00:00Z' }); await tap; });
    await flush();

    expect(useGpsStore.getState()).toMatchObject({ trackingWalkId: walk.id, gpsFencingEpoch: 4, trackingStatus: 'active', pointCount: 1 });
    expect(screen.queryByText(/ממתין למיקום GPS ראשון/)).toBeNull();
    expect(repository.releaseGpsOwnershipV11).not.toHaveBeenCalled();
    expect(safari.handle.remove).not.toHaveBeenCalled();
  });
});
