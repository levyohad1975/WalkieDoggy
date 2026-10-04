import type { Repository } from '../repository';
import type { Walk } from '../../types';

function stubRemote(overrides: Partial<Repository> = {}): Repository {
  return {
    getFamily: jest.fn(),
    getUsers: jest.fn().mockResolvedValue([]),
    createUser: jest.fn().mockResolvedValue(undefined),
    upsertUser: jest.fn().mockResolvedValue(undefined),
    deleteUser: jest.fn(),
    deleteFamilyMember: jest.fn(),
    updateUserReminderSetting: jest.fn().mockResolvedValue(undefined),
    updateUserGamificationSetting: jest.fn().mockResolvedValue(undefined),
    getDog: jest.fn(),
    getDogs: jest.fn(),
    upsertDog: jest.fn(),
    getHealthTasks: jest.fn(),
    upsertHealthTask: jest.fn(),
    getGpsSession: jest.fn(),
    upsertGpsSession: jest.fn(),
    getGpsSessionsForWalkIds: jest.fn(),
    getAchievementUnlocks: jest.fn(),
    upsertAchievementUnlock: jest.fn(),
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

function walkFixture(id: string): Walk {
  return {
    id,
    familyId: 'family-1',
    scheduleEntryId: `entry-${id}`,
    dogId: 'dog-1',
    date: '2026-10-10',
    scheduledTime: '18:00',
    responsibleUserId: 'user-1',
    status: 'pending',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

/**
 * Real-device QA fix — "Schedule save spinner lingers ~10s". Real-iPhone
 * measurement: addRule() for a full-week rule awaited one saveWalk() call
 * per generated occurrence IN SEQUENCE (up to GENERATE_DAYS_AHEAD = 14),
 * each up to two network round trips — roughly 28 sequential round trips
 * accounting for the whole ~10s. queueWalksForBackgroundSync() (see its
 * own doc comment in offlineFirstRepository.ts) replaces that sequential
 * await chain: local write + SyncQueue enqueue (both fast, AsyncStorage-
 * only) resolve the caller immediately, and a best-effort trySync() is
 * kicked off WITHOUT being awaited. These tests prove that guarantee
 * directly: the caller is never blocked waiting for the actual network
 * activity, no matter how long it takes — and that the write is still
 * DURABLE (reaches the local cache and the queue) before this resolves,
 * never a bare fire-and-forget that could be lost if the PWA closes.
 */
describe('OfflineFirstRepository.queueWalksForBackgroundSync — durable, non-blocking handoff', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.doMock('@react-native-community/netinfo', () => ({
      __esModule: true,
      default: { fetch: jest.fn().mockResolvedValue({ isConnected: true, isInternetReachable: true }) },
    }));
    // SyncQueue only ever flushes (never quarantines) an item claimed by
    // the CURRENT device's own actor — see syncQueue.ts's own
    // getClaimedUserId doc comment. Every real app launch wires this via
    // setSyncQueueActorGetter (App.tsx); tests must do the same or every
    // enqueued item here would be quarantined as "untagged" instead of
    // ever being applied.
    const { setSyncQueueActorGetter } = require('../syncQueue');
    setSyncQueueActorGetter(() => 'user-1');
  });

  afterEach(() => {
    const { setSyncQueueActorGetter } = require('../syncQueue');
    setSyncQueueActorGetter(() => null);
  });

  it('resolves promptly even when the underlying remote write never settles — the caller is never blocked waiting for the network', async () => {
    const AsyncStorage = require('@react-native-async-storage/async-storage');
    await AsyncStorage.clear();
    const { OfflineFirstRepository } = require('../offlineFirstRepository');
    const neverResolves = jest.fn(() => new Promise<void>(() => undefined));
    const remote = stubRemote({ saveWalk: neverResolves });
    const repo = new OfflineFirstRepository(remote);

    const walks = Array.from({ length: 14 }, (_, i) => walkFixture(`walk-${i}`));

    const start = Date.now();
    await repo.queueWalksForBackgroundSync(walks);
    const elapsedMs = Date.now() - start;

    // Generously bounded — this should really take single-digit
    // milliseconds (local AsyncStorage writes only); 1000ms leaves ample
    // headroom for CI jitter while still proving it never waited on the
    // (deliberately never-resolving) remote call.
    expect(elapsedMs).toBeLessThan(1000);
  });

  it('still durably persists every walk to the local cache before resolving — never lost if the PWA closes right after', async () => {
    const AsyncStorage = require('@react-native-async-storage/async-storage');
    await AsyncStorage.clear();
    const { OfflineFirstRepository } = require('../offlineFirstRepository');
    const remote = stubRemote({ saveWalk: jest.fn(() => new Promise<void>(() => undefined)) });
    const repo = new OfflineFirstRepository(remote);

    const walks = [walkFixture('walk-a'), walkFixture('walk-b')];
    await repo.queueWalksForBackgroundSync(walks);

    const localWalks = await repo.getWalks('family-1');
    const localIds = new Set(localWalks.map((w: Walk) => w.id));
    expect(localIds.has('walk-a')).toBe(true);
    expect(localIds.has('walk-b')).toBe(true);
  });

  it('enqueues every walk so a subsequent sync (foreground, reopening the app, etc.) actually delivers them to the server — this is a durable queue handoff, not a bare fire-and-forget', async () => {
    const AsyncStorage = require('@react-native-async-storage/async-storage');
    await AsyncStorage.clear();
    const { OfflineFirstRepository } = require('../offlineFirstRepository');
    const saveWalk = jest.fn().mockResolvedValue(undefined);
    const remote = stubRemote({ saveWalk });
    const repo = new OfflineFirstRepository(remote);

    const walks = [walkFixture('walk-a'), walkFixture('walk-b')];
    await repo.queueWalksForBackgroundSync(walks);
    expect(await repo.pendingSyncCount()).toBeGreaterThanOrEqual(2);

    // Simulate the next foreground/trySync pass (exactly what
    // App.tsx's runForegroundSync already does on every foreground
    // transition) actually delivering the queued writes.
    await repo.trySync();
    expect(saveWalk).toHaveBeenCalledTimes(2);
    expect(await repo.pendingSyncCount()).toBe(0);
  });

  it('is a no-op beyond the local write in local/demo mode (no remote configured) — never throws', async () => {
    const AsyncStorage = require('@react-native-async-storage/async-storage');
    await AsyncStorage.clear();
    const { OfflineFirstRepository } = require('../offlineFirstRepository');
    const repo = new OfflineFirstRepository(null);

    await expect(repo.queueWalksForBackgroundSync([walkFixture('walk-a')])).resolves.toBeUndefined();
    const localWalks = await repo.getWalks('family-1');
    expect(localWalks.some((w: Walk) => w.id === 'walk-a')).toBe(true);
  });
});
