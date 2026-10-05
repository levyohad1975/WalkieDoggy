import type { Repository } from '../repository';
import type { Walk } from '../../types';

/**
 * P0 real-device fix, round 3 — after a29ee55's canonical-id reconciliation
 * confirmed Start Walk working, a NEW real-device failure surfaced: once a
 * walk was legitimately finished (status 'done'), the SAME scheduled
 * occurrence reappeared as a second, separately startable pending walk
 * after a foreground reload.
 *
 * Root cause (see offlineFirstRepository.ts's pruneAndDedupeCanonicalWalks
 * and src/logic/nextWalk.ts's dedupeCanonicalWalks for the full writeup): a
 * stale PENDING duplicate walk — left over from the exact local-id race
 * resolveCanonicalWalkId resolves for Start (two local walk ids minted for
 * one schedule_entry_id, only one of which can ever become the real server
 * row) — could still be sitting in the local cache under a DIFFERENT id
 * than the real, already-completed canonical walk, with NOTHING in its own
 * sync-queue state marking it for cleanup. getWalks()'s ONLINE cleanup
 * logic (added in a29ee55) only prunes a local walk once its queued write
 * has resolved one way or another; a reload that instead hits the OFFLINE
 * fallback (`this.local.getWalks(familyId)`, e.g. a transient `isOnline()`
 * false right after foregrounding, before connectivity is confirmed)
 * returns the raw local cache with NO deduplication at all — so the stale
 * pending duplicate came right back, independently selectable by Home's
 * "next walk" picker (computeNextWalk), regardless of the real walk's
 * 'done' status.
 *
 * These tests prove getWalks() now returns exactly ONE walk per
 * schedule_entry_id — whichever is furthest along the lifecycle — on
 * every path: online, the offline fallback, and repeated reloads, and that
 * the local-only loser is actually deleted (self-healing), not just
 * filtered out in memory on every call.
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
    finishWalk: jest.fn(),
    getNotificationSettings: jest.fn(),
    ...overrides,
  } as unknown as Repository;
}

function walkFixture(overrides: Partial<Walk> = {}): Walk {
  return {
    id: 'walk-canonical',
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

/** Mocks NetInfo once, connected by default, and returns the mock so a test can flip connectivity mid-run via `netInfo.fetch.mockResolvedValue(...)`. */
function setupNetInfo(connected = true) {
  jest.doMock('@react-native-community/netinfo', () => ({
    __esModule: true,
    default: { fetch: jest.fn().mockResolvedValue({ isConnected: connected, isInternetReachable: connected }) },
  }));
  return require('@react-native-community/netinfo').default as { fetch: jest.Mock };
}

describe('OfflineFirstRepository.getWalks — one canonical walk per schedule_entry_id (P0 round 3)', () => {
  beforeEach(() => {
    jest.resetModules();
    const { setSyncQueueActorGetter } = require('../syncQueue');
    setSyncQueueActorGetter(() => 'user-1');
  });

  afterEach(() => {
    const { setSyncQueueActorGetter } = require('../syncQueue');
    setSyncQueueActorGetter(() => null);
  });

  it('online: excludes a stale local-only pending duplicate once a canonical remote done walk exists, and deletes the stale row from the local cache', async () => {
    setupNetInfo(true);
    const AsyncStorage = require('@react-native-async-storage/async-storage');
    await AsyncStorage.clear();
    const { LocalRepository } = require('../localRepository');
    const { OfflineFirstRepository } = require('../offlineFirstRepository');

    const stale = walkFixture({ id: 'walk-stale-pending', status: 'pending' });
    await new LocalRepository().saveWalk(stale);

    const done = walkFixture({ id: 'walk-canonical', status: 'done', completedAt: new Date().toISOString() });
    const remote = stubRemote({ getWalks: jest.fn().mockResolvedValue([done]) });
    const repo = new OfflineFirstRepository(remote);

    const walks = await repo.getWalks('family-1');
    const forEntry = walks.filter((w: Walk) => w.scheduleEntryId === 'entry-1');
    expect(forEntry).toHaveLength(1);
    expect(forEntry[0].id).toBe('walk-canonical');
    expect(forEntry[0].status).toBe('done');

    const localWalks = await new LocalRepository().getWalks('family-1');
    expect(localWalks.find((w: Walk) => w.id === 'walk-stale-pending')).toBeUndefined();
  });

  it('offline fallback: the raw local cache is also deduplicated, not returned as-is', async () => {
    setupNetInfo(false);
    const AsyncStorage = require('@react-native-async-storage/async-storage');
    await AsyncStorage.clear();
    const { LocalRepository } = require('../localRepository');
    const { OfflineFirstRepository } = require('../offlineFirstRepository');

    const stale = walkFixture({ id: 'walk-stale-pending', status: 'pending' });
    const done = walkFixture({ id: 'walk-canonical', status: 'done', completedAt: new Date().toISOString() });
    const seedRepo = new LocalRepository();
    await seedRepo.saveWalk(stale);
    await seedRepo.saveWalk(done);

    const remote = stubRemote();
    const repo = new OfflineFirstRepository(remote);

    const walks = await repo.getWalks('family-1');
    const forEntry = walks.filter((w: Walk) => w.scheduleEntryId === 'entry-1');
    expect(forEntry).toHaveLength(1);
    expect(forEntry[0].status).toBe('done');
  });

  it('repeated reloads stay stable — the stale duplicate never resurfaces once pruned, online or offline', async () => {
    const netInfo = setupNetInfo(false);
    const AsyncStorage = require('@react-native-async-storage/async-storage');
    await AsyncStorage.clear();
    const { LocalRepository } = require('../localRepository');
    const { OfflineFirstRepository } = require('../offlineFirstRepository');

    const stale = walkFixture({ id: 'walk-stale-pending', status: 'pending' });
    const done = walkFixture({ id: 'walk-canonical', status: 'done', completedAt: new Date().toISOString() });
    const seedRepo = new LocalRepository();
    await seedRepo.saveWalk(stale);
    await seedRepo.saveWalk(done);

    const remote = stubRemote({ getWalks: jest.fn().mockResolvedValue([done]) });
    const repo = new OfflineFirstRepository(remote);

    const first = await repo.getWalks('family-1');
    expect(first.filter((w: Walk) => w.scheduleEntryId === 'entry-1')).toHaveLength(1);

    const localAfterFirst = await new LocalRepository().getWalks('family-1');
    expect(localAfterFirst.find((w: Walk) => w.id === 'walk-stale-pending')).toBeUndefined();

    // Back online for the second reload — the self-healing delete from the
    // first (offline) call must have actually persisted, not just been
    // filtered in memory, so this stays singular too.
    netInfo.fetch.mockResolvedValue({ isConnected: true, isInternetReachable: true });
    const second = await repo.getWalks('family-1');
    expect(second.filter((w: Walk) => w.scheduleEntryId === 'entry-1')).toHaveLength(1);
    expect(second.find((w: Walk) => w.scheduleEntryId === 'entry-1')?.status).toBe('done');
  });

  it('reproduces the exact reported flow: Start succeeds, Finish succeeds, then a reload (hitting a transient offline fallback, as on a real device right after foregrounding) must not resurrect the occurrence as pending', async () => {
    const netInfo = setupNetInfo(true);
    const AsyncStorage = require('@react-native-async-storage/async-storage');
    await AsyncStorage.clear();
    const { LocalRepository } = require('../localRepository');
    const { OfflineFirstRepository } = require('../offlineFirstRepository');

    // A leftover duplicate from an earlier orphan-repair race (see
    // resolveCanonicalWalkId's doc comment) that Start/Finish never touch
    // because the UI happened to already be pointing at the real canonical
    // walk this time — exactly "the first Start Walk worked successfully".
    const sibling = walkFixture({ id: 'walk-sibling-orphan', status: 'pending' });
    const canonicalPending = walkFixture({ id: 'walk-canonical', status: 'pending' });
    const seedRepo = new LocalRepository();
    await seedRepo.saveWalk(sibling);
    await seedRepo.saveWalk(canonicalPending);

    const inProgress = { ...canonicalPending, status: 'in_progress' as const, startedAt: new Date().toISOString() };
    const done = { ...canonicalPending, status: 'done' as const, completedAt: new Date().toISOString() };
    const startWalk = jest.fn().mockResolvedValue(inProgress);
    const finishWalk = jest.fn().mockResolvedValue(done);
    // First call is resolveCanonicalWalkId's own check during Start (the
    // walk is still pending server-side at that point); every call after
    // Finish reflects the server's now-done state, matching reality.
    const getWalks = jest.fn().mockResolvedValueOnce([canonicalPending]).mockResolvedValue([done]);
    const remote = stubRemote({ getWalks, startWalk, finishWalk });
    const repo = new OfflineFirstRepository(remote);

    await repo.startWalk!('walk-canonical');
    await repo.finishWalk!('walk-canonical', 'user-1', {});

    // Foreground reload right after Finish — connectivity has not been
    // reconfirmed yet (the realistic trigger for this bug on a real
    // device), so getWalks() hits the offline fallback.
    netInfo.fetch.mockResolvedValue({ isConnected: false, isInternetReachable: false });
    const reloaded = await repo.getWalks('family-1');
    const forEntry = reloaded.filter((w: Walk) => w.scheduleEntryId === 'entry-1');
    expect(forEntry).toHaveLength(1);
    expect(forEntry[0].status).toBe('done');

    // A second reload, back online, stays stable too.
    netInfo.fetch.mockResolvedValue({ isConnected: true, isInternetReachable: true });
    const reloadedAgain = await repo.getWalks('family-1');
    const forEntryAgain = reloadedAgain.filter((w: Walk) => w.scheduleEntryId === 'entry-1');
    expect(forEntryAgain).toHaveLength(1);
    expect(forEntryAgain[0].status).toBe('done');
  });
});

/**
 * P0 real-device fix, round 4 — a valid, still-future occurrence TODAY
 * (14:00) vanished from Home entirely (fell through to TOMORROW's
 * occurrence instead), even though an EARLIER walk the same day was
 * correctly 'done'. Root cause: dedupeCanonicalWalks's status-rank table
 * (src/logic/nextWalk.ts) used to put `skipped` ABOVE `pending`, so when
 * the exact duplicate-local-id race from round 3 left one copy of the
 * 14:00 occurrence genuinely 'pending' and another stuck as a stale
 * 'skipped', getWalks()'s dedup picked the dead-end `skipped` copy as
 * canonical and discarded the real, still-actionable `pending` one. Fixed
 * by making `pending` outrank `skipped`. These tests prove getWalks()
 * returns the genuinely pending occurrence — on both the online and the
 * offline-fallback path — not the stale skipped duplicate.
 */
describe('OfflineFirstRepository.getWalks — a pending future occurrence survives a stale skipped duplicate (P0 round 4)', () => {
  beforeEach(() => {
    jest.resetModules();
    const { setSyncQueueActorGetter } = require('../syncQueue');
    setSyncQueueActorGetter(() => 'user-1');
  });

  afterEach(() => {
    const { setSyncQueueActorGetter } = require('../syncQueue');
    setSyncQueueActorGetter(() => null);
  });

  it('online: the remote-confirmed pending 14:00 walk wins over a stale local-only skipped duplicate', async () => {
    setupNetInfo(true);
    const AsyncStorage = require('@react-native-async-storage/async-storage');
    await AsyncStorage.clear();
    const { LocalRepository } = require('../localRepository');
    const { OfflineFirstRepository } = require('../offlineFirstRepository');

    const staleSkipped = walkFixture({ id: 'walk-1400-stale-skipped', scheduledTime: '14:00', status: 'skipped' });
    await new LocalRepository().saveWalk(staleSkipped);

    const pending1400 = walkFixture({ id: 'walk-1400-pending', scheduledTime: '14:00', status: 'pending' });
    const remote = stubRemote({ getWalks: jest.fn().mockResolvedValue([pending1400]) });
    const repo = new OfflineFirstRepository(remote);

    const walks = await repo.getWalks('family-1');
    const forEntry = walks.filter((w: Walk) => w.scheduleEntryId === 'entry-1');
    expect(forEntry).toHaveLength(1);
    expect(forEntry[0].id).toBe('walk-1400-pending');
    expect(forEntry[0].status).toBe('pending');
  });

  it('offline fallback: a genuinely pending occurrence survives a stale skipped duplicate in the raw local cache too', async () => {
    setupNetInfo(false);
    const AsyncStorage = require('@react-native-async-storage/async-storage');
    await AsyncStorage.clear();
    const { LocalRepository } = require('../localRepository');
    const { OfflineFirstRepository } = require('../offlineFirstRepository');

    const staleSkipped = walkFixture({ id: 'walk-1400-stale-skipped', scheduledTime: '14:00', status: 'skipped' });
    const pending1400 = walkFixture({ id: 'walk-1400-pending', scheduledTime: '14:00', status: 'pending' });
    const seedRepo = new LocalRepository();
    await seedRepo.saveWalk(staleSkipped);
    await seedRepo.saveWalk(pending1400);

    const remote = stubRemote();
    const repo = new OfflineFirstRepository(remote);

    const walks = await repo.getWalks('family-1');
    const forEntry = walks.filter((w: Walk) => w.scheduleEntryId === 'entry-1');
    expect(forEntry).toHaveLength(1);
    expect(forEntry[0].id).toBe('walk-1400-pending');
    expect(forEntry[0].status).toBe('pending');
  });
});
