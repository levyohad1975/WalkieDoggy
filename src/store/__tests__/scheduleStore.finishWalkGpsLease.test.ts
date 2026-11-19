import { useScheduleStore } from '../scheduleStore';
import { useGpsStore } from '../gpsStore';
import { repository } from '../../data';
import type { Walk } from '../../types';

/**
 * v1.1 review regression. With GPS fencing enabled, finishWalk finalizes the
 * route before calling finish_walk_v11. A lease lost while the phone was
 * locked (or after a dropped heartbeat) made stopTracking throw, and the walk
 * could then never be finished from the walker's own device — including
 * offline, where the lifecycle outbox was built to accept the finish. GPS is
 * assistive: the lease is renewed on the same device when possible, and a
 * failed final route write never blocks finishing the walk.
 */
jest.mock('../../data', () => ({
  repository: {
    finishWalkV11: jest.fn(),
    getNotificationSettings: jest.fn().mockResolvedValue([]),
  },
}));
jest.mock('../../notifications/notificationService', () => ({
  cancelWalkNotifications: jest.fn().mockResolvedValue(undefined),
  reconcileWalkNotifications: jest.fn().mockResolvedValue(undefined),
  scheduleWalkNotifications: jest.fn().mockResolvedValue(undefined),
}));

const mockedRepository = repository as unknown as { finishWalkV11: jest.Mock };

function activeWalk(): Walk {
  return {
    id: 'walk-x', familyId: 'family-main', dogId: 'dog-1', date: '2000-01-01', scheduledTime: '07:00',
    responsibleUserId: 'user-a', actualWalkerUserId: 'user-a', status: 'in_progress',
    startedAt: new Date().toISOString(), createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
  };
}

describe('scheduleStore.finishWalk with v1.1 GPS fencing', () => {
  let errorSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    errorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    useScheduleStore.setState({ walks: [activeWalk()], actionError: null });
  });

  afterEach(() => {
    errorSpy.mockRestore();
  });

  it('renews a lapsed same-device lease, then saves the final route before finishing', async () => {
    const walk = activeWalk();
    mockedRepository.finishWalkV11.mockResolvedValue({ ...walk, status: 'done' });
    useGpsStore.setState({ trackingWalkId: walk.id, gpsFencingEpoch: null, pointCount: 3 });
    const gps = useGpsStore.getState();
    const order: string[] = [];
    const attach = jest.spyOn(gps, 'attachGpsOwnership').mockImplementation(async () => { order.push('attach'); return true; });
    const stop = jest.spyOn(gps, 'stopTracking').mockImplementation(async () => { order.push('stop'); return null; });
    mockedRepository.finishWalkV11.mockImplementation(async () => { order.push('finish'); return { ...walk, status: 'done' }; });

    await expect(useScheduleStore.getState().finishWalk(walk.id, 'user-a', { actorUserId: 'user-a' })).resolves.toBe(true);

    expect(attach).toHaveBeenCalledWith(expect.objectContaining({ id: walk.id, status: 'in_progress' }));
    expect(order).toEqual(['attach', 'stop', 'finish']);
    expect(useScheduleStore.getState().actionError).toBeNull();
    attach.mockRestore();
    stop.mockRestore();
  });

  it('still finishes the walk when the lease cannot be renewed and the final route write fails', async () => {
    const walk = activeWalk();
    mockedRepository.finishWalkV11.mockResolvedValue({ ...walk, status: 'done' });
    useGpsStore.setState({ trackingWalkId: walk.id, gpsFencingEpoch: null, pointCount: 3 });
    const gps = useGpsStore.getState();
    const attach = jest.spyOn(gps, 'attachGpsOwnership').mockResolvedValue(false);
    const stop = jest.spyOn(gps, 'stopTracking').mockRejectedValue(new Error('GPS route was not saved because this device no longer owns GPS for the walk'));

    await expect(useScheduleStore.getState().finishWalk(walk.id, 'user-a', { actorUserId: 'user-a' })).resolves.toBe(true);

    expect(mockedRepository.finishWalkV11).toHaveBeenCalledWith(walk.id, 'user-a', expect.any(String), expect.objectContaining({ actorUserId: 'user-a' }));
    expect(useScheduleStore.getState().walks[0].status).toBe('done');
    expect(useScheduleStore.getState().actionError).toMatch(/GPS/);
    // stopTracking is not retried after the walk is done; the route attempt happened once, before finish.
    expect(stop).toHaveBeenCalledTimes(1);
    attach.mockRestore();
    stop.mockRestore();
  });

  it('does not touch a valid lease before the final route write', async () => {
    const walk = activeWalk();
    mockedRepository.finishWalkV11.mockResolvedValue({ ...walk, status: 'done' });
    useGpsStore.setState({ trackingWalkId: walk.id, gpsFencingEpoch: 5, pointCount: 3 });
    const gps = useGpsStore.getState();
    const attach = jest.spyOn(gps, 'attachGpsOwnership').mockResolvedValue(true);
    const stop = jest.spyOn(gps, 'stopTracking').mockResolvedValue(null);

    await expect(useScheduleStore.getState().finishWalk(walk.id, 'user-a', { actorUserId: 'user-a' })).resolves.toBe(true);

    expect(attach).not.toHaveBeenCalled();
    expect(stop).toHaveBeenCalledTimes(1);
    attach.mockRestore();
    stop.mockRestore();
  });
});
