import type { Repository } from '../repository';
import type { Walk } from '../../types';

/**
 * v1.1 review regression — offline start + offline finish when the server's
 * canonical walk row for the occurrence has a DIFFERENT id than the local one.
 *
 * `walks.schedule_entry_id` is unique, so two devices (or a repair that ran
 * twice) can leave the walker's phone showing a local id that never became
 * the server row. Online, startWalkV11 reconciles that through
 * resolveCanonicalWalkId. Offline, both the start and the finish are queued
 * in the lifecycle outbox under the LOCAL id. On reconnect the start replay
 * adopted the canonical id (and deleted the local orphan), but the finish
 * intent queued behind it still carried the orphan id: finish_walk_v11 then
 * answered "walk not found", the intent was parked as a permanent conflict,
 * the local copy that could have shown it had just been deleted, and the walk
 * stayed in progress on the server although the walker had finished it.
 */
function stubRemote(overrides: Partial<Repository> = {}): Repository {
  return {
    getWalks: jest.fn().mockResolvedValue([]),
    saveWalk: jest.fn().mockResolvedValue(undefined),
    startWalkV11: jest.fn(),
    finishWalkV11: jest.fn(),
    ...overrides,
  } as unknown as Repository;
}

function walkFixture(overrides: Partial<Walk> = {}): Walk {
  return {
    id: 'walk-orphan',
    familyId: 'family-1',
    scheduleEntryId: 'entry-1',
    dogId: 'dog-1',
    date: '2026-10-13',
    scheduledTime: '08:00',
    responsibleUserId: 'user-1',
    status: 'pending',
    createdAt: '2026-10-13T05:00:00.000Z',
    updatedAt: '2026-10-13T05:00:00.000Z',
    ...overrides,
  };
}

describe('OfflineFirstRepository lifecycle outbox — canonical walk id reconciliation', () => {
  let netinfoFetch: jest.Mock;

  beforeEach(async () => {
    jest.resetModules();
    netinfoFetch = jest.fn().mockResolvedValue({ isConnected: false, isInternetReachable: false });
    jest.doMock('@react-native-community/netinfo', () => ({ __esModule: true, default: { fetch: netinfoFetch } }));
    const AsyncStorage = require('@react-native-async-storage/async-storage');
    await AsyncStorage.clear();
    require('../syncQueue').setSyncQueueActorGetter(() => 'user-1');
  });

  afterEach(() => {
    require('../syncQueue').setSyncQueueActorGetter(() => null);
  });

  it('replays an offline finish against the canonical id adopted by the offline start', async () => {
    const { LocalRepository } = require('../localRepository');
    const { OfflineFirstRepository } = require('../offlineFirstRepository');
    const { listWalkLifecycleIntents } = require('../walkLifecycleOperationIds');

    const local = new LocalRepository();
    await local.saveWalk(walkFixture({ id: 'walk-orphan' }));

    const canonical = walkFixture({ id: 'walk-canonical' });
    const started = { ...canonical, status: 'in_progress' as const, startedAt: '2026-10-13T06:00:00.000Z', actualWalkerUserId: 'user-1' };
    const finished = { ...started, status: 'done' as const, completedAt: '2026-10-13T06:30:00.000Z', completedByUserId: 'user-1', endedByUserId: 'user-1' };
    const startWalkV11 = jest.fn().mockResolvedValue(started);
    const finishWalkV11 = jest.fn().mockImplementation(async (walkId: string) => {
      if (walkId !== 'walk-canonical') throw new Error('walk not found');
      return finished;
    });
    const remote = stubRemote({ getWalks: jest.fn().mockResolvedValue([canonical]), startWalkV11, finishWalkV11 });
    const repo = new OfflineFirstRepository(remote);

    // Offline: both lifecycle actions are accepted into the outbox under the local id.
    await repo.startWalkV11!('walk-orphan', { actorUserId: 'user-1', actualWalkerUserId: 'user-1', operationId: 'op-start' });
    await repo.finishWalkV11!('walk-orphan', 'user-1', 'op-finish', { actorUserId: 'user-1', hadPee: true });
    expect(startWalkV11).not.toHaveBeenCalled();
    expect(await listWalkLifecycleIntents()).toHaveLength(2);

    // Reconnect.
    netinfoFetch.mockResolvedValue({ isConnected: true, isInternetReachable: true });
    await repo.trySync({ force: true });

    expect(startWalkV11).toHaveBeenCalledWith('walk-canonical', expect.objectContaining({ operationId: 'op-start' }));
    expect(finishWalkV11).toHaveBeenCalledTimes(1);
    expect(finishWalkV11).toHaveBeenCalledWith('walk-canonical', 'user-1', 'op-finish', expect.objectContaining({ actorUserId: 'user-1', hadPee: true }));
    // Nothing is parked as a conflict, and the outbox is fully drained.
    expect(await listWalkLifecycleIntents()).toEqual([]);
    // The device keeps exactly one copy of the occurrence: the finished canonical walk.
    // Read through a fresh instance: the repository under test owns its own LocalRepository.
    const afterSync = new LocalRepository();
    expect(await afterSync.findWalkById('walk-orphan')).toBeUndefined();
    expect(await afterSync.findWalkById('walk-canonical')).toMatchObject({ status: 'done', completedByUserId: 'user-1' });
  });

  it('keeps using the original id when the server row already has the same id', async () => {
    const { LocalRepository } = require('../localRepository');
    const { OfflineFirstRepository } = require('../offlineFirstRepository');
    const { listWalkLifecycleIntents } = require('../walkLifecycleOperationIds');

    const local = new LocalRepository();
    const same = walkFixture({ id: 'walk-same' });
    await local.saveWalk(same);
    const started = { ...same, status: 'in_progress' as const, startedAt: '2026-10-13T06:00:00.000Z', actualWalkerUserId: 'user-1' };
    const finished = { ...started, status: 'done' as const, completedAt: '2026-10-13T06:30:00.000Z', completedByUserId: 'user-1', endedByUserId: 'user-1' };
    const startWalkV11 = jest.fn().mockResolvedValue(started);
    const finishWalkV11 = jest.fn().mockResolvedValue(finished);
    const repo = new OfflineFirstRepository(stubRemote({ getWalks: jest.fn().mockResolvedValue([same]), startWalkV11, finishWalkV11 }));

    await repo.startWalkV11!('walk-same', { actorUserId: 'user-1', actualWalkerUserId: 'user-1', operationId: 'op-start' });
    await repo.finishWalkV11!('walk-same', 'user-1', 'op-finish', { actorUserId: 'user-1' });
    netinfoFetch.mockResolvedValue({ isConnected: true, isInternetReachable: true });
    await repo.trySync({ force: true });

    expect(startWalkV11).toHaveBeenCalledWith('walk-same', expect.anything());
    expect(finishWalkV11).toHaveBeenCalledWith('walk-same', 'user-1', 'op-finish', expect.anything());
    expect(await listWalkLifecycleIntents()).toEqual([]);
  });
});
