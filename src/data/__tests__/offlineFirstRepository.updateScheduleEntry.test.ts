import type { Repository } from '../repository';
import type { ScheduleEntry } from '../../types';

/**
 * P0 real-device fix — root cause #1 of "editing a recurring rule's time
 * doesn't actually change today's/tomorrow's occurrence": unlike every
 * other mutation in OfflineFirstRepository (upsertScheduleRule,
 * addScheduleEntries, saveWalk, ...), updateScheduleEntry ALWAYS queued +
 * fired a fire-and-forget trySync() instead of awaiting the actual
 * Supabase write while online. A subsequent ONLINE getScheduleEntries()
 * call (a pure remote pass-through, no local merge) could then return the
 * server's still-old value before the queued write had actually landed,
 * silently overwriting the just-edited local entry back to stale data —
 * exactly matching the real-device evidence: schedule_rules.time showed
 * the new value (upsertScheduleRule already awaited correctly) while
 * schedule_entries.time did not.
 */
function stubRemote(overrides: Partial<Repository> = {}): Repository {
  return {
    getFamily: jest.fn(), getUsers: jest.fn().mockResolvedValue([]), createUser: jest.fn().mockResolvedValue(undefined),
    upsertUser: jest.fn().mockResolvedValue(undefined), deleteUser: jest.fn(), deleteFamilyMember: jest.fn(),
    updateUserReminderSetting: jest.fn().mockResolvedValue(undefined), updateUserGamificationSetting: jest.fn().mockResolvedValue(undefined),
    getDog: jest.fn(), getDogs: jest.fn(), upsertDog: jest.fn(), getHealthTasks: jest.fn(), upsertHealthTask: jest.fn(),
    getGpsSession: jest.fn(), upsertGpsSession: jest.fn(), getGpsSessionsForWalkIds: jest.fn(), getAchievementUnlocks: jest.fn(),
    upsertAchievementUnlock: jest.fn(), getScheduleRules: jest.fn(), upsertScheduleRule: jest.fn(), deleteScheduleRule: jest.fn(),
    getScheduleEntries: jest.fn(), addScheduleEntries: jest.fn(), updateScheduleEntry: jest.fn().mockResolvedValue(undefined),
    deleteScheduleEntry: jest.fn(), getWalks: jest.fn().mockResolvedValue([]), saveWalk: jest.fn().mockResolvedValue(undefined),
    getNotificationSettings: jest.fn(),
    ...overrides,
  } as unknown as Repository;
}

function entryFixture(overrides: Partial<ScheduleEntry> = {}): ScheduleEntry {
  return {
    id: 'entry-1', familyId: 'family-1', dogId: 'dog-1', ruleId: 'rule-1',
    date: '2026-10-05', time: '09:00', responsibleUserId: 'user-1', createdAt: new Date().toISOString(),
    ...overrides,
  };
}

function setupNetInfo(connected: boolean) {
  jest.doMock('@react-native-community/netinfo', () => ({
    __esModule: true,
    default: { fetch: jest.fn().mockResolvedValue({ isConnected: connected, isInternetReachable: connected }) },
  }));
}

describe('OfflineFirstRepository.updateScheduleEntry (P0 real-device fix)', () => {
  beforeEach(() => {
    jest.resetModules();
    const { setSyncQueueActorGetter } = require('../syncQueue');
    setSyncQueueActorGetter(() => 'user-1');
  });

  afterEach(() => {
    const { setSyncQueueActorGetter } = require('../syncQueue');
    setSyncQueueActorGetter(() => null);
  });

  it('online: awaits the remote write before returning — it is confirmed, not merely queued', async () => {
    setupNetInfo(true);
    const AsyncStorage = require('@react-native-async-storage/async-storage');
    await AsyncStorage.clear();
    const { OfflineFirstRepository } = require('../offlineFirstRepository');

    let remoteConfirmed = false;
    const updateScheduleEntry = jest.fn(() => {
      remoteConfirmed = true;
      return Promise.resolve();
    });
    const remote = stubRemote({ updateScheduleEntry });
    const repo = new OfflineFirstRepository(remote);

    await repo.updateScheduleEntry(entryFixture({ time: '14:00' }));

    expect(updateScheduleEntry).toHaveBeenCalledWith(expect.objectContaining({ id: 'entry-1', time: '14:00' }));
    expect(remoteConfirmed).toBe(true);
    // Nothing left queued — the write already landed, not merely handed off.
    expect(await repo.pendingSyncCount()).toBe(0);
  });

  it('a subsequent online getScheduleEntries() reflects the just-confirmed write, never a stale server value', async () => {
    setupNetInfo(true);
    const AsyncStorage = require('@react-native-async-storage/async-storage');
    await AsyncStorage.clear();
    const { OfflineFirstRepository } = require('../offlineFirstRepository');

    // The remote "database": starts at 09:00, updated in place once the
    // write actually lands — simulating a real Supabase round trip.
    let serverEntry = entryFixture({ time: '09:00' });
    const remote = stubRemote({
      updateScheduleEntry: jest.fn((entry: ScheduleEntry) => {
        serverEntry = entry;
        return Promise.resolve();
      }),
      getScheduleEntries: jest.fn(() => Promise.resolve([serverEntry])),
    });
    const repo = new OfflineFirstRepository(remote);

    await repo.updateScheduleEntry(entryFixture({ time: '14:00' }));
    const reread = await repo.getScheduleEntries('family-1');

    expect(reread.find((e: ScheduleEntry) => e.id === 'entry-1')?.time).toBe('14:00');
  });

  it('a remote rejection while online throws and is never silently swallowed into the queue', async () => {
    setupNetInfo(true);
    const AsyncStorage = require('@react-native-async-storage/async-storage');
    await AsyncStorage.clear();
    const { OfflineFirstRepository } = require('../offlineFirstRepository');

    const remote = stubRemote({
      updateScheduleEntry: jest.fn().mockRejectedValue(Object.assign(new Error('permission denied'), { code: '42501' })),
    });
    const repo = new OfflineFirstRepository(remote);

    await expect(repo.updateScheduleEntry(entryFixture({ time: '14:00' }))).rejects.toThrow('permission denied');
  });

  it('offline: queues the write for later, same as before this fix', async () => {
    setupNetInfo(false);
    const AsyncStorage = require('@react-native-async-storage/async-storage');
    await AsyncStorage.clear();
    const { OfflineFirstRepository } = require('../offlineFirstRepository');

    const remote = stubRemote();
    const repo = new OfflineFirstRepository(remote);

    await repo.updateScheduleEntry(entryFixture({ time: '14:00' }));
    expect(remote.updateScheduleEntry).not.toHaveBeenCalled();
    expect(await repo.pendingSyncCount()).toBe(1);
  });
});
