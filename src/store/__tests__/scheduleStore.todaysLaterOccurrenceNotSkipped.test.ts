import type { ScheduleEntry, Walk } from '../../types';
import { computeNextWalk } from '../../logic/nextWalk';

/**
 * P0 real-device fix, round 4 — real-iPhone QA after the round-3 fix
 * (a6965a6): at ~13:00, Schedule correctly showed a 14:00 occurrence for
 * today, but Home incorrectly selected TOMORROW's 08:00 occurrence as the
 * next walk instead, even though an EARLIER walk today was legitimately
 * 'done'.
 *
 * Root cause: dedupeCanonicalWalks's status-rank table (src/logic/
 * nextWalk.ts) put `skipped` ABOVE `pending`. The exact duplicate-
 * local-id race the round-3 fix addresses (two local walk ids minted for
 * one schedule_entry_id — see resolveCanonicalWalkId's doc comment in
 * offlineFirstRepository.ts) can leave ONE copy of an occurrence
 * genuinely 'pending' (still actionable, not yet due) and the OTHER stuck
 * as a stale 'skipped'. Deduping by schedule_entry_id then picked the
 * dead-end `skipped` copy as canonical and silently discarded the real,
 * still-relevant `pending` one — removing a valid future occurrence from
 * Home entirely, with Schedule (which renders the same `walks` state)
 * showing it correctly only coincidentally, by timing, before the next
 * reload ran the same dedup. Fixed by making `pending` outrank `skipped`.
 *
 * This test proves the fix end-to-end through the real repository and
 * useScheduleStore.load(): a completed earlier occurrence stays done,
 * while a separate, later, still-pending occurrence today is correctly
 * selected over tomorrow's — even in the presence of a stale skipped
 * duplicate for that exact occurrence.
 */
describe('scheduleStore — a genuinely pending later occurrence today is never suppressed by a stale skipped duplicate', () => {
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

  it('at ~13:00: an earlier done walk, a later 14:00 pending occurrence (with a stale skipped duplicate), and a tomorrow 08:00 occurrence — computeNextWalk must select today 14:00', async () => {
    await useScheduleStore.getState().load(FAMILY_ID);
    const { repository } = require('../../data');
    const template = useScheduleStore.getState().walks[0];

    // Resolve the demo seed's OTHER today walks (12:30, 17:00, 21:30) so
    // they don't interfere with isolating this exact comparison — none of
    // them are part of what this test is checking.
    for (const id of ['walk-1230', 'walk-1700', 'walk-2130']) {
      const w = useScheduleStore.getState().walks.find((x) => x.id === id);
      if (w) await repository.saveWalk({ ...w, status: 'done', completedAt: new Date().toISOString(), completedByUserId: w.responsibleUserId });
    }

    const entryMorning: ScheduleEntry = {
      id: 'entry-morning', familyId: FAMILY_ID, dogId: template.dogId,
      date: '2026-10-05', time: '08:00', responsibleUserId: template.responsibleUserId, createdAt: new Date().toISOString(),
    };
    const entryAfternoon: ScheduleEntry = {
      id: 'entry-afternoon', familyId: FAMILY_ID, dogId: template.dogId,
      date: '2026-10-05', time: '14:00', responsibleUserId: template.responsibleUserId, createdAt: new Date().toISOString(),
    };
    const entryTomorrow: ScheduleEntry = {
      id: 'entry-tomorrow', familyId: FAMILY_ID, dogId: template.dogId,
      date: '2026-10-06', time: '08:00', responsibleUserId: template.responsibleUserId, createdAt: new Date().toISOString(),
    };
    await repository.addScheduleEntries([entryMorning, entryAfternoon, entryTomorrow]);

    const morningDone: Walk = {
      id: 'walk-morning-done', familyId: FAMILY_ID, scheduleEntryId: entryMorning.id, dogId: entryMorning.dogId,
      date: entryMorning.date, scheduledTime: entryMorning.time, responsibleUserId: entryMorning.responsibleUserId,
      status: 'done', completedAt: '2026-10-05T08:20:00.000Z', completedByUserId: entryMorning.responsibleUserId,
      createdAt: entryMorning.createdAt, updatedAt: '2026-10-05T08:20:00.000Z',
    };
    const afternoonPending: Walk = {
      id: 'walk-afternoon-pending', familyId: FAMILY_ID, scheduleEntryId: entryAfternoon.id, dogId: entryAfternoon.dogId,
      date: entryAfternoon.date, scheduledTime: entryAfternoon.time, responsibleUserId: entryAfternoon.responsibleUserId,
      status: 'pending', createdAt: entryAfternoon.createdAt, updatedAt: entryAfternoon.createdAt,
    };
    // The stale leftover: a DIFFERENT local id for the exact SAME
    // schedule_entry_id, stuck 'skipped' — exactly what the duplicate-id
    // race from round 3 can produce.
    const afternoonStaleSkipped: Walk = {
      ...afternoonPending,
      id: 'walk-afternoon-stale-skipped',
      status: 'skipped',
      updatedAt: '2026-10-05T09:00:00.000Z',
    };
    const tomorrowPending: Walk = {
      id: 'walk-tomorrow-pending', familyId: FAMILY_ID, scheduleEntryId: entryTomorrow.id, dogId: entryTomorrow.dogId,
      date: entryTomorrow.date, scheduledTime: entryTomorrow.time, responsibleUserId: entryTomorrow.responsibleUserId,
      status: 'pending', createdAt: entryTomorrow.createdAt, updatedAt: entryTomorrow.createdAt,
    };
    await repository.saveWalk(morningDone);
    await repository.saveWalk(afternoonPending);
    await repository.saveWalk(afternoonStaleSkipped);
    await repository.saveWalk(tomorrowPending);

    await useScheduleStore.getState().load(FAMILY_ID);
    const { walks } = useScheduleStore.getState();

    const forAfternoonEntry = walks.filter((w) => w.scheduleEntryId === entryAfternoon.id);
    expect(forAfternoonEntry).toHaveLength(1);
    expect(forAfternoonEntry[0].status).toBe('pending');

    const forMorningEntry = walks.filter((w) => w.scheduleEntryId === entryMorning.id);
    expect(forMorningEntry).toHaveLength(1);
    expect(forMorningEntry[0].status).toBe('done');

    const next = computeNextWalk(walks, new Date('2026-10-05T13:00:00'));
    expect(next?.scheduleEntryId).toBe(entryAfternoon.id);
    expect(next?.scheduledTime).toBe('14:00');
  });

  it('is stable across repeated foreground reloads', async () => {
    await useScheduleStore.getState().load(FAMILY_ID);
    const { repository } = require('../../data');
    const template = useScheduleStore.getState().walks[0];

    const entryAfternoon: ScheduleEntry = {
      id: 'entry-afternoon-2', familyId: FAMILY_ID, dogId: template.dogId,
      date: '2026-10-05', time: '14:00', responsibleUserId: template.responsibleUserId, createdAt: new Date().toISOString(),
    };
    await repository.addScheduleEntries([entryAfternoon]);

    const pending: Walk = {
      id: 'walk-afternoon-pending-2', familyId: FAMILY_ID, scheduleEntryId: entryAfternoon.id, dogId: entryAfternoon.dogId,
      date: entryAfternoon.date, scheduledTime: entryAfternoon.time, responsibleUserId: entryAfternoon.responsibleUserId,
      status: 'pending', createdAt: entryAfternoon.createdAt, updatedAt: entryAfternoon.createdAt,
    };
    const staleSkipped: Walk = { ...pending, id: 'walk-afternoon-stale-skipped-2', status: 'skipped' };
    await repository.saveWalk(pending);
    await repository.saveWalk(staleSkipped);

    await useScheduleStore.getState().load(FAMILY_ID);
    await useScheduleStore.getState().load(FAMILY_ID);
    await useScheduleStore.getState().load(FAMILY_ID);

    const forEntry = useScheduleStore.getState().walks.filter((w) => w.scheduleEntryId === entryAfternoon.id);
    expect(forEntry).toHaveLength(1);
    expect(forEntry[0].status).toBe('pending');
  });
});
