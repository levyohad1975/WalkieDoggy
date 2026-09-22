import type { AchievementUnlock, Walk } from '../../types';

/**
 * PRD §9 gamification, Phase 5 kickoff — achievementStore is the first
 * consumer of logic/achievements.ts' pure progress functions: it loads
 * the family's persisted unlock ledger, recomputes progress from live
 * walk data, and durably records (exactly once — 0052's dedupe_key) any
 * achievement that just crossed its threshold, queuing it for celebration
 * UI. Same request-ordering-guard convention as healthStore.ts.
 */
describe('achievementStore', () => {
  beforeEach(() => {
    jest.resetModules();
  });

  function makeWalk(overrides: Partial<Walk>): Walk {
    return {
      id: 'w',
      familyId: 'family-1',
      dogId: 'dog-1',
      date: '2026-08-26',
      scheduledTime: '20:00',
      responsibleUserId: 'noam',
      status: 'done',
      completedByUserId: 'noam',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      ...overrides,
    };
  }

  it('load(familyId) populates unlocks and records which family they belong to', async () => {
    const { useAchievementStore } = require('../achievementStore');
    const { repository } = require('../../data');
    const unlock: AchievementUnlock = { id: 'u1', familyId: 'family-1', achievementKey: 'family_first_walk', scope: 'family', unlockedAt: 'x', createdAt: 'x' };
    jest.spyOn(repository, 'getAchievementUnlocks').mockResolvedValueOnce([unlock]);

    await useAchievementStore.getState().load('family-1');

    const state = useAchievementStore.getState();
    expect(state.error).toBeNull();
    expect(state.loading).toBe(false);
    expect(state.loadedFamilyId).toBe('family-1');
    expect(state.unlocks).toEqual([unlock]);
  });

  it('load(familyId) surfaces a repository failure as `error` instead of throwing', async () => {
    const { useAchievementStore } = require('../achievementStore');
    const { repository } = require('../../data');
    jest.spyOn(repository, 'getAchievementUnlocks').mockRejectedValueOnce(new Error('boom'));

    await useAchievementStore.getState().load('family-1');

    const state = useAchievementStore.getState();
    expect(state.loading).toBe(false);
    expect(state.error).toBe('boom');
  });

  it('a stale load() response for a family the caller has since moved on from is discarded', async () => {
    const { useAchievementStore } = require('../achievementStore');
    const { repository } = require('../../data');

    let resolveFirst!: (unlocks: AchievementUnlock[]) => void;
    const first = new Promise<AchievementUnlock[]>((resolve) => { resolveFirst = resolve; });
    const spy = jest.spyOn(repository, 'getAchievementUnlocks');
    spy.mockReturnValueOnce(first);
    spy.mockResolvedValueOnce([]);

    const firstLoad = useAchievementStore.getState().load('family-1');
    const secondLoad = useAchievementStore.getState().load('family-2');
    await secondLoad;
    resolveFirst([{ id: 'u1', familyId: 'family-1', achievementKey: 'x', scope: 'family', unlockedAt: 'x', createdAt: 'x' }]);
    await firstLoad;

    expect(useAchievementStore.getState().loadedFamilyId).toBe('family-2');
    expect(useAchievementStore.getState().unlocks).toEqual([]);
  });

  it('checkForNewUnlocks is a no-op if load() has not resolved for this family yet', async () => {
    const { useAchievementStore } = require('../achievementStore');
    const { repository } = require('../../data');
    const upsertSpy = jest.spyOn(repository, 'upsertAchievementUnlock');

    await useAchievementStore.getState().checkForNewUnlocks('family-1', [makeWalk({})], 'noam');

    expect(upsertSpy).not.toHaveBeenCalled();
    expect(useAchievementStore.getState().newlyUnlocked).toEqual([]);
  });

  it('checkForNewUnlocks persists and queues a newly-crossed family achievement', async () => {
    const { useAchievementStore } = require('../achievementStore');
    const { repository } = require('../../data');
    jest.spyOn(repository, 'getAchievementUnlocks').mockResolvedValueOnce([]);
    const upsertSpy = jest.spyOn(repository, 'upsertAchievementUnlock').mockResolvedValue(undefined);
    await useAchievementStore.getState().load('family-1');

    await useAchievementStore.getState().checkForNewUnlocks('family-1', [makeWalk({})], null);

    const state = useAchievementStore.getState();
    expect(state.unlocks.map((u: AchievementUnlock) => u.achievementKey)).toContain('family_first_walk');
    expect(state.newlyUnlocked.map((p: { key: string }) => p.key)).toContain('family_first_walk');
    expect(upsertSpy).toHaveBeenCalledWith(expect.objectContaining({ achievementKey: 'family_first_walk', scope: 'family', familyId: 'family-1' }));
  });

  it('checkForNewUnlocks also computes personal progress when a userId is given', async () => {
    const { useAchievementStore } = require('../achievementStore');
    const { repository } = require('../../data');
    jest.spyOn(repository, 'getAchievementUnlocks').mockResolvedValueOnce([]);
    jest.spyOn(repository, 'upsertAchievementUnlock').mockResolvedValue(undefined);
    await useAchievementStore.getState().load('family-1');

    await useAchievementStore.getState().checkForNewUnlocks('family-1', [makeWalk({ completedByUserId: 'noam' })], 'noam');

    const state = useAchievementStore.getState();
    expect(state.unlocks.some((u: AchievementUnlock) => u.achievementKey === 'personal_first_walk' && u.userId === 'noam')).toBe(true);
  });

  it('checkForNewUnlocks never re-persists or re-queues an achievement already in the loaded ledger', async () => {
    const { useAchievementStore } = require('../achievementStore');
    const { repository } = require('../../data');
    const existing: AchievementUnlock = { id: 'u1', familyId: 'family-1', achievementKey: 'family_first_walk', scope: 'family', unlockedAt: 'x', createdAt: 'x' };
    jest.spyOn(repository, 'getAchievementUnlocks').mockResolvedValueOnce([existing]);
    const upsertSpy = jest.spyOn(repository, 'upsertAchievementUnlock').mockResolvedValue(undefined);
    await useAchievementStore.getState().load('family-1');

    await useAchievementStore.getState().checkForNewUnlocks('family-1', [makeWalk({})], null);

    expect(upsertSpy).not.toHaveBeenCalled();
    expect(useAchievementStore.getState().newlyUnlocked).toEqual([]);
    expect(useAchievementStore.getState().unlocks).toEqual([existing]); // no duplicate appended
  });

  it('checkForNewUnlocks tolerates a failed persistence write without losing the local celebration queue', async () => {
    const { useAchievementStore } = require('../achievementStore');
    const { repository } = require('../../data');
    jest.spyOn(repository, 'getAchievementUnlocks').mockResolvedValueOnce([]);
    jest.spyOn(repository, 'upsertAchievementUnlock').mockRejectedValue(new Error('offline'));
    await useAchievementStore.getState().load('family-1');

    await expect(useAchievementStore.getState().checkForNewUnlocks('family-1', [makeWalk({})], null)).resolves.toBeUndefined();

    expect(useAchievementStore.getState().newlyUnlocked.length).toBeGreaterThan(0);
  });

  describe('consumeNextUnlocked — celebration queue', () => {
    it('pops entries one at a time, FIFO, and returns undefined once empty', async () => {
      const { useAchievementStore } = require('../achievementStore');
      const { repository } = require('../../data');
      jest.spyOn(repository, 'getAchievementUnlocks').mockResolvedValueOnce([]);
      jest.spyOn(repository, 'upsertAchievementUnlock').mockResolvedValue(undefined);
      await useAchievementStore.getState().load('family-1');

      // A single walk crosses BOTH family_first_walk and personal_first_walk at once.
      await useAchievementStore.getState().checkForNewUnlocks('family-1', [makeWalk({ completedByUserId: 'noam' })], 'noam');

      const first = useAchievementStore.getState().consumeNextUnlocked();
      expect(first).toBeTruthy();
      const second = useAchievementStore.getState().consumeNextUnlocked();
      expect(second).toBeTruthy();
      expect(first!.key).not.toBe(second!.key);
      expect(useAchievementStore.getState().consumeNextUnlocked()).toBeUndefined();
    });
  });
});
