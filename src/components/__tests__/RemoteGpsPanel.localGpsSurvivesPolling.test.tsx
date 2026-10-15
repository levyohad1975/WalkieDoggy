import React from 'react';
import { AppState, Text } from 'react-native';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import type { Walk } from '../../types';
import { accumulateDistance, createGpsAccumulator, formatDistanceMeters, type GpsAccumulator, type GpsPoint } from '../../logic/gpsDistance';
import type { GpsTrackingStatus, GpsWatchStartResult } from '../../lib/gpsTracking';
import { RemoteGpsPanel } from '../RemoteGpsPanel';
import { RoutePreview } from '../RoutePreview';
import { useGpsStore } from '../../store/gpsStore';
import { __resetGpsLifecycleLogForTests, getGpsLifecycleLog } from '../../lib/gpsLifecycleLog';

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
  getRemoteGpsCommandOutcome: jest.fn(),
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
  useGpsStore.setState({ trackingWalkId: null, permissionStatus: null, trackingStatus: null, trackingStartedAt: null, distanceMeters: 0, pointCount: 0, routePoints: [], gpsFencingEpoch: null, trackingSource: null, remoteGpsCommandId: null, lastGpsStop: null, sessionsByWalkId: {} });
  __resetGpsLifecycleLogForTests();
  // A family with Remote GPS enabled and this walker's consent on: the
  // poller is live on Home, exactly as on the tester's Staging family.
  remoteGps.getRemoteGpsSettings.mockResolvedValue({ familyEnabled: true, consentEnabled: true, isAdmin: false });
  remoteGps.getMyRemoteGpsCommands.mockResolvedValue([]);
  remoteGps.getRemoteGpsWalkStatus.mockResolvedValue([]);
  remoteGps.heartbeatRemoteGpsTracking.mockResolvedValue(undefined);
  remoteGps.stopRemoteGpsTracking.mockResolvedValue(undefined);
  remoteGps.acknowledgeRemoteGpsStart.mockResolvedValue(undefined);
  remoteGps.getRemoteGpsCommandOutcome.mockResolvedValue(null);
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

describe('Remote GPS sessions keep their own lifecycle', () => {
  const trackingCommand = { command_id: 'cmd-1', walk_id: walk.id, status: 'tracking', expires_at: '2026-10-15T12:00:00Z' };

  async function startRemoteSession(commandId = 'cmd-1') {
    const safari = installSafariWatch();
    renderHome();
    await flush();
    const tap = tapActivateGps();
    safari.deliver(fixA);
    safari.deliver(fixB);
    await act(async () => { await tap; });
    expect(useGpsStore.getState().markRemoteTracking(walk.id, commandId)).toBe(true);
    remoteGps.getMyRemoteGpsCommands.mockResolvedValue([{ ...trackingCommand, command_id: commandId }]);
    await advance(6_000);
    expect(remoteGps.heartbeatRemoteGpsTracking).toHaveBeenCalledWith(commandId);
    expect(useGpsStore.getState().trackingWalkId).toBe(walk.id);
    return safari;
  }

  it.each([
    [{ status: 'failed', failure_reason: 'consent_revoked' }, 'failed/consent_revoked'],
    [{ status: 'failed', failure_reason: 'family_disabled' }, 'failed/family_disabled'],
    [{ status: 'stopped', failure_reason: null }, 'stopped'],
  ])('ends a remote session on an authorized termination (%j), saving the route with a reason', async (outcome, described) => {
    const safari = await startRemoteSession();
    remoteGps.getRemoteGpsCommandOutcome.mockResolvedValue(outcome);
    remoteGps.getMyRemoteGpsCommands.mockResolvedValue([]);
    await advance(6_000);

    expect(remoteGps.getRemoteGpsCommandOutcome).toHaveBeenCalledWith('cmd-1');
    expect(useGpsStore.getState()).toMatchObject({ trackingWalkId: null, trackingSource: null, remoteGpsCommandId: null });
    expect(useGpsStore.getState().lastGpsStop).toMatchObject({ walkId: walk.id, kind: 'stop', reason: `remote_command_terminated:${described}` });
    expect(finalRouteWrites()).toHaveLength(1);
    expect(repository.releaseGpsOwnershipV11).toHaveBeenCalledWith(walk.id, 3);
    expect(safari.handle.remove).toHaveBeenCalled();
  });

  it.each([
    ['target_inactive housekeeping', { status: 'failed', failure_reason: 'target_inactive' }],
    ['expiry', { status: 'expired', failure_reason: 'expired' }],
    ['an unreadable command', null],
  ])('keeps a remote session running as local after %s', async (_label, outcome) => {
    const safari = await startRemoteSession();
    remoteGps.getRemoteGpsCommandOutcome.mockResolvedValue(outcome);
    remoteGps.getMyRemoteGpsCommands.mockResolvedValue([]);
    await advance(6_000);
    await advance(6_000);

    expect(useGpsStore.getState()).toMatchObject({ trackingWalkId: walk.id, trackingSource: 'local', remoteGpsCommandId: null, lastGpsStop: null });
    expect(finalRouteWrites()).toHaveLength(0);
    expect(repository.releaseGpsOwnershipV11).not.toHaveBeenCalled();
    expect(safari.handle.remove).not.toHaveBeenCalled();
    expect(getGpsLifecycleLog().some((e) => e.event === 'remote_detached')).toBe(true);
  });

  it('keeps the session when the command outcome lookup itself fails', async () => {
    await startRemoteSession();
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    remoteGps.getRemoteGpsCommandOutcome.mockRejectedValue(new Error('network down'));
    remoteGps.getMyRemoteGpsCommands.mockResolvedValue([]);
    await advance(6_000);
    expect(useGpsStore.getState()).toMatchObject({ trackingWalkId: walk.id, trackingSource: 'local' });
    expect(finalRouteWrites()).toHaveLength(0);
    warn.mockRestore();
  });

  it('only the tracked walk can be marked remote, and the mark is cleared with the session', async () => {
    const safari = installSafariWatch();
    const tap = tapActivateGps();
    safari.deliver(fixA);
    await act(async () => { await tap; });
    expect(useGpsStore.getState().trackingSource).toBe('local');
    expect(useGpsStore.getState().markRemoteTracking('some-other-walk')).toBe(false);
    expect(useGpsStore.getState().trackingSource).toBe('local');
    expect(useGpsStore.getState().markRemoteTracking(walk.id, 'cmd-9')).toBe(true);
    expect(useGpsStore.getState().remoteGpsCommandId).toBe('cmd-9');
    useGpsStore.getState().cancelTracking(walk.id, 'test_cleanup');
    expect(useGpsStore.getState()).toMatchObject({ trackingWalkId: null, trackingSource: null, remoteGpsCommandId: null });
    expect(useGpsStore.getState().lastGpsStop).toMatchObject({ walkId: walk.id, kind: 'cancel', reason: 'test_cleanup' });
  });

  it('a poller tick during an in-flight remote activation does not cancel it; the session becomes remote only after acknowledgement', async () => {
    const safari = installSafariWatch();
    let commands: unknown[] = [{ ...trackingCommand, status: 'pending' }];
    remoteGps.getMyRemoteGpsCommands.mockImplementation(async () => commands);
    render(<RemoteGpsPanel walk={walk} currentUserId={WALKER} familyRole="admin" ready mode="home" />);
    await flush();

    fireEvent.press(screen.getByText('אישור והפעלת GPS במכשיר הזה'));
    await flush();
    expect(useGpsStore.getState()).toMatchObject({ trackingWalkId: walk.id, trackingSource: 'local' });

    await advance(6_000); // poller sees only the still-pending command
    expect(useGpsStore.getState().trackingWalkId).toBe(walk.id);

    safari.deliver(fixA);
    safari.deliver(fixB);
    await flush(20);
    expect(remoteGps.acknowledgeRemoteGpsStart).toHaveBeenCalledWith('cmd-1', true, undefined);
    expect(useGpsStore.getState()).toMatchObject({ trackingWalkId: walk.id, trackingSource: 'remote', gpsFencingEpoch: 3 });

    commands = [trackingCommand];
    await advance(6_000);
    expect(useGpsStore.getState().trackingWalkId).toBe(walk.id);
    expect(repository.releaseGpsOwnershipV11).not.toHaveBeenCalled();
  });
});

describe('Local session robustness on the same screen', () => {
  it('a second "הפעל GPS" tap during Safari startup creates no second watch and no second lease request', async () => {
    const safari = installSafariWatch();
    renderHome();
    await flush();
    const first = tapActivateGps();
    const second = tapActivateGps();
    await flush();
    safari.deliver(fixA);
    await act(async () => { await Promise.all([first, second]); });
    await flush();

    expect(mockStartGpsWatch).toHaveBeenCalledTimes(1);
    expect(repository.acquireGpsOwnershipV11).toHaveBeenCalledTimes(1);
    expect(useGpsStore.getState()).toMatchObject({ trackingWalkId: walk.id, gpsFencingEpoch: 3, trackingSource: 'local' });
  });

  it('a temporary signal loss keeps the captured route and recovers on the next fix across poller ticks', async () => {
    const safari = installSafariWatch();
    renderHome();
    await flush();
    const tap = tapActivateGps();
    safari.deliver(fixA);
    safari.deliver(fixB);
    await act(async () => { await tap; });

    safari.signalLoss();
    await advance(6_000);
    expect(useGpsStore.getState()).toMatchObject({ trackingWalkId: walk.id, trackingStatus: 'interrupted', pointCount: 2 });
    expect(useGpsStore.getState().routePoints).toHaveLength(2);
    expect(screen.queryByText(/ממתין למיקום GPS ראשון/)).toBeNull();

    safari.deliver({ ...fixB, latitude: fixB.latitude + 10 / METERS_PER_DEGREE_LAT, timestamp: fixB.timestamp + 5_000 });
    await advance(6_000);
    expect(useGpsStore.getState()).toMatchObject({ trackingWalkId: walk.id, trackingStatus: 'active', pointCount: 3 });
    expect(Math.round(useGpsStore.getState().distanceMeters)).toBe(18);
    expect(repository.releaseGpsOwnershipV11).not.toHaveBeenCalled();
  });
});

/**
 * P0 #2 (real iPhone, 2026-10-15 16:02 IDT, Preview e717b60). Staging row:
 * walk_gps_sessions started_at 13:02:35.9, created_at 13:02:37.8, ended_at
 * 13:03:10.1 (≈34 s), point_count 5, distance 0 — while the walk stayed
 * in_progress and the card fell back to "GPS לא פעיל במכשיר הזה".
 *
 * Only a client stopTracking() writes walk_gps_sessions.ended_at
 * (append_walk_gps_route_v11 p_ended_at). After e717b60 the only automatic
 * caller is the Remote GPS poller for a session started by a remote command.
 * Its trigger is the admin-side status check (get_remote_gps_walk_status,
 * refreshed every 6 s on an admin's Home) that fails a 'tracking' command as
 * 'target_inactive' once acknowledged_at is >30 s old: 30 s + one 6 s poll
 * after the acknowledgement at ≈13:02:38 is ≈13:03:10.
 */
describe('A remote-acknowledged session on the walker\'s own device survives a housekeeping command end (P0 #2)', () => {
  const pendingCommand = { command_id: 'cmd-34s', walk_id: walk.id, status: 'pending', expires_at: '2026-10-15T13:04:05Z' };
  const trackingCommand = { ...pendingCommand, status: 'tracking' };

  it('GPS starts → 5 points persist → ~34 s → command lapses as target_inactive → session is NOT ended and the walk keeps live GPS', async () => {
    const safari = installSafariWatch();
    let commands: unknown[] = [pendingCommand];
    remoteGps.getMyRemoteGpsCommands.mockImplementation(async () => commands);
    remoteGps.getRemoteGpsCommandOutcome.mockResolvedValue({ status: 'failed', failure_reason: 'target_inactive' });
    // Admin and walker are the same person on the same iPhone.
    render(
      <>
        <LiveWalkGpsProbe walkId={walk.id} />
        <RemoteGpsPanel walk={walk} currentUserId={WALKER} familyRole="admin" ready mode="home" />
      </>
    );
    await flush();

    fireEvent.press(screen.getByText('אישור והפעלת GPS במכשיר הזה'));
    await flush();
    // Five stationary fixes: point_count 5, distance 0, as on Staging.
    for (let i = 0; i < 5; i += 1) safari.deliver({ ...fixA, timestamp: fixA.timestamp + i * 1_000 });
    await flush(20);
    expect(remoteGps.acknowledgeRemoteGpsStart).toHaveBeenCalledWith('cmd-34s', true, undefined);
    expect(useGpsStore.getState()).toMatchObject({ trackingWalkId: walk.id, pointCount: 5, distanceMeters: 0, gpsFencingEpoch: 3 });
    expect(repository.appendGpsRouteV11).toHaveBeenCalled();
    commands = [trackingCommand];
    await advance(6_000);
    await advance(6_000);
    await advance(6_000);
    await advance(6_000);
    await advance(6_000);
    expect(useGpsStore.getState().trackingWalkId).toBe(walk.id);

    // ≈34 s: the server no longer lists the command as tracking.
    commands = [];
    await advance(6_000);
    await advance(6_000);

    const state = useGpsStore.getState();
    expect(state).toMatchObject({ trackingWalkId: walk.id, pointCount: 5, gpsFencingEpoch: 3 });
    expect(finalRouteWrites()).toHaveLength(0);
    expect(repository.releaseGpsOwnershipV11).not.toHaveBeenCalled();
    expect(safari.handle.remove).not.toHaveBeenCalled();
    expect(screen.getByTestId('gps-line').props.children).not.toBe('GPS לא פעיל במכשיר הזה');
    expect(screen.queryByText(/ממתין למיקום GPS ראשון/)).toBeNull();

    // Tracking really continues: the next fix is accepted and persisted.
    const appendsBefore = repository.appendGpsRouteV11.mock.calls.length;
    safari.deliver({ ...fixB, timestamp: fixA.timestamp + 40_000 });
    await flush();
    expect(useGpsStore.getState()).toMatchObject({ trackingWalkId: walk.id, pointCount: 6, trackingStatus: 'active' });
    expect(repository.appendGpsRouteV11.mock.calls.length).toBeGreaterThan(appendsBefore);
  });
});

describe('Legitimate GPS session endings still work and are reason-coded', () => {
  it('the walker\'s explicit "עצירת מעקב GPS" ends the remote session with a reason and stops the command', async () => {
    const safari = installSafariWatch();
    let commands: unknown[] = [{ command_id: 'cmd-u', walk_id: walk.id, status: 'pending', expires_at: '2026-10-15T13:04:05Z' }];
    remoteGps.getMyRemoteGpsCommands.mockImplementation(async () => commands);
    render(<RemoteGpsPanel walk={walk} currentUserId={WALKER} familyRole="admin" ready mode="home" />);
    await flush();
    fireEvent.press(screen.getByText('אישור והפעלת GPS במכשיר הזה'));
    await flush();
    safari.deliver(fixA);
    await flush(20);
    commands = [{ command_id: 'cmd-u', walk_id: walk.id, status: 'tracking', expires_at: '2026-10-15T13:04:05Z' }];
    await flush();

    fireEvent.press(screen.getByText('עצירת מעקב GPS'));
    await flush(20);
    expect(useGpsStore.getState().trackingWalkId).toBeNull();
    expect(useGpsStore.getState().lastGpsStop).toMatchObject({ kind: 'stop', reason: 'remote_gps_stopped_by_user' });
    expect(remoteGps.stopRemoteGpsTracking).toHaveBeenCalledWith('cmd-u');
    expect(finalRouteWrites()).toHaveLength(1);
  });

  it('finishing the walk ends the session with walk_finished', async () => {
    const safari = installSafariWatch();
    const tap = tapActivateGps();
    safari.deliver(fixA);
    safari.deliver(fixB);
    await act(async () => { await tap; });
    await act(async () => { await useGpsStore.getState().stopTracking(walk, WALKER, 'walk_finished'); });
    expect(useGpsStore.getState().lastGpsStop).toMatchObject({ walkId: walk.id, kind: 'stop', reason: 'walk_finished' });
    expect(finalRouteWrites()).toHaveLength(1);
    expect(repository.releaseGpsOwnershipV11).toHaveBeenCalledWith(walk.id, 3);
  });

  it('a legitimately revoked lease (another device took over) interrupts without ending the session or dropping the route', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    const safari = installSafariWatch();
    renderHome();
    await flush();
    const tap = tapActivateGps();
    safari.deliver(fixA);
    safari.deliver(fixB);
    await act(async () => { await tap; });
    repository.heartbeatGpsOwnershipV11.mockRejectedValue(new Error('GPS ownership expired or transferred'));
    repository.acquireGpsOwnershipV11.mockRejectedValue(new Error('current GPS owner must release tracking or its lease must expire before transfer'));
    await advance(15_000);
    await flush(20);

    expect(useGpsStore.getState()).toMatchObject({ trackingWalkId: walk.id, trackingStatus: 'interrupted', gpsFencingEpoch: null, pointCount: 2 });
    expect(useGpsStore.getState().routePoints).toHaveLength(2);
    expect(finalRouteWrites()).toHaveLength(0);
    expect(useGpsStore.getState().lastGpsStop).toBeNull();
    expect(getGpsLifecycleLog().filter((e) => e.event === 'lease_lost').map((e) => e.reason)).toEqual(expect.arrayContaining(['heartbeat_rejected', 'acquire_rejected']));
    warn.mockRestore();
  });

  it('the lifecycle log is reason-coded and never holds location values', async () => {
    const safari = installSafariWatch();
    const tap = tapActivateGps();
    safari.deliver(fixA);
    safari.deliver(fixB);
    await act(async () => { await tap; });
    await act(async () => { await useGpsStore.getState().stopTracking(walk, WALKER, 'walk_finished'); });

    const log = getGpsLifecycleLog();
    expect(log.map((e) => e.event)).toEqual(expect.arrayContaining(['start', 'first_fix', 'lease_acquired', 'stop', 'lease_released']));
    expect(log.find((e) => e.event === 'stop')?.reason).toBe('walk_finished');
    const serialized = JSON.stringify(log);
    expect(serialized).not.toMatch(/latitude|longitude|accuracy/);
    expect(serialized).not.toContain(String(fixA.latitude));
    expect(serialized).not.toContain(String(fixA.longitude));
  });
});

/**
 * P0 real-iPhone report (2026-10-15, 17:32): אבי started and was actively
 * walking his own spontaneous walk on his own iPhone, and was ALSO a family
 * admin — the panel offered him "📍 בקש אישור GPS ממכשיר המטייל/ת" (request
 * remote GPS consent from the walker's device), nonsensical when that
 * device is this one. Identity must come from the lifecycle actor field
 * (actualWalkerUserId, falling back to responsibleUserId), never a
 * display-name match or familyRole alone.
 */
describe('An admin who is ALSO the actual walker on this device is never treated as a remote observer', () => {
  it('does not offer to request remote GPS from the walker\'s device when the admin IS that walker', async () => {
    render(<RemoteGpsPanel walk={walk} currentUserId={WALKER} familyRole="admin" ready mode="home" />);
    await flush();
    expect(screen.queryByText('📍 בקש אישור GPS ממכשיר המטייל/ת')).toBeNull();
  });

  it('still offers a genuinely different admin the remote-request action for this same walk', async () => {
    const otherAdmin = 'user-other-admin';
    render(<RemoteGpsPanel walk={walk} currentUserId={otherAdmin} familyRole="admin" ready mode="home" />);
    await flush();
    expect(screen.getByText('📍 בקש אישור GPS ממכשיר המטייל/ת')).toBeTruthy();
  });
});
