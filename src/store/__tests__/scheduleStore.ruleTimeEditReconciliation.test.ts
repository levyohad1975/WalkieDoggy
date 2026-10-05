import type { ScheduleEntry, Walk } from '../../types';
import { computeNextWalk } from '../../logic/nextWalk';

/**
 * P0 real-device fix — definitive real-iPhone diagnostic evidence (via the
 * temporary walk-pipeline diagnostic panel) proved: schedule_rule time was
 * correctly updated to 14:00, but its actual occurrences were NOT
 * reconciled — today's schedule_entry stayed at 09:00 (linked to an
 * already-'done' walk from this morning) and tomorrow's schedule_entry
 * also stayed at 09:00 (status 'pending'). No 14:00 entry existed for
 * today at all. computeNextWalk was behaving correctly against this data
 * — the bug was entirely upstream, in the rule-edit reconciliation itself.
 *
 * Root-caused to two independent bugs (see their own fixes' doc comments
 * for the full writeup):
 *   1. OfflineFirstRepository.updateScheduleEntry fired a fire-and-forget
 *      queued write even while online (unlike every other mutation here),
 *      so a subsequent online read could silently overwrite the optimistic
 *      local edit with the server's still-stale value.
 *   2. planRuleDaysReconciliation (src/logic/rotation.ts) blindly mutated
 *      EVERY future entry's time in place, including one whose walk was
 *      already resolved (done/in_progress/skipped) — which would rewrite
 *      completed history — while the walk-side update correctly refuses to
 *      touch a non-'pending' walk, so the entry and its done walk ended up
 *      disagreeing on time with no new actionable occurrence ever created.
 *
 * This test reproduces the exact reported scenario end-to-end through the
 * real repository and useScheduleStore: a rule originally at 09:00 whose
 * today's occurrence is already 'done', plus an existing 'pending'
 * tomorrow occurrence, edited to 14:00 at ~13:00 today.
 */
describe('scheduleStore.updateRule — reconciles entries/walks for a recurring rule time edit without corrupting history', () => {
  const FAMILY_ID = 'family-main';
  let useScheduleStore: typeof import('../scheduleStore').useScheduleStore;

  beforeEach(async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-10-05T13:00:00'));
    jest.resetModules();
    const AsyncStorage = require('@react-native-async-storage/async-storage');
    await AsyncStorage.clear();
    ({ useScheduleStore } = require('../scheduleStore'));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('today gets a correct new 14:00 actionable occurrence, tomorrow updates to 14:00, and the completed 09:00 walk stays untouched', async () => {
    await useScheduleStore.getState().load(FAMILY_ID);
    const { repository } = require('../../data');

    // Demo seed's rule-0700 already has TODAY's walk 'done' at 07:00 —
    // exactly the "today's occurrence under the old time already
    // completed" precondition. Resolve the OTHER demo rules' today walks
    // (12:30/17:00/21:30) so they don't interfere with isolating this
    // exact comparison.
    for (const id of ['walk-1230', 'walk-1700', 'walk-2130']) {
      const w = useScheduleStore.getState().walks.find((x: Walk) => x.id === id);
      if (w) await repository.saveWalk({ ...w, status: 'done', completedAt: new Date().toISOString(), completedByUserId: w.responsibleUserId });
    }

    const doneWalkBefore = useScheduleStore.getState().walks.find((w: Walk) => w.id === 'walk-0700');
    expect(doneWalkBefore?.status).toBe('done');
    expect(doneWalkBefore?.scheduledTime).toBe('07:00');

    // Simulate an already-existing TOMORROW occurrence for this rule
    // (as a real device would have from an earlier backfill cycle) —
    // matches the real-device evidence's "tomorrow: schedule_entry time=09:00, pending walk" exactly.
    const tomorrow = '2026-10-06';
    const tomorrowEntry: ScheduleEntry = {
      id: 'entry-0700-tomorrow', familyId: FAMILY_ID, dogId: 'dog-topi', ruleId: 'rule-0700',
      date: tomorrow, time: '07:00', responsibleUserId: 'user-ima', createdAt: new Date().toISOString(),
    };
    await repository.addScheduleEntries([tomorrowEntry]);
    const tomorrowWalk: Walk = {
      id: 'walk-0700-tomorrow', familyId: FAMILY_ID, scheduleEntryId: tomorrowEntry.id, dogId: tomorrowEntry.dogId,
      date: tomorrow, scheduledTime: '07:00', responsibleUserId: tomorrowEntry.responsibleUserId,
      status: 'pending', createdAt: tomorrowEntry.createdAt, updatedAt: tomorrowEntry.createdAt,
    };
    await repository.saveWalk(tomorrowWalk);

    await useScheduleStore.getState().load(FAMILY_ID);

    // The actual edit: rule-0700 moves from 07:00 to 14:00.
    await useScheduleStore.getState().updateRule('rule-0700', { time: '14:00' });

    const state = useScheduleStore.getState();
    expect(state.actionError).toBeNull();
    expect(state.rules.find((r) => r.id === 'rule-0700')?.time).toBe('14:00');

    // 1) The completed 07:00 walk and its entry are historical truth — untouched.
    const doneEntry = state.entries.find((e) => e.id === 'entry-0700');
    const doneWalk = state.walks.find((w) => w.id === 'walk-0700');
    expect(doneEntry?.time).toBe('07:00');
    expect(doneWalk?.status).toBe('done');
    expect(doneWalk?.scheduledTime).toBe('07:00');

    // 2) A NEW, separate, actionable 14:00 occurrence exists for TODAY,
    // linked to the same rule, distinct from the historical entry.
    const todayNewEntries = state.entries.filter((e) => e.ruleId === 'rule-0700' && e.date === '2026-10-05' && e.id !== 'entry-0700');
    expect(todayNewEntries).toHaveLength(1);
    const todayNewWalk = state.walks.find((w) => w.scheduleEntryId === todayNewEntries[0].id);
    expect(todayNewWalk?.status).toBe('pending');
    expect(todayNewWalk?.scheduledTime).toBe('14:00');

    // No duplicate: exactly one pending/actionable walk for today's new entry.
    expect(state.walks.filter((w) => w.scheduleEntryId === todayNewEntries[0].id)).toHaveLength(1);

    // 3) Tomorrow's existing entry/walk is updated IN PLACE (same id) to 14:00 — no duplicate created.
    const tomorrowEntryAfter = state.entries.find((e) => e.id === 'entry-0700-tomorrow');
    const tomorrowWalkAfter = state.walks.find((w) => w.id === 'walk-0700-tomorrow');
    expect(tomorrowEntryAfter?.time).toBe('14:00');
    expect(tomorrowWalkAfter?.scheduledTime).toBe('14:00');
    expect(tomorrowWalkAfter?.status).toBe('pending');
    expect(state.walks.filter((w) => w.scheduleEntryId === 'entry-0700-tomorrow')).toHaveLength(1);

    // 4) Home's "next walk" now correctly selects today's new 14:00 occurrence.
    const next = computeNextWalk(state.walks, new Date('2026-10-05T13:00:00'));
    expect(next?.scheduledTime).toBe('14:00');
    expect(next?.date).toBe('2026-10-05');
    expect(next?.id).toBe(todayNewWalk?.id);

    // 5) A fresh reload (foreground/reopen) is stable — same facts hold,
    // proving the fix persisted (repository.updateScheduleEntry actually
    // confirmed online) rather than only existing in optimistic local state.
    await useScheduleStore.getState().load(FAMILY_ID);
    const reloaded = useScheduleStore.getState();
    expect(reloaded.entries.find((e) => e.id === 'entry-0700-tomorrow')?.time).toBe('14:00');
    expect(reloaded.walks.find((w) => w.id === 'walk-0700')?.status).toBe('done');
    expect(reloaded.walks.find((w) => w.id === 'walk-0700')?.scheduledTime).toBe('07:00');
    const reloadedTodayNew = reloaded.walks.find((w) => w.scheduleEntryId === todayNewEntries[0].id);
    expect(reloadedTodayNew?.scheduledTime).toBe('14:00');
    expect(reloadedTodayNew?.status).toBe('pending');
  });

  it('editing the rule a second time updates the already-regenerated pending occurrence in place, never creating a second duplicate for today', async () => {
    await useScheduleStore.getState().load(FAMILY_ID);
    const { repository } = require('../../data');
    for (const id of ['walk-1230', 'walk-1700', 'walk-2130']) {
      const w = useScheduleStore.getState().walks.find((x: Walk) => x.id === id);
      if (w) await repository.saveWalk({ ...w, status: 'done', completedAt: new Date().toISOString(), completedByUserId: w.responsibleUserId });
    }

    await useScheduleStore.getState().updateRule('rule-0700', { time: '14:00' });
    const afterFirst = useScheduleStore.getState();
    const firstNewEntry = afterFirst.entries.find((e) => e.ruleId === 'rule-0700' && e.date === '2026-10-05' && e.id !== 'entry-0700');
    expect(firstNewEntry).toBeTruthy();

    await useScheduleStore.getState().updateRule('rule-0700', { time: '18:00' });
    const afterSecond = useScheduleStore.getState();

    const todayEntriesForRule = afterSecond.entries.filter((e) => e.ruleId === 'rule-0700' && e.date === '2026-10-05');
    // Exactly two: the original historical 07:00 entry, and the ONE
    // regenerated entry — updated in place to 18:00, not a third one.
    expect(todayEntriesForRule).toHaveLength(2);
    const updatedEntry = todayEntriesForRule.find((e) => e.id === firstNewEntry!.id);
    expect(updatedEntry?.time).toBe('18:00');
    const walksForUpdatedEntry = afterSecond.walks.filter((w) => w.scheduleEntryId === firstNewEntry!.id);
    expect(walksForUpdatedEntry).toHaveLength(1);
    expect(walksForUpdatedEntry[0].scheduledTime).toBe('18:00');
    expect(walksForUpdatedEntry[0].status).toBe('pending');
  });
});
