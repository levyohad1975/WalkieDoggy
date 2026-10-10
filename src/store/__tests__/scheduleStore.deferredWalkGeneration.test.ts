import type { ScheduleRule, Walk } from '../../types';

/**
 * Real-device QA fix — "Schedule save spinner lingers ~10s". Real-iPhone
 * measurement: addRule() for a full-week rule awaited one saveWalk() call
 * per generated future occurrence IN SEQUENCE (up to GENERATE_DAYS_AHEAD =
 * 14), each itself up to two network round trips — roughly 28 sequential
 * round trips, the whole measured ~10s. See
 * offlineFirstRepository.queueWalksForBackgroundSync.test.ts for the proof
 * that the new method itself never blocks on slow/hanging network calls;
 * this file proves the INTEGRATION point — that addRule()/updateRule()
 * actually hand their generated walks to it instead of the old sequential
 * per-walk await loop.
 */
describe('scheduleStore — generated future-occurrence walks are handed off for background sync, never awaited one at a time', () => {
  const FAMILY_ID = 'family-main';

  let useScheduleStore: typeof import('../scheduleStore').useScheduleStore;

  beforeEach(async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-10-01T10:00:00.000Z'));
    jest.resetModules();
    const AsyncStorage = require('@react-native-async-storage/async-storage');
    await AsyncStorage.clear();
    ({ useScheduleStore } = require('../scheduleStore'));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  function fullWeekRule(id: string, before: number): ScheduleRule {
    return {
      id,
      familyId: FAMILY_ID,
      dogId: 'dog-topi',
      time: '18:00',
      daysOfWeek: [0, 1, 2, 3, 4, 5, 6],
      rotationUserIds: ['user-aba'],
      rotationAnchorDate: '2026-08-27',
      sortOrder: before,
      active: true,
      createdAt: new Date().toISOString(),
    };
  }

  it("addRule() persists today's occurrence authoritatively and hands future occurrences to background sync in ONE call", async () => {
    await useScheduleStore.getState().load(FAMILY_ID);
    const { repository } = require('../../data');
    const before = useScheduleStore.getState().rules.length;

    const queueSpy = jest.spyOn(repository, 'queueWalksForBackgroundSync');
    const saveWalkSpy = jest.spyOn(repository, 'saveWalk');

    await useScheduleStore.getState().addRule(fullWeekRule('rule-full-week', before));

    expect(queueSpy).toHaveBeenCalledTimes(1);
    const handedOffWalks = queueSpy.mock.calls[0][0] as Walk[];
    expect(handedOffWalks.length).toBeGreaterThanOrEqual(10); // GENERATE_DAYS_AHEAD = 14, every day active
    // Today's occurrence is deliberately persisted before returning so a
    // foreground reload cannot replace it with a stale remote snapshot.
    // Future occurrences still use the single deferred batch path.
    expect(saveWalkSpy).toHaveBeenCalledTimes(1);
    const todayWalk = saveWalkSpy.mock.calls[0][0] as Walk;
    expect(todayWalk.date).toBe('2026-10-01');
    expect(handedOffWalks.every((w) => w.date !== '2026-10-01')).toBe(true);

    // The walks are still visible in state immediately — handing them off
    // for background sync is not the same as not generating them at all.
    const state = useScheduleStore.getState();
    expect(state.rules.some((r) => r.id === 'rule-full-week')).toBe(true);
    expect(state.walks.filter((w) => handedOffWalks.some((hw) => hw.id === w.id))).toHaveLength(
      handedOffWalks.length
    );

    queueSpy.mockRestore();
    saveWalkSpy.mockRestore();
  });

  it("updateRule() adding new days similarly defers its newly-generated walks, never N sequential saveWalk() awaits", async () => {
    await useScheduleStore.getState().load(FAMILY_ID);
    const { repository } = require('../../data');
    const before = useScheduleStore.getState().rules.length;

    // Start with a rule active on Sundays only, then widen it to every day
    // — the newly-covered days are exactly the "toAdd" walks this test
    // targets.
    const sundayOnly: ScheduleRule = {
      id: 'rule-widen',
      familyId: FAMILY_ID,
      dogId: 'dog-topi',
      time: '19:00',
      daysOfWeek: [0],
      rotationUserIds: ['user-aba'],
      rotationAnchorDate: '2026-08-27',
      sortOrder: before,
      active: true,
      createdAt: new Date().toISOString(),
    };
    await useScheduleStore.getState().addRule(sundayOnly);

    const queueSpy = jest.spyOn(repository, 'queueWalksForBackgroundSync');
    const saveWalkSpy = jest.spyOn(repository, 'saveWalk');
    queueSpy.mockClear();

    await useScheduleStore.getState().updateRule('rule-widen', { daysOfWeek: [0, 1, 2, 3, 4, 5, 6] });

    expect(queueSpy).toHaveBeenCalledTimes(1);
    const handedOffWalks = queueSpy.mock.calls[0][0] as Walk[];
    expect(handedOffWalks.length).toBeGreaterThan(0);
    // planRuleDaysReconciliation's `toUpdate` set (pre-existing Sunday
    // occurrences recomputed against the widened rule) is intentionally
    // OUT OF SCOPE for this fix — scheduleStore.ts still awaits
    // repository.saveWalk() directly for those, unchanged, since it is a
    // different, much smaller-scale operation this real-device QA round
    // never reported as slow. Only the NEWLY ADDED days (Mon-Sat here)
    // must go through the deferred path — never saveWalk() directly.
    const newlyAddedDates = handedOffWalks.map((w) => w.date);
    const saveWalkDates = saveWalkSpy.mock.calls.map(([w]) => (w as Walk).date);
    expect(saveWalkDates.some((d) => newlyAddedDates.includes(d))).toBe(false);

    queueSpy.mockRestore();
    saveWalkSpy.mockRestore();
  });
});
