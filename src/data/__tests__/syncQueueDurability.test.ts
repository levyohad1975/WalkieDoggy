import AsyncStorage from '@react-native-async-storage/async-storage';
import { SyncQueue, setSyncQueueActorGetter } from '../syncQueue';
import type { Repository } from '../repository';
import type { FamilyUser } from '../../types';

const QUEUE_KEY = 'dog-walk-family:sync-queue:v4';
const CONFLICTS_KEY = 'dog-walk-family:sync-conflicts:v1';
const QUARANTINE_KEY = 'dog-walk-family:sync-quarantine:v1';

function user(id: string): FamilyUser {
  return { id, familyId: 'family-test', name: 'test', avatar: '🙂', color: '#000', remindersEnabled: true, gamificationEnabled: true, createdAt: '2026-01-01T00:00:00.000Z' };
}

function remote(upsertUser: jest.Mock): Repository {
  return { upsertUser } as unknown as Repository;
}

type StorageFailure = (key: string) => Error | null;
const BASE_SET_ITEM = (AsyncStorage.setItem as jest.Mock).getMockImplementation();

function interceptStorageWrites(failure: StorageFailure): void {
  if (!BASE_SET_ITEM) throw new Error('AsyncStorage test mock has no setItem implementation');
  jest.spyOn(AsyncStorage, 'setItem').mockImplementation(async (key, value) => {
    const error = failure(key);
    if (error) throw error;
    await BASE_SET_ITEM(key, value);
  });
}

describe('SyncQueue durable archive handoff', () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
    setSyncQueueActorGetter(() => 'test-user');
  });

  afterEach(() => {
    jest.restoreAllMocks();
    setSyncQueueActorGetter(() => null);
  });

  it('keeps permanent failures pending when conflict storage fails, including after restart', async () => {
    const queue = new SyncQueue();
    await queue.enqueue({ type: 'upsertUser', payload: user('a') });
    interceptStorageWrites((key) =>
      key === CONFLICTS_KEY ? new Error('simulated conflict-store failure') : null
    );

    await expect(queue.flush(remote(jest.fn().mockRejectedValue(Object.assign(new Error('constraint'), { code: '23503' }))))).rejects.toThrow('simulated conflict-store failure');

    const restarted = new SyncQueue();
    expect(await restarted.size()).toBe(1);
    expect(await restarted.getConflicts()).toHaveLength(0);
    expect(JSON.parse((await AsyncStorage.getItem(QUEUE_KEY)) ?? '[]')).toHaveLength(1);
  });

  it('keeps an archived conflict and the full original queue if pending-store removal is interrupted, including after restart', async () => {
    const queue = new SyncQueue();
    await queue.enqueue({ type: 'upsertUser', payload: user('a') });
    await queue.enqueue({ type: 'upsertUser', payload: user('b') });
    let failQueueWrite = true;
    interceptStorageWrites((key) => {
      if (key === QUEUE_KEY && failQueueWrite) {
        failQueueWrite = false;
        return new Error('simulated interruption after archive');
      }
      return null;
    });

    await expect(queue.flush(remote(jest.fn().mockRejectedValue(Object.assign(new Error('constraint'), { code: '23503' }))))).rejects.toThrow('simulated interruption after archive');

    const restarted = new SyncQueue();
    expect(await restarted.size()).toBe(2);
    expect(await restarted.getConflicts()).toHaveLength(1);
    expect(JSON.parse((await AsyncStorage.getItem(QUEUE_KEY)) ?? '[]')).toHaveLength(2);
    expect(JSON.parse((await AsyncStorage.getItem(CONFLICTS_KEY)) ?? '[]')).toHaveLength(1);
  });

  it('persists unowned quarantine before removing the pending operation and preserves neighboring operations', async () => {
    const queue = new SyncQueue();
    setSyncQueueActorGetter(() => null);
    await queue.enqueue({ type: 'upsertUser', payload: user('unknown') });
    setSyncQueueActorGetter(() => 'test-user');
    await queue.enqueue({ type: 'upsertUser', payload: user('owned') });

    interceptStorageWrites((key) =>
      key === QUARANTINE_KEY ? new Error('simulated quarantine-store failure') : null
    );
    const calls = jest.fn().mockResolvedValue(undefined);

    await expect(queue.flush(remote(calls))).rejects.toThrow('simulated quarantine-store failure');
    const restarted = new SyncQueue();
    expect(await restarted.size()).toBe(2);
    expect(await restarted.getQuarantined()).toHaveLength(0);
    expect(JSON.parse((await AsyncStorage.getItem(QUEUE_KEY)) ?? '[]')).toHaveLength(2);
    expect(calls).not.toHaveBeenCalled();
  });
});
