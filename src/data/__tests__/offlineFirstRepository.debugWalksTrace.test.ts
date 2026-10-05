import type { Repository } from '../repository';
import type { Walk } from '../../types';

/**
 * TEMPORARY P0 DIAGNOSTIC (real-device QA round 5) — see
 * walkPipelineDiagnostics.ts's own doc comment. These tests can be removed
 * alongside debugWalksTrace() once the round-5 symptom is root-caused and
 * fixed. Sanity-checks the trace mirrors getWalks()'s own online/offline
 * behavior faithfully, since that fidelity is the entire point of this
 * instrument.
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
    startWalk: jest.fn(), finishWalk: jest.fn(), getNotificationSettings: jest.fn(),
    ...overrides,
  } as unknown as Repository;
}

function walkFixture(overrides: Partial<Walk> = {}): Walk {
  return {
    id: 'walk-1', familyId: 'family-1', scheduleEntryId: 'entry-1', dogId: 'dog-1',
    date: '2026-10-05', scheduledTime: '14:00', responsibleUserId: 'user-1',
    status: 'pending', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

function setupNetInfo(connected: boolean) {
  jest.doMock('@react-native-community/netinfo', () => ({
    __esModule: true,
    default: { fetch: jest.fn().mockResolvedValue({ isConnected: connected, isInternetReachable: connected }) },
  }));
}

describe('OfflineFirstRepository.debugWalksTrace (P0 round 5 temporary diagnostic)', () => {
  beforeEach(() => {
    jest.resetModules();
    const { setSyncQueueActorGetter } = require('../syncQueue');
    setSyncQueueActorGetter(() => 'user-1');
  });

  afterEach(() => {
    const { setSyncQueueActorGetter } = require('../syncQueue');
    setSyncQueueActorGetter(() => null);
  });

  it('online: afterDedupe matches what getWalks() itself would return for the same state', async () => {
    setupNetInfo(true);
    const AsyncStorage = require('@react-native-async-storage/async-storage');
    await AsyncStorage.clear();
    const { LocalRepository } = require('../localRepository');
    const { OfflineFirstRepository } = require('../offlineFirstRepository');

    const remoteWalk = walkFixture({ id: 'walk-remote', status: 'pending' });
    await new LocalRepository().saveWalk(remoteWalk);
    const remote = stubRemote({ getWalks: jest.fn().mockResolvedValue([remoteWalk]) });
    const repo = new OfflineFirstRepository(remote);

    const trace = await repo.debugWalksTrace('family-1');
    const fromGetWalks = await repo.getWalks('family-1');

    expect(trace.isOnline).toBe(true);
    expect(trace.afterDedupe.map((w: any) => w.id).sort()).toEqual(fromGetWalks.map((w: Walk) => w.id).sort());
    expect(trace.remoteWalks.map((w: any) => w.id)).toContain('walk-remote');
  });

  it('offline: mergedBeforeDedupe/afterDedupe mirror the raw local cache, same as getWalks()\'s offline fallback', async () => {
    setupNetInfo(false);
    const AsyncStorage = require('@react-native-async-storage/async-storage');
    await AsyncStorage.clear();
    const { LocalRepository } = require('../localRepository');
    const { OfflineFirstRepository } = require('../offlineFirstRepository');

    const localWalk = walkFixture({ id: 'walk-local', status: 'pending' });
    await new LocalRepository().saveWalk(localWalk);
    const remote = stubRemote();
    const repo = new OfflineFirstRepository(remote);

    const trace = await repo.debugWalksTrace('family-1');
    expect(trace.isOnline).toBe(false);
    expect(trace.mergedBeforeDedupe.map((w: any) => w.id)).toEqual(['walk-local']);
    expect(trace.afterDedupe.map((w: any) => w.id)).toEqual(['walk-local']);
    expect(trace.localWalks[0].origin).toBe('local-only');
  });

  it('annotates a queued-but-unflushed local-only walk as isPendingInQueue=true, origin=local-only, and keeps it visible pre- and post-dedupe', async () => {
    setupNetInfo(true);
    const AsyncStorage = require('@react-native-async-storage/async-storage');
    await AsyncStorage.clear();
    const { OfflineFirstRepository } = require('../offlineFirstRepository');

    const remote = stubRemote({
      getWalks: jest.fn().mockResolvedValue([]),
      saveWalk: jest.fn(() => new Promise(() => {})), // never resolves — stays queued
    });
    const repo = new OfflineFirstRepository(remote);
    const pendingWalk = walkFixture({ id: 'walk-queued', status: 'pending' });
    await repo.queueWalksForBackgroundSync([pendingWalk]);

    const trace = await repo.debugWalksTrace('family-1');
    const merged = trace.mergedBeforeDedupe.find((w: any) => w.id === 'walk-queued');
    expect(merged).toBeDefined();
    expect(merged.origin).toBe('local-only');
    expect(merged.isPendingInQueue).toBe(true);
    expect(trace.afterDedupe.some((w: any) => w.id === 'walk-queued')).toBe(true);
  });
});
