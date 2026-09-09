import AsyncStorage from '@react-native-async-storage/async-storage';
import NetInfo from '@react-native-community/netinfo';
import { OfflineFirstRepository } from '../offlineFirstRepository';
import { LocalRepository } from '../localRepository';
import { SyncQueue, setSyncQueueActorGetter } from '../syncQueue';
import type { Repository } from '../repository';
import type { FamilyUser } from '../../types';

jest.mock('@react-native-community/netinfo', () => ({
  __esModule: true, default: { fetch: jest.fn() },
}));

const user: FamilyUser = {
  id: 'first-profile', familyId: 'new-family', name: 'First', avatar: 'dog',
  color: '#000', remindersEnabled: true, createdAt: '2026-09-09T00:00:00.000Z',
};
const online = () => (NetInfo.fetch as jest.Mock).mockResolvedValue({
  isConnected: true, isInternetReachable: true,
});

describe('first-profile creation and queue ownership', () => {
  let remote: Repository;
  let repo: OfflineFirstRepository;
  let local: LocalRepository;

  beforeEach(async () => {
    await AsyncStorage.clear();
    setSyncQueueActorGetter(() => null);
    online();
    remote = { createUser: jest.fn().mockResolvedValue(undefined), upsertUser: jest.fn() } as unknown as Repository;
    repo = new OfflineFirstRepository(remote);
    local = new LocalRepository();
  });

  afterEach(() => {
    setSyncQueueActorGetter(() => null);
    jest.restoreAllMocks();
  });

  it('finishes the remote INSERT before saving locally and allowing the subsequent claim', async () => {
    const enqueue = jest.spyOn(SyncQueue.prototype, 'enqueue');
    let finishInsert!: () => void;
    let insertStarted!: () => void;
    const started = new Promise<void>((resolve) => { insertStarted = resolve; });
    const inserted = new Set<string>();
    (remote.createUser as jest.Mock).mockImplementation(() => new Promise<void>((resolve) => {
      finishInsert = () => { inserted.add(user.id); resolve(); };
      insertStarted();
    }));
    // LoginScreen awaits addUser/createUser before calling signIn/claim.
    const claim = jest.fn(async () => {
      if (!inserted.has(user.id)) throw new Error('user not found');
    });
    const creationAndClaim = repo.createUser(user).then(claim);
    await started;
    expect(await local.getUsers(user.familyId)).toEqual([]);
    expect(claim).not.toHaveBeenCalled();
    finishInsert();
    await creationAndClaim;
    expect(claim).toHaveBeenCalledTimes(1);
    expect(remote.createUser).toHaveBeenCalledWith(user);
    // Each LocalRepository caches its own snapshot; read persisted state afresh.
    expect(await new LocalRepository().getUsers(user.familyId)).toEqual([user]);
    expect(enqueue).not.toHaveBeenCalled();
    expect(await repo.pendingSyncCount()).toBe(0);
    expect(await new SyncQueue().getQuarantined()).toEqual([]);
  });

  it('propagates server rejection without saving or queueing an unclaimed profile', async () => {
    const enqueue = jest.spyOn(SyncQueue.prototype, 'enqueue');
    const denied = Object.assign(new Error('RLS denied'), { code: '42501' });
    (remote.createUser as jest.Mock).mockRejectedValue(denied);
    await expect(repo.createUser(user)).rejects.toBe(denied);
    expect(await local.getUsers(user.familyId)).toEqual([]);
    expect(enqueue).not.toHaveBeenCalled();
  });

  it.each(['disconnected', 'unreachable', 'fetch failure'])('rejects bootstrap when %s without local mutation', async (state) => {
    if (state === 'fetch failure') (NetInfo.fetch as jest.Mock).mockRejectedValue(new Error('offline'));
    else (NetInfo.fetch as jest.Mock).mockResolvedValue({ isConnected: state !== 'disconnected', isInternetReachable: false });
    const enqueue = jest.spyOn(SyncQueue.prototype, 'enqueue');
    await expect(repo.createUser(user)).rejects.toThrow('requires an internet connection');
    expect(remote.createUser).not.toHaveBeenCalled();
    expect(await local.getUsers(user.familyId)).toEqual([]);
    expect(enqueue).not.toHaveBeenCalled();
  });

  it('keeps claimed-user creates local-first and tagged for later sync', async () => {
    setSyncQueueActorGetter(() => 'admin');
    (NetInfo.fetch as jest.Mock).mockResolvedValue({ isConnected: false });
    await repo.createUser(user);
    expect(await local.getUsers(user.familyId)).toEqual([user]);
    expect(remote.createUser).not.toHaveBeenCalled();
    expect(JSON.parse((await AsyncStorage.getItem('dog-walk-family:sync-queue:v4'))!)).toEqual([
      { op: { type: 'createUser', payload: user }, claimedByUserId: 'admin' },
    ]);
    online();
    await repo.trySync();
    expect(remote.createUser).toHaveBeenCalledWith(user);
    expect(remote.upsertUser).not.toHaveBeenCalled();
    expect(await repo.pendingSyncCount()).toBe(0);
  });

  it('also queues online creates when a profile is claimed', async () => {
    setSyncQueueActorGetter(() => 'admin');
    const enqueue = jest.spyOn(SyncQueue.prototype, 'enqueue');
    await repo.createUser(user);
    expect(enqueue).toHaveBeenCalledWith({ type: 'createUser', payload: user });
    expect(remote.createUser).toHaveBeenCalledTimes(1);
    expect(await repo.pendingSyncCount()).toBe(0);
  });

  it('preserves local/demo creation without any claimed actor', async () => {
    const enqueue = jest.spyOn(SyncQueue.prototype, 'enqueue');
    await new OfflineFirstRepository(null).createUser(user);
    expect(await local.getUsers(user.familyId)).toEqual([user]);
    expect(enqueue).not.toHaveBeenCalled();
    expect(remote.createUser).not.toHaveBeenCalled();
  });

  it.each([null, 'first-profile', 'another-profile'])('never replays an ownerless createUser under actor %s', async (actor) => {
    const queue = new SyncQueue();
    await queue.enqueue({ type: 'createUser', payload: user });
    setSyncQueueActorGetter(() => actor);
    expect(await queue.flush(remote)).toEqual({ succeeded: 0, remaining: 0, conflicted: 0, quarantined: 1 });
    expect(remote.createUser).not.toHaveBeenCalled();
    expect(await queue.getQuarantined()).toEqual([
      expect.objectContaining({ op: { type: 'createUser', payload: user } }),
    ]);
    await new SyncQueue().flush(remote);
    expect(remote.createUser).not.toHaveBeenCalled();
  });
});
