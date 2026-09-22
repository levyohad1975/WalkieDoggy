import type { Repository } from '../repository';
import type { OfflineFirstRepository as OfflineFirstRepositoryType } from '../offlineFirstRepository';
import type { Dog, FamilyUser, HealthTask, ScheduleEntry, ScheduleRule, Walk } from '../../types';

function stubRemote(overrides: Partial<Repository> = {}): Repository {
  return {
    getFamily: jest.fn(),
    getUsers: jest.fn().mockResolvedValue([]),
    createUser: jest.fn().mockResolvedValue(undefined),
    upsertUser: jest.fn().mockResolvedValue(undefined),
    deleteUser: jest.fn(),
    deleteFamilyMember: jest.fn(),
    updateUserReminderSetting: jest.fn().mockResolvedValue(undefined),
    getDog: jest.fn(),
    getDogs: jest.fn(),
    upsertDog: jest.fn(),
    getHealthTasks: jest.fn(),
    upsertHealthTask: jest.fn(),
    getScheduleRules: jest.fn(),
    upsertScheduleRule: jest.fn(),
    deleteScheduleRule: jest.fn(),
    getScheduleEntries: jest.fn(),
    addScheduleEntries: jest.fn(),
    updateScheduleEntry: jest.fn().mockResolvedValue(undefined),
    deleteScheduleEntry: jest.fn(),
    getWalks: jest.fn(),
    saveWalk: jest.fn().mockResolvedValue(undefined),
    getNotificationSettings: jest.fn(),
    ...overrides,
  } as unknown as Repository;
}

function payloadFor(userId: string) {
  return { userId, updatedRules: [], updatedEntries: [], updatedWalks: [] };
}

/**
 * Round 7 fix (Part 1E / 4): deleteFamilyMember() used to apply the
 * soft-delete to the LOCAL cache first, then enqueue + trySync() — and
 * SyncQueue.flush() catches/records each item's failure internally rather
 * than rethrowing to an awaiting caller, so a genuine server-side rejection
 * (most notably 0007's "cannot remove the last admin of this family") was
 * never surfaced to the caller at all: the local cache silently kept the
 * optimistic removal while the server had actually refused it. These tests
 * cover the fix directly at the offlineFirstRepository level (see its own
 * doc comment on deleteFamilyMember for the full explanation).
 */
describe('OfflineFirstRepository.deleteFamilyMember — online rejection propagates (round 7 fix)', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.doMock('@react-native-community/netinfo', () => ({
      __esModule: true,
      default: { fetch: jest.fn().mockResolvedValue({ isConnected: true, isInternetReachable: true }) },
    }));
  });

  it('online + server rejects (e.g. last-admin protection) -> the rejection propagates AND the local cache is left untouched', async () => {
    const AsyncStorage = require('@react-native-async-storage/async-storage');
    await AsyncStorage.clear();
    const { OfflineFirstRepository } = require('../offlineFirstRepository');
    const remote = stubRemote({
      deleteFamilyMember: jest.fn().mockRejectedValue(new Error('cannot remove the last admin of this family')),
    });
    const repo = new OfflineFirstRepository(remote);

    const user: FamilyUser = {
      id: 'user-1',
      familyId: 'family-1',
      name: 'Admin',
      avatar: '🙂',
      color: '#000',
      remindersEnabled: true,
      createdAt: new Date().toISOString(),
    };
    await repo.upsertUser(user); // seed the local cache the old way (upsertUser is unaffected by this fix)

    await expect(repo.deleteFamilyMember(payloadFor('user-1'))).rejects.toThrow(
      'cannot remove the last admin of this family'
    );

    // The local cache must still show the member as ACTIVE — the whole
    // point of the fix: a rejected removal must never silently "succeed"
    // client-side.
    const localUsers = await (repo as any).local.getUsers('family-1');
    expect(localUsers.find((u: FamilyUser) => u.id === 'user-1')?.removedAt).toBeFalsy();
    expect(remote.deleteFamilyMember).toHaveBeenCalledTimes(1);
  });

  it('online + server succeeds -> the local cache reflects the removal', async () => {
    const AsyncStorage = require('@react-native-async-storage/async-storage');
    await AsyncStorage.clear();
    const { OfflineFirstRepository } = require('../offlineFirstRepository');
    const remote = stubRemote({ deleteFamilyMember: jest.fn().mockResolvedValue(undefined) });
    const repo = new OfflineFirstRepository(remote);

    const user: FamilyUser = {
      id: 'user-2',
      familyId: 'family-1',
      name: 'Member',
      avatar: '🙂',
      color: '#000',
      remindersEnabled: true,
      createdAt: new Date().toISOString(),
    };
    await repo.upsertUser(user);

    await expect(repo.deleteFamilyMember(payloadFor('user-2'))).resolves.toBeUndefined();

    const localUsers = await (repo as any).local.getUsers('family-1');
    expect(localUsers.find((u: FamilyUser) => u.id === 'user-2')?.removedAt).toBeTruthy();
  });

  it('offline -> rejects immediately, never touches the local cache, and never enqueues for later replay (round 7 Part 2 fix)', async () => {
    jest.resetModules();
    jest.doMock('@react-native-community/netinfo', () => ({
      __esModule: true,
      default: { fetch: jest.fn().mockResolvedValue({ isConnected: false, isInternetReachable: false }) },
    }));
    const AsyncStorage = require('@react-native-async-storage/async-storage');
    await AsyncStorage.clear();
    const { OfflineFirstRepository } = require('../offlineFirstRepository');
    const remote = stubRemote({ deleteFamilyMember: jest.fn().mockResolvedValue(undefined) });
    const repo = new OfflineFirstRepository(remote);

    const user: FamilyUser = {
      id: 'user-3',
      familyId: 'family-1',
      name: 'Member',
      avatar: '🙂',
      color: '#000',
      remindersEnabled: true,
      createdAt: new Date().toISOString(),
    };
    await repo.upsertUser(user);

    // repo.upsertUser() above is itself a normal offline-capable mutation,
    // so it correctly writes locally AND enqueues an upsertUser operation —
    // that queued seed op is unrelated to deleteFamilyMember. Capture the
    // count here so the assertion below proves deleteFamilyMember() added
    // nothing to the queue, rather than asserting the queue is empty overall
    // (which would be false regardless of deleteFamilyMember's behavior).
    const pendingBeforeDelete = await repo.pendingSyncCount();

    await expect(repo.deleteFamilyMember(payloadFor('user-3'))).rejects.toThrow(
      'deleteFamilyMember requires an internet connection and cannot be queued offline'
    );

    // Local cache must remain completely untouched — no optimistic removal.
    const localUsers = await (repo as any).local.getUsers('family-1');
    expect(localUsers.find((u: FamilyUser) => u.id === 'user-3')?.removedAt).toBeFalsy();
    // Never called against the server (genuinely offline)...
    expect(remote.deleteFamilyMember).not.toHaveBeenCalled();
    // ...and never queued for blind later replay either — the queue length
    // is unchanged from before the delete attempt (not asserted as zero,
    // since the upsertUser seed above legitimately queued its own op).
    expect(await repo.pendingSyncCount()).toBe(pendingBeforeDelete);
    const queued = await (repo as any).queue.getAll?.();
    if (queued) {
      expect(queued.some((item: any) => item.op?.type === 'deleteFamilyMember')).toBe(false);
    }
  });

  it('offline -> the thrown error maps to the expected friendly Hebrew message via errorMessages.ts', async () => {
    jest.resetModules();
    jest.doMock('@react-native-community/netinfo', () => ({
      __esModule: true,
      default: { fetch: jest.fn().mockResolvedValue({ isConnected: false, isInternetReachable: false }) },
    }));
    const AsyncStorage = require('@react-native-async-storage/async-storage');
    await AsyncStorage.clear();
    const { OfflineFirstRepository } = require('../offlineFirstRepository');
    const { friendlyErrorMessage } = require('../../lib/errorMessages');
    const remote = stubRemote();
    const repo = new OfflineFirstRepository(remote);

    let caught: unknown;
    try {
      await repo.deleteFamilyMember(payloadFor('user-4'));
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(Error);
    expect(friendlyErrorMessage(caught)).toBe(
      'לא ניתן להסיר בן משפחה ללא חיבור לאינטרנט. התחברו לרשת ונסו שוב.'
    );
  });

  it('local/demo mode (no remote configured) -> removal still applies locally, exactly as before', async () => {
    jest.resetModules();
    const AsyncStorage = require('@react-native-async-storage/async-storage');
    await AsyncStorage.clear();
    const { OfflineFirstRepository } = require('../offlineFirstRepository');
    const repo = new OfflineFirstRepository(null);

    const user: FamilyUser = {
      id: 'user-5',
      familyId: 'family-1',
      name: 'Member',
      avatar: '🙂',
      color: '#000',
      remindersEnabled: true,
      createdAt: new Date().toISOString(),
    };
    await repo.upsertUser(user);

    await expect(repo.deleteFamilyMember(payloadFor('user-5'))).resolves.toBeUndefined();

    const localUsers = await (repo as any).local.getUsers('family-1');
    expect(localUsers.find((u: FamilyUser) => u.id === 'user-5')?.removedAt).toBeTruthy();
  });
});

/**
 * start_walk()/finish_walk() (0048) were wired into scheduleStore.ts and
 * HomeScreen.tsx (`if (repository.startWalk) ... else <fake local state>`)
 * but OfflineFirstRepository never actually implemented either method —
 * `repository.startWalk`/`repository.finishWalk` were always `undefined`,
 * so every call silently took the in-memory-only fallback branch: nothing
 * was ever persisted to Supabase or the local cache, and the RPCs were dead
 * code from the client's perspective. Fixed by assigning both conditionally
 * in the constructor (present only when a remote repository is configured,
 * exactly so the store's own capability check keeps working correctly in
 * local/demo mode). These tests cover the fix directly, mirroring the
 * deleteFamilyMember tests above for the same "server-authoritative, no
 * blind offline replay" category of action.
 */
describe('OfflineFirstRepository.startWalk/finishWalk — actually wired to the remote RPCs', () => {
  const baseWalk: Walk = {
    id: 'walk-1',
    familyId: 'family-1',
    dogId: 'dog-1',
    date: '2026-01-01',
    scheduledTime: '08:00',
    responsibleUserId: 'user-1',
    status: 'pending',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };

  it('online + remote configured -> repository.startWalk is defined, calls the RPC, and persists the returned row locally', async () => {
    const started: Walk = { ...baseWalk, status: 'in_progress', startedAt: '2026-01-01T08:00:00.000Z', startedByUserId: 'user-1' };
    const remote = stubRemote({ startWalk: jest.fn().mockResolvedValue(started) });
    const repo = await makeRepo(true, remote);
    expect(repo.startWalk).toBeDefined();

    const result = await repo.startWalk!('walk-1');
    expect(result).toEqual(started);
    expect(remote.startWalk).toHaveBeenCalledWith('walk-1');

    const localWalks = await (repo as any).local.getWalks('family-1');
    expect(localWalks.find((w: Walk) => w.id === 'walk-1')?.status).toBe('in_progress');
  });

  it('online + remote rejects (e.g. "walk is not pending") -> the rejection propagates, not silently swallowed', async () => {
    const remote = stubRemote({ startWalk: jest.fn().mockRejectedValue(new Error('walk is not pending')) });
    const repo = await makeRepo(true, remote);

    await expect(repo.startWalk!('walk-1')).rejects.toThrow('walk is not pending');
    expect(remote.startWalk).toHaveBeenCalledTimes(1);
  });

  it('offline -> rejects immediately, never calls the remote RPC, and never enqueues for later replay', async () => {
    const remote = stubRemote({ startWalk: jest.fn() });
    const repo = await makeRepo(false, remote);

    await expect(repo.startWalk!('walk-1')).rejects.toThrow(
      'startWalk requires an internet connection and cannot be queued offline'
    );
    expect(remote.startWalk).not.toHaveBeenCalled();
  });

  it('local/demo mode (no remote configured) -> repository.startWalk/finishWalk are undefined, matching the interface\'s optional-capability contract', async () => {
    const repo = await makeRepo(true, null);
    expect(repo.startWalk).toBeUndefined();
    expect(repo.finishWalk).toBeUndefined();
  });

  it('finishWalk: online + remote configured -> calls finish_walk with the actual walker and completedAt, persists the result locally', async () => {
    const finished: Walk = {
      ...baseWalk,
      status: 'done',
      completedAt: '2026-01-01T08:30:00.000Z',
      completedByUserId: 'user-2',
      hadPee: true,
    };
    const remote = stubRemote({ finishWalk: jest.fn().mockResolvedValue(finished) });
    const repo = await makeRepo(true, remote);

    const result = await repo.finishWalk!('walk-1', 'user-2', { hadPee: true, completedAt: '2026-01-01T08:30:00.000Z' });
    expect(result).toEqual(finished);
    expect(remote.finishWalk).toHaveBeenCalledWith('walk-1', 'user-2', { hadPee: true, completedAt: '2026-01-01T08:30:00.000Z' });

    const localWalks = await (repo as any).local.getWalks('family-1');
    expect(localWalks.find((w: Walk) => w.id === 'walk-1')?.status).toBe('done');
  });
});

/** Builds a fresh, isolated OfflineFirstRepository for one test: resets the module registry so the NetInfo mock below takes effect, clears the AsyncStorage-backed local cache, then constructs the repository against `remote`. */
async function makeRepo(online: boolean, remote: Repository | null): Promise<OfflineFirstRepositoryType> {
  jest.resetModules();
  jest.doMock('@react-native-community/netinfo', () => ({
    __esModule: true,
    default: { fetch: jest.fn().mockResolvedValue({ isConnected: online, isInternetReachable: online }) },
  }));
  const AsyncStorage = require('@react-native-async-storage/async-storage');
  await AsyncStorage.clear();
  const { OfflineFirstRepository } = require('../offlineFirstRepository');
  return new OfflineFirstRepository(remote);
}

describe('OfflineFirstRepository — trySync', () => {
  it('is a no-op when no remote repository is configured (e.g. App.tsx calling it opportunistically in local/demo mode)', async () => {
    const repo = await makeRepo(true, null);
    await expect(repo.trySync()).resolves.toBeUndefined();
  });
});

describe('OfflineFirstRepository — hasPendingForOtherUser delegates to the SyncQueue', () => {
  it('returns whatever the queue reports, for the given userId', async () => {
    const repo = await makeRepo(true, null);
    (repo as any).queue = { hasPendingForOtherUser: jest.fn().mockResolvedValue(true) };

    await expect(repo.hasPendingForOtherUser('user-9')).resolves.toBe(true);
    expect((repo as any).queue.hasPendingForOtherUser).toHaveBeenCalledWith('user-9');
  });
});

describe('OfflineFirstRepository — online + remote succeeds: reads return the fresh remote data directly', () => {
  it('getFamily returns the remote family without consulting the local cache', async () => {
    const fresh = { id: 'family-1', name: 'משפחת בדיקה' };
    const remote = stubRemote({ getFamily: jest.fn().mockResolvedValue(fresh) });
    const repo = await makeRepo(true, remote);

    await expect(repo.getFamily('family-1')).resolves.toEqual(fresh);
    expect(remote.getFamily).toHaveBeenCalledWith('family-1');
  });

  it('getUsers returns the remote list', async () => {
    const fresh: FamilyUser[] = [
      { id: 'u1', familyId: 'family-1', name: 'אמא', avatar: '👩', color: '#000', remindersEnabled: true, createdAt: new Date().toISOString() },
    ];
    const remote = stubRemote({ getUsers: jest.fn().mockResolvedValue(fresh) });
    const repo = await makeRepo(true, remote);

    await expect(repo.getUsers('family-1')).resolves.toEqual(fresh);
    expect(remote.getUsers).toHaveBeenCalledWith('family-1');
  });

  it('getDog returns the remote dog', async () => {
    const fresh: Dog = { id: 'dog-1', familyId: 'family-1', name: 'ריקי', walksPerDay: 3 };
    const remote = stubRemote({ getDog: jest.fn().mockResolvedValue(fresh) });
    const repo = await makeRepo(true, remote);

    await expect(repo.getDog('family-1')).resolves.toEqual(fresh);
    expect(remote.getDog).toHaveBeenCalledWith('family-1');
  });

  it('getDogs returns every remote dog for the family (arbitrary N, not just one)', async () => {
    const dogs: Dog[] = [
      { id: 'dog-1', familyId: 'family-1', name: 'טופי', walksPerDay: 4 },
      { id: 'dog-2', familyId: 'family-1', name: 'ריקי', walksPerDay: 2 },
    ];
    const remote = stubRemote({ getDogs: jest.fn().mockResolvedValue(dogs) });
    const repo = await makeRepo(true, remote);

    await expect(repo.getDogs('family-1')).resolves.toEqual(dogs);
    expect(remote.getDogs).toHaveBeenCalledWith('family-1');
  });

  it('getHealthTasks returns the remote tasks for that dog', async () => {
    const tasks: HealthTask[] = [
      { id: 'task-1', familyId: 'family-1', dogId: 'dog-1', category: 'vaccination', title: 'חיסון', dueDate: '2026-10-01', createdAt: 'c', updatedAt: 'u' },
    ];
    const remote = stubRemote({ getHealthTasks: jest.fn().mockResolvedValue(tasks) });
    const repo = await makeRepo(true, remote);

    await expect(repo.getHealthTasks('dog-1')).resolves.toEqual(tasks);
    expect(remote.getHealthTasks).toHaveBeenCalledWith('dog-1');
  });

  it('getScheduleRules returns the remote rules', async () => {
    const fresh: ScheduleRule[] = [
      {
        id: 'rule-1',
        familyId: 'family-1',
        dogId: 'dog-1',
        time: '08:00',
        daysOfWeek: [0, 1, 2, 3, 4, 5, 6],
        rotationUserIds: ['u1'],
        rotationAnchorDate: '2026-01-01',
        sortOrder: 0,
        active: true,
        createdAt: new Date().toISOString(),
      },
    ];
    const remote = stubRemote({ getScheduleRules: jest.fn().mockResolvedValue(fresh) });
    const repo = await makeRepo(true, remote);

    await expect(repo.getScheduleRules('family-1')).resolves.toEqual(fresh);
    expect(remote.getScheduleRules).toHaveBeenCalledWith('family-1');
  });

  it('getScheduleEntries returns the remote entries', async () => {
    const fresh: ScheduleEntry[] = [
      { id: 'entry-1', familyId: 'family-1', dogId: 'dog-1', date: '2026-01-02', time: '08:00', responsibleUserId: 'u1', createdAt: new Date().toISOString() },
    ];
    const remote = stubRemote({ getScheduleEntries: jest.fn().mockResolvedValue(fresh) });
    const repo = await makeRepo(true, remote);

    await expect(repo.getScheduleEntries('family-1')).resolves.toEqual(fresh);
    expect(remote.getScheduleEntries).toHaveBeenCalledWith('family-1');
  });

  it('getWalks returns the remote walks', async () => {
    const fresh: Walk[] = [
      { id: 'walk-1', familyId: 'family-1', dogId: 'dog-1', date: '2026-01-02', scheduledTime: '08:00', responsibleUserId: 'u1', status: 'pending', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
    ];
    const remote = stubRemote({ getWalks: jest.fn().mockResolvedValue(fresh) });
    const repo = await makeRepo(true, remote);

    await expect(repo.getWalks('family-1')).resolves.toEqual(fresh);
    expect(remote.getWalks).toHaveBeenCalledWith('family-1');
  });
});

describe('OfflineFirstRepository — writes with a remote repository configured: applied locally and queued for sync', () => {
  // Offline for this whole block so the queued item is left sitting in the
  // queue (trySync's own early-return branch — already covered elsewhere —
  // is exercised either way); this isolates "did this method enqueue at
  // all" from SyncQueue.flush()'s own replay/quarantine behavior, which is
  // that module's own test file's concern, not this one's.
  const dog: Dog = { id: 'dog-1', familyId: 'family-1', name: 'ריקי', walksPerDay: 2 };
  const rule: ScheduleRule = {
    id: 'rule-1',
    familyId: 'family-1',
    dogId: 'dog-1',
    time: '08:00',
    daysOfWeek: [0, 1, 2, 3, 4, 5, 6],
    rotationUserIds: ['u1'],
    rotationAnchorDate: '2026-01-01',
    sortOrder: 0,
    active: true,
    createdAt: new Date().toISOString(),
  };
  const entry: ScheduleEntry = { id: 'entry-1', familyId: 'family-1', dogId: 'dog-1', date: '2026-01-02', time: '08:00', responsibleUserId: 'u1', createdAt: new Date().toISOString() };
  const walk: Walk = { id: 'walk-1', familyId: 'family-1', dogId: 'dog-1', date: '2026-01-02', scheduledTime: '08:00', responsibleUserId: 'u1', status: 'pending', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
  const user: FamilyUser = { id: 'u1', familyId: 'family-1', name: 'אמא', avatar: '👩', color: '#000', remindersEnabled: true, createdAt: new Date().toISOString() };

  it('deleteUser removes the local user and enqueues a sync op', async () => {
    const repo = await makeRepo(false, stubRemote());
    await repo.upsertUser(user);
    const before = await repo.pendingSyncCount();

    await repo.deleteUser('u1');

    expect((await repo.getUsers('family-1')).find((u) => u.id === 'u1')).toBeUndefined();
    expect(await repo.pendingSyncCount()).toBe(before + 1);
  });

  it('updateUserReminderSetting updates the local flag and enqueues a sync op', async () => {
    const repo = await makeRepo(false, stubRemote());
    await repo.upsertUser(user);
    const before = await repo.pendingSyncCount();

    await repo.updateUserReminderSetting('u1', false);

    expect((await repo.getUsers('family-1')).find((u) => u.id === 'u1')?.remindersEnabled).toBe(false);
    expect(await repo.pendingSyncCount()).toBe(before + 1);
  });

  it('upsertDog writes the local dog and enqueues a sync op', async () => {
    const repo = await makeRepo(false, stubRemote());

    await repo.upsertDog(dog);

    await expect(repo.getDog('family-1')).resolves.toEqual(dog);
    expect(await repo.pendingSyncCount()).toBe(1);
  });

  it('upsertHealthTask writes the local task and enqueues a sync op', async () => {
    const repo = await makeRepo(false, stubRemote());
    const task: HealthTask = { id: 'task-1', familyId: 'family-1', dogId: 'dog-1', category: 'vaccination', title: 'חיסון', dueDate: '2026-10-01', createdAt: 'c', updatedAt: 'u' };

    await repo.upsertHealthTask(task);

    await expect(repo.getHealthTasks('dog-1')).resolves.toEqual([task]);
    expect(await repo.pendingSyncCount()).toBe(1);
  });

  it('upsertScheduleRule writes the local rule and enqueues a sync op', async () => {
    const repo = await makeRepo(false, stubRemote());

    await repo.upsertScheduleRule(rule);

    await expect(repo.getScheduleRules('family-1')).resolves.toEqual([rule]);
    expect(await repo.pendingSyncCount()).toBe(1);
  });

  it('deleteScheduleRule removes the local rule and enqueues a sync op', async () => {
    const repo = await makeRepo(false, stubRemote());
    await repo.upsertScheduleRule(rule);
    const before = await repo.pendingSyncCount();

    await repo.deleteScheduleRule('rule-1');

    await expect(repo.getScheduleRules('family-1')).resolves.toEqual([]);
    expect(await repo.pendingSyncCount()).toBe(before + 1);
  });

  it('addScheduleEntries writes the local entry and enqueues a sync op', async () => {
    const repo = await makeRepo(false, stubRemote());

    await repo.addScheduleEntries([entry]);

    await expect(repo.getScheduleEntries('family-1')).resolves.toEqual([entry]);
    expect(await repo.pendingSyncCount()).toBe(1);
  });

  it('updateScheduleEntry updates the local entry and enqueues a sync op', async () => {
    const repo = await makeRepo(false, stubRemote());
    await repo.addScheduleEntries([entry]);
    const before = await repo.pendingSyncCount();
    const updated: ScheduleEntry = { ...entry, time: '09:00' };

    await repo.updateScheduleEntry(updated);

    await expect(repo.getScheduleEntries('family-1')).resolves.toEqual([updated]);
    expect(await repo.pendingSyncCount()).toBe(before + 1);
  });

  it('deleteScheduleEntry removes the local entry and enqueues a sync op', async () => {
    const repo = await makeRepo(false, stubRemote());
    await repo.addScheduleEntries([entry]);
    const before = await repo.pendingSyncCount();

    await repo.deleteScheduleEntry('entry-1');

    await expect(repo.getScheduleEntries('family-1')).resolves.toEqual([]);
    expect(await repo.pendingSyncCount()).toBe(before + 1);
  });

  it('saveWalk writes the local walk and enqueues a sync op', async () => {
    const repo = await makeRepo(false, stubRemote());

    await repo.saveWalk(walk);

    await expect(repo.getWalks('family-1')).resolves.toEqual([walk]);
    expect(await repo.pendingSyncCount()).toBe(1);
  });

  it('deleteWalk removes the local walk and enqueues a sync op', async () => {
    const repo = await makeRepo(false, stubRemote());
    await repo.saveWalk(walk);
    const before = await repo.pendingSyncCount();

    await repo.deleteWalk('walk-1');

    await expect(repo.getWalks('family-1')).resolves.toEqual([]);
    expect(await repo.pendingSyncCount()).toBe(before + 1);
  });
});

describe('OfflineFirstRepository — local/demo mode (no remote configured): writes apply locally only, nothing is ever queued', () => {
  const dog: Dog = { id: 'dog-1', familyId: 'family-1', name: 'ריקי', walksPerDay: 2 };
  const rule: ScheduleRule = {
    id: 'rule-1',
    familyId: 'family-1',
    dogId: 'dog-1',
    time: '08:00',
    daysOfWeek: [0, 1, 2, 3, 4, 5, 6],
    rotationUserIds: ['u1'],
    rotationAnchorDate: '2026-01-01',
    sortOrder: 0,
    active: true,
    createdAt: new Date().toISOString(),
  };
  const entry: ScheduleEntry = { id: 'entry-1', familyId: 'family-1', dogId: 'dog-1', date: '2026-01-02', time: '08:00', responsibleUserId: 'u1', createdAt: new Date().toISOString() };
  const walk: Walk = { id: 'walk-1', familyId: 'family-1', dogId: 'dog-1', date: '2026-01-02', scheduledTime: '08:00', responsibleUserId: 'u1', status: 'pending', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
  const user: FamilyUser = { id: 'u1', familyId: 'family-1', name: 'אמא', avatar: '👩', color: '#000', remindersEnabled: true, createdAt: new Date().toISOString() };

  it('deleteUser removes the local user, nothing queued', async () => {
    const repo = await makeRepo(true, null);
    await repo.upsertUser(user);

    await repo.deleteUser('u1');

    expect((await repo.getUsers('family-1')).find((u) => u.id === 'u1')).toBeUndefined();
    expect(await repo.pendingSyncCount()).toBe(0);
  });

  it('updateUserReminderSetting updates locally, nothing queued', async () => {
    const repo = await makeRepo(true, null);
    await repo.upsertUser(user);

    await repo.updateUserReminderSetting('u1', false);

    expect((await repo.getUsers('family-1')).find((u) => u.id === 'u1')?.remindersEnabled).toBe(false);
    expect(await repo.pendingSyncCount()).toBe(0);
  });

  it('upsertDog writes locally, nothing queued', async () => {
    const repo = await makeRepo(true, null);

    await repo.upsertDog(dog);

    await expect(repo.getDog('family-1')).resolves.toEqual(dog);
    expect(await repo.pendingSyncCount()).toBe(0);
  });

  it('upsertScheduleRule writes locally, nothing queued', async () => {
    const repo = await makeRepo(true, null);

    await repo.upsertScheduleRule(rule);

    await expect(repo.getScheduleRules('family-1')).resolves.toEqual([rule]);
    expect(await repo.pendingSyncCount()).toBe(0);
  });

  it('deleteScheduleRule removes locally, nothing queued', async () => {
    const repo = await makeRepo(true, null);
    await repo.upsertScheduleRule(rule);

    await repo.deleteScheduleRule('rule-1');

    await expect(repo.getScheduleRules('family-1')).resolves.toEqual([]);
    expect(await repo.pendingSyncCount()).toBe(0);
  });

  it('addScheduleEntries writes locally, nothing queued', async () => {
    const repo = await makeRepo(true, null);

    await repo.addScheduleEntries([entry]);

    await expect(repo.getScheduleEntries('family-1')).resolves.toEqual([entry]);
    expect(await repo.pendingSyncCount()).toBe(0);
  });

  it('updateScheduleEntry updates locally, nothing queued', async () => {
    const repo = await makeRepo(true, null);
    await repo.addScheduleEntries([entry]);
    const updated: ScheduleEntry = { ...entry, time: '09:00' };

    await repo.updateScheduleEntry(updated);

    await expect(repo.getScheduleEntries('family-1')).resolves.toEqual([updated]);
    expect(await repo.pendingSyncCount()).toBe(0);
  });

  it('deleteScheduleEntry removes locally, nothing queued', async () => {
    const repo = await makeRepo(true, null);
    await repo.addScheduleEntries([entry]);

    await repo.deleteScheduleEntry('entry-1');

    await expect(repo.getScheduleEntries('family-1')).resolves.toEqual([]);
    expect(await repo.pendingSyncCount()).toBe(0);
  });

  it('saveWalk writes locally, nothing queued', async () => {
    const repo = await makeRepo(true, null);

    await repo.saveWalk(walk);

    await expect(repo.getWalks('family-1')).resolves.toEqual([walk]);
    expect(await repo.pendingSyncCount()).toBe(0);
  });

  it('deleteWalk removes locally, nothing queued', async () => {
    const repo = await makeRepo(true, null);
    await repo.saveWalk(walk);

    await repo.deleteWalk('walk-1');

    await expect(repo.getWalks('family-1')).resolves.toEqual([]);
    expect(await repo.pendingSyncCount()).toBe(0);
  });
});
