import type { Repository } from '../repository';
import type { Walk } from '../../types';

/**
 * P0 real-device fix, follow-up round 2 — "Start" permanently failed on a
 * real iPhone PWA with an opaque "walk not found" on an overdue, otherwise
 * normal scheduled walk. Root cause (see offlineFirstRepository.ts's
 * resolveCanonicalWalkId doc comment for the full writeup):
 *
 * `walks.schedule_entry_id` is UNIQUE (supabase/schema.sql), but a local
 * walk id for one occurrence could still be minted more than once by
 * scheduleStore.loadScheduleForFamily's orphan-walk-repair, if a foreground
 * reload ran again before an earlier repair's queueWalksForBackgroundSync()
 * write had actually reached the server. Only ONE of the two local ids can
 * ever become the real server row; the LOSING id was never reconciled back
 * into the local cache anywhere, so Home kept showing it forever, and
 * start_walk() could only ever reject it with "walk not found" — including
 * after commit 47559ad's pre-flush, since the losing write "succeeds" by
 * silently writing into the OTHER row (no error, nothing to retry).
 *
 * A second, independent bug made the PRE-EXISTING "recover canonical id on
 * walk-not-found" retry path in startWalk() a dead letter: it looked up the
 * stale local walk via `this.local.getWalks('')` — an EMPTY familyId —
 * which LocalRepository.getWalks always filters by family and therefore
 * always returned `[]`, so the lookup silently found nothing and the
 * original error was always rethrown immediately.
 *
 * These tests exercise the fix: resolveCanonicalWalkId (via the public
 * startWalk entry point) resolves to the canonical server id BEFORE ever
 * calling start_walk, using LocalRepository.findWalkById (no family-filter
 * bug) instead.
 */
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
    getWalks: jest.fn().mockResolvedValue([]),
    saveWalk: jest.fn().mockResolvedValue(undefined),
    startWalk: jest.fn(),
    getNotificationSettings: jest.fn(),
    ...overrides,
  } as unknown as Repository;
}

function walkFixture(overrides: Partial<Walk> = {}): Walk {
  return {
    id: 'walk-orphan',
    familyId: 'family-1',
    scheduleEntryId: 'entry-1',
    dogId: 'dog-1',
    date: '2026-10-05',
    scheduledTime: '08:00',
    responsibleUserId: 'user-1',
    status: 'pending',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

describe('OfflineFirstRepository.startWalk — canonical schedule_entry_id reconciliation (P0 round 2)', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.doMock('@react-native-community/netinfo', () => ({
      __esModule: true,
      default: { fetch: jest.fn().mockResolvedValue({ isConnected: true, isInternetReachable: true }) },
    }));
    const { setSyncQueueActorGetter } = require('../syncQueue');
    setSyncQueueActorGetter(() => 'user-1');
  });

  afterEach(() => {
    const { setSyncQueueActorGetter } = require('../syncQueue');
    setSyncQueueActorGetter(() => null);
  });

  it('persists the genuinely-missing server row and starts it, when the local walk never reached the server at all', async () => {
    const AsyncStorage = require('@react-native-async-storage/async-storage');
    await AsyncStorage.clear();
    const { LocalRepository } = require('../localRepository');
    const { OfflineFirstRepository } = require('../offlineFirstRepository');

    const orphan = walkFixture();
    await new LocalRepository().saveWalk(orphan);

    const saveWalk = jest.fn().mockResolvedValue(undefined);
    const inProgress = { ...orphan, status: 'in_progress', startedAt: new Date().toISOString() };
    const startWalk = jest.fn().mockResolvedValue(inProgress);
    const remote = stubRemote({ getWalks: jest.fn().mockResolvedValue([]), saveWalk, startWalk });
    const repo = new OfflineFirstRepository(remote);

    const result = await repo.startWalk!('walk-orphan');

    expect(saveWalk).toHaveBeenCalledWith(expect.objectContaining({ id: 'walk-orphan' }));
    expect(startWalk).toHaveBeenCalledWith('walk-orphan');
    expect(result.status).toBe('in_progress');
  });

  it('adopts the canonical server id when a different row already exists for the same schedule_entry_id, and never calls start_walk with the stale local id', async () => {
    const AsyncStorage = require('@react-native-async-storage/async-storage');
    await AsyncStorage.clear();
    const { LocalRepository } = require('../localRepository');
    const { OfflineFirstRepository } = require('../offlineFirstRepository');

    const orphan = walkFixture({ id: 'walk-orphan' });
    await new LocalRepository().saveWalk(orphan);

    const canonical = walkFixture({ id: 'walk-canonical' });
    const saveWalk = jest.fn().mockResolvedValue(undefined);
    const inProgress = { ...canonical, status: 'in_progress', startedAt: new Date().toISOString() };
    const startWalk = jest.fn().mockResolvedValue(inProgress);
    const remote = stubRemote({ getWalks: jest.fn().mockResolvedValue([canonical]), saveWalk, startWalk });
    const repo = new OfflineFirstRepository(remote);

    const result = await repo.startWalk!('walk-orphan');

    expect(saveWalk).not.toHaveBeenCalled(); // canonical already exists — must not try to re-create it
    expect(startWalk).toHaveBeenCalledWith('walk-canonical');
    expect(startWalk).not.toHaveBeenCalledWith('walk-orphan');
    expect(result.id).toBe('walk-canonical');

    // Local cache must now reflect the canonical id — the orphan row is
    // gone, so a later foreground reload cannot mint yet another duplicate.
    const localWalks = await new LocalRepository().getWalks('family-1');
    expect(localWalks.find((w: Walk) => w.id === 'walk-orphan')).toBeUndefined();
    expect(localWalks.find((w: Walk) => w.id === 'walk-canonical')).toBeDefined();
  });

  it('this reconciliation also resolves the "local queued insert previously hit a permanent uniqueness conflict" case: the row a 23505 conflict refers to already exists and is found the same way', async () => {
    const AsyncStorage = require('@react-native-async-storage/async-storage');
    await AsyncStorage.clear();
    const { LocalRepository } = require('../localRepository');
    const { OfflineFirstRepository } = require('../offlineFirstRepository');

    // Simulates: this device's own repair write for "entry-1" permanently
    // conflicted (23505) because ANOTHER device's write for the same
    // schedule_entry_id landed first — the row genuinely exists server-side
    // under that other device's id.
    const orphan = walkFixture({ id: 'walk-orphan' });
    await new LocalRepository().saveWalk(orphan);
    const canonicalFromOtherDevice = walkFixture({ id: 'walk-from-other-device' });

    const startWalk = jest.fn().mockResolvedValue({ ...canonicalFromOtherDevice, status: 'in_progress' });
    const remote = stubRemote({ getWalks: jest.fn().mockResolvedValue([canonicalFromOtherDevice]), startWalk });
    const repo = new OfflineFirstRepository(remote);

    const result = await repo.startWalk!('walk-orphan');
    expect(startWalk).toHaveBeenCalledWith('walk-from-other-device');
    expect(result.id).toBe('walk-from-other-device');
  });

  it('normal Start Walk still works for an already-canonical walk (no reconciliation needed)', async () => {
    const AsyncStorage = require('@react-native-async-storage/async-storage');
    await AsyncStorage.clear();
    const { LocalRepository } = require('../localRepository');
    const { OfflineFirstRepository } = require('../offlineFirstRepository');

    const walk = walkFixture({ id: 'walk-normal' });
    await new LocalRepository().saveWalk(walk);

    const inProgress = { ...walk, status: 'in_progress', startedAt: new Date().toISOString() };
    const startWalk = jest.fn().mockResolvedValue(inProgress);
    const remote = stubRemote({ getWalks: jest.fn().mockResolvedValue([walk]), startWalk });
    const repo = new OfflineFirstRepository(remote);

    const result = await repo.startWalk!('walk-normal');
    expect(startWalk).toHaveBeenCalledWith('walk-normal');
    expect(result.status).toBe('in_progress');
  });

  it('skips reconciliation entirely for an unplanned walk (no schedule_entry_id) — this bug class cannot apply to it', async () => {
    const AsyncStorage = require('@react-native-async-storage/async-storage');
    await AsyncStorage.clear();
    const { LocalRepository } = require('../localRepository');
    const { OfflineFirstRepository } = require('../offlineFirstRepository');

    const unplanned = walkFixture({ id: 'walk-unplanned', scheduleEntryId: undefined, isUnplanned: true });
    await new LocalRepository().saveWalk(unplanned);

    const getWalks = jest.fn().mockResolvedValue([]);
    const inProgress = { ...unplanned, status: 'in_progress', startedAt: new Date().toISOString() };
    const startWalk = jest.fn().mockResolvedValue(inProgress);
    const remote = stubRemote({ getWalks, startWalk });
    const repo = new OfflineFirstRepository(remote);

    await repo.startWalk!('walk-unplanned');
    expect(getWalks).not.toHaveBeenCalled();
    expect(startWalk).toHaveBeenCalledWith('walk-unplanned');
  });

  it('recovers via a second resolution pass if start_walk still reports "walk not found" after the proactive check (narrow concurrent-write race)', async () => {
    const AsyncStorage = require('@react-native-async-storage/async-storage');
    await AsyncStorage.clear();
    const { LocalRepository } = require('../localRepository');
    const { OfflineFirstRepository } = require('../offlineFirstRepository');

    const orphan = walkFixture({ id: 'walk-orphan' });
    await new LocalRepository().saveWalk(orphan);

    const canonical = walkFixture({ id: 'walk-canonical' });
    // First getWalks call (the proactive check): no canonical row exists
    // yet. Second call (after "walk not found"): another device's write
    // has landed in the meantime.
    const getWalks = jest.fn().mockResolvedValueOnce([]).mockResolvedValueOnce([canonical]);
    const saveWalk = jest.fn().mockResolvedValue(undefined);
    const inProgress = { ...canonical, status: 'in_progress', startedAt: new Date().toISOString() };
    const startWalk = jest
      .fn()
      .mockRejectedValueOnce(Object.assign(new Error('walk not found'), { code: 'P0001' }))
      .mockResolvedValueOnce(inProgress);
    const remote = stubRemote({ getWalks, saveWalk, startWalk });
    const repo = new OfflineFirstRepository(remote);

    const result = await repo.startWalk!('walk-orphan');
    expect(startWalk).toHaveBeenNthCalledWith(1, 'walk-orphan');
    expect(startWalk).toHaveBeenNthCalledWith(2, 'walk-canonical');
    expect(result.id).toBe('walk-canonical');
  });

  it('a foreground reload does not see a second orphan as missing: getWalks() keeps a still-queued walk visible until the server confirms it', async () => {
    const AsyncStorage = require('@react-native-async-storage/async-storage');
    await AsyncStorage.clear();
    const { OfflineFirstRepository } = require('../offlineFirstRepository');

    const saveWalk = jest.fn(() => new Promise<void>(() => undefined)); // never resolves — stays queued
    const remote = stubRemote({ getWalks: jest.fn().mockResolvedValue([]), saveWalk });
    const repo = new OfflineFirstRepository(remote);

    const pending = walkFixture({ id: 'walk-pending' });
    await repo.queueWalksForBackgroundSync!([pending]);

    const walks = await repo.getWalks('family-1');
    expect(walks.some((w: Walk) => w.id === 'walk-pending')).toBe(true);
  });
});
