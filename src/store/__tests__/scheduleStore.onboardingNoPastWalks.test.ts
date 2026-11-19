import type { ScheduleRule, Walk } from '../../types';
import { occurrenceAtOrAfterRuleStart } from '../scheduleStore';

/**
 * Field report 2026-11-05: setting up the weekly schedule during onboarding
 * immediately showed a red "לא בוצע" note and polluted History — today's
 * earlier slots (e.g. 08:00/14:00) were materialised as overdue walks for
 * times that had already passed before the family was created that evening.
 *
 * A planned walk must only be generated for an occurrence at or after the
 * moment its rule began (rule.createdAt). These tests lock that in.
 *
 * All timestamps are built with `new Date(y, m, d, h, mm)` (local) on both
 * sides so the comparison is timezone-independent in the runner.
 */
describe('occurrenceAtOrAfterRuleStart', () => {
  const ruleCreatedAt = (d: Date): Pick<ScheduleRule, 'createdAt'> => ({ createdAt: d.toISOString() });

  it('includes an occurrence at or after the rule was created', () => {
    const created = new Date(2026, 9, 1, 15, 0, 0); // 1 Oct 2026, 15:00 local
    expect(occurrenceAtOrAfterRuleStart({ date: '2026-10-01', time: '20:00' }, ruleCreatedAt(created))).toBe(true);
    expect(occurrenceAtOrAfterRuleStart({ date: '2026-10-02', time: '08:00' }, ruleCreatedAt(created))).toBe(true);
    // Exactly at the activation minute counts as within.
    expect(occurrenceAtOrAfterRuleStart({ date: '2026-10-01', time: '15:00' }, ruleCreatedAt(created))).toBe(true);
  });

  it('excludes an occurrence earlier the same day than the rule was created', () => {
    const created = new Date(2026, 9, 1, 21, 26, 0); // the onboarding evening
    expect(occurrenceAtOrAfterRuleStart({ date: '2026-10-01', time: '08:00' }, ruleCreatedAt(created))).toBe(false);
    expect(occurrenceAtOrAfterRuleStart({ date: '2026-10-01', time: '14:00' }, ruleCreatedAt(created))).toBe(false);
    expect(occurrenceAtOrAfterRuleStart({ date: '2026-10-01', time: '20:00' }, ruleCreatedAt(created))).toBe(false);
  });

  it('fails open (true) when createdAt is missing or invalid, never dropping a legitimate walk', () => {
    expect(occurrenceAtOrAfterRuleStart({ date: '2026-10-01', time: '08:00' }, undefined)).toBe(true);
    expect(occurrenceAtOrAfterRuleStart({ date: '2026-10-01', time: '08:00' }, { createdAt: '' })).toBe(true);
    expect(occurrenceAtOrAfterRuleStart({ date: '2026-10-01', time: '08:00' }, { createdAt: 'not-a-date' })).toBe(true);
  });
});

describe('addRule does not back-fill overdue walks for slots that passed before the rule was created', () => {
  const FAMILY_ID = 'family-onboarding';
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

  function dailyRule(timeHHmm: string, createdAt: string): ScheduleRule {
    return {
      id: 'rule-onboarding',
      familyId: FAMILY_ID,
      dogId: 'dog-shuki',
      time: timeHHmm,
      daysOfWeek: [0, 1, 2, 3, 4, 5, 6],
      rotationUserIds: ['user-aba'],
      rotationAnchorDate: '2026-09-01',
      sortOrder: 0,
      active: true,
      createdAt,
    };
  }

  it("skips today's occurrence when it already passed at rule creation, but keeps future days", async () => {
    await useScheduleStore.getState().load(FAMILY_ID);
    const { repository } = require('../../data');
    const saveWalkSpy = jest.spyOn(repository, 'saveWalk');
    const queueSpy = jest.spyOn(repository, 'queueWalksForBackgroundSync');

    // Rule created at 18:00 local on 1 Oct; the 08:00 slot already passed.
    await useScheduleStore.getState().addRule(dailyRule('08:00', new Date(2026, 9, 1, 18, 0, 0).toISOString()));

    // No walk is persisted for today (its only slot predates activation).
    const savedToday = saveWalkSpy.mock.calls.map((c) => c[0] as Walk).filter((w) => w.date === '2026-10-01');
    expect(savedToday).toHaveLength(0);
    // Future occurrences are still generated and handed off.
    const queued = (queueSpy.mock.calls[0]?.[0] ?? []) as Walk[];
    expect(queued.length).toBeGreaterThan(0);
    expect(queued.some((w) => w.date === '2026-10-01')).toBe(false);
    expect(queued.some((w) => w.date === '2026-10-02')).toBe(true);
    // Nothing in the resulting store is an overdue 2026-10-01 occurrence.
    expect(useScheduleStore.getState().walks.some((w) => w.date === '2026-10-01')).toBe(false);
  });

  it("keeps today's occurrence when its slot is still ahead of the creation moment", async () => {
    await useScheduleStore.getState().load(FAMILY_ID);
    const { repository } = require('../../data');
    const saveWalkSpy = jest.spyOn(repository, 'saveWalk');

    // Rule created at 06:00 local; the 08:00 slot is still upcoming today.
    await useScheduleStore.getState().addRule(dailyRule('08:00', new Date(2026, 9, 1, 6, 0, 0).toISOString()));

    const savedToday = saveWalkSpy.mock.calls.map((c) => c[0] as Walk).filter((w) => w.date === '2026-10-01');
    expect(savedToday).toHaveLength(1);
  });
});
