import { useScheduleStore } from '../scheduleStore';
import { useGpsStore } from '../gpsStore';
import { repository } from '../../data';
import { WalkLifecycleUnavailableError } from '../../data/walkLifecycleCapability';
import type { Walk } from '../../types';

/**
 * P0 real-iPhone (2026-10-15): tapping התחל טיול on Staging returned PGRST202
 * for start_walk_v11 and the walk "did not visibly start" with only a raw
 * diagnostic. With the server version gate the store must (a) leave the walk
 * exactly as it was, (b) say explicitly that the server is not updated, and
 * (c) never half-finalize the live GPS route of an active walk it cannot
 * finish. Repeated Finish taps must not race each other.
 */
jest.mock('../../data', () => ({
  repository: {
    startWalkV11: jest.fn(),
    finishWalkV11: jest.fn(),
    assertWalkLifecycleV11Available: jest.fn(),
    getConflictForWalk: jest.fn().mockResolvedValue(undefined),
    getNotificationSettings: jest.fn().mockResolvedValue([]),
  },
}));
jest.mock('../../notifications/notificationService', () => ({
  cancelWalkNotifications: jest.fn().mockResolvedValue(undefined),
  reconcileWalkNotifications: jest.fn().mockResolvedValue(undefined),
  scheduleWalkNotifications: jest.fn().mockResolvedValue(undefined),
}));

const mockedRepository = repository as unknown as {
  startWalkV11: jest.Mock;
  finishWalkV11: jest.Mock;
  assertWalkLifecycleV11Available: jest.Mock;
};

function walkFixture(overrides: Partial<Walk> = {}): Walk {
  return {
    id: 'walk-x', familyId: 'family-main', dogId: 'dog-1', date: '2000-01-01', scheduledTime: '07:00',
    responsibleUserId: 'user-a', status: 'pending',
    createdAt: '2000-01-01T00:00:00.000Z', updatedAt: '2000-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('scheduleStore — Walk Lifecycle v1.1 server gate', () => {
  let errorSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    mockedRepository.assertWalkLifecycleV11Available.mockResolvedValue(undefined);
    errorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    useGpsStore.setState({ trackingWalkId: null, gpsFencingEpoch: null, pointCount: 0 });
  });

  afterEach(() => {
    errorSpy.mockRestore();
  });

  it('start on a server without v1.1: walk stays pending and the message is explicit (no raw diagnostic)', async () => {
    useScheduleStore.setState({ walks: [walkFixture()], actionError: null });
    mockedRepository.startWalkV11.mockRejectedValue(new WalkLifecycleUnavailableError('missing_rpc', 'start_walk_v11'));

    await expect(useScheduleStore.getState().startWalk('walk-x', { startGps: false, actorUserId: 'user-a', actualWalkerUserId: 'user-a' })).resolves.toBe(false);

    const state = useScheduleStore.getState();
    expect(state.walks[0]).toMatchObject({ id: 'walk-x', status: 'pending' });
    expect(state.walks[0].startedAt).toBeUndefined();
    expect(state.actionError).toContain('WL11-SERVER');
    expect(state.actionError).not.toContain('code=');
    expect(state.startingWalkIds).toEqual([]);
  });

  it('finish on a server without v1.1: GPS route is not touched and the walk stays in progress', async () => {
    const active = walkFixture({ status: 'in_progress', actualWalkerUserId: 'user-a', startedAt: new Date().toISOString() });
    useScheduleStore.setState({ walks: [active], actionError: null });
    useGpsStore.setState({ trackingWalkId: active.id, gpsFencingEpoch: 3, pointCount: 12 });
    mockedRepository.assertWalkLifecycleV11Available.mockRejectedValue(new WalkLifecycleUnavailableError('not_installed'));
    const gps = useGpsStore.getState();
    const attach = jest.spyOn(gps, 'attachGpsOwnership');
    const stop = jest.spyOn(gps, 'stopTracking');

    await expect(useScheduleStore.getState().finishWalk(active.id, 'user-a', { actorUserId: 'user-a' })).resolves.toBe(false);

    expect(attach).not.toHaveBeenCalled();
    expect(stop).not.toHaveBeenCalled();
    expect(mockedRepository.finishWalkV11).not.toHaveBeenCalled();
    expect(useGpsStore.getState()).toMatchObject({ trackingWalkId: active.id, gpsFencingEpoch: 3, pointCount: 12 });
    expect(useScheduleStore.getState().walks[0].status).toBe('in_progress');
    expect(useScheduleStore.getState().actionError).toContain('WL11-SERVER');
    attach.mockRestore();
    stop.mockRestore();
  });

  it('repeated Finish taps while one is in flight join it: one finish_walk_v11 call', async () => {
    const active = walkFixture({ status: 'in_progress', actualWalkerUserId: 'user-a', startedAt: new Date().toISOString() });
    useScheduleStore.setState({ walks: [active], actionError: null });
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    mockedRepository.finishWalkV11.mockImplementation(async () => {
      await gate;
      return { ...active, status: 'done', completedByUserId: 'user-a', endedByUserId: 'user-a' };
    });

    const first = useScheduleStore.getState().finishWalk(active.id, 'user-a', { actorUserId: 'user-a' });
    const second = useScheduleStore.getState().finishWalk(active.id, 'user-a', { actorUserId: 'user-a' });
    expect(second).toBe(first);
    release();
    await expect(Promise.all([first, second])).resolves.toEqual([true, true]);
    expect(mockedRepository.finishWalkV11).toHaveBeenCalledTimes(1);
    expect(useScheduleStore.getState().walks[0].status).toBe('done');

    // A later, separate finish attempt is not blocked by the settled one.
    mockedRepository.finishWalkV11.mockClear();
    useScheduleStore.setState({ walks: [active] });
    mockedRepository.finishWalkV11.mockResolvedValue({ ...active, status: 'done' });
    await useScheduleStore.getState().finishWalk(active.id, 'user-a', { actorUserId: 'user-a' });
    expect(mockedRepository.finishWalkV11).toHaveBeenCalledTimes(1);
  });
});
