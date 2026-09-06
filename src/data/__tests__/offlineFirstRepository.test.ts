import type { Repository } from '../repository';
import type { FamilyUser } from '../../types';

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
    upsertDog: jest.fn(),
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
