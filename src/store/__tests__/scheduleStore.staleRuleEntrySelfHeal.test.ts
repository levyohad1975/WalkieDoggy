import type { ScheduleEntry, ScheduleRule, Walk } from '../../types';
import { computeNextWalk } from '../../logic/nextWalk';

/**
 * P0 real-device fix, self-heal round — real-iPhone diagnostic after
 * 807e4db confirmed: 807e4db's fix only prevents a FUTURE rule-time edit
 * from corrupting its own entries going forward. It does nothing for
 * entries that were ALREADY left stale by edits made BEFORE that fix
 * shipped — there is no further rule edit coming to trigger
 * planRuleDaysReconciliation for them. This test starts from exactly that
 * kind of already-corrupted persisted state (written directly through the
 * repository, the same way a stale production row would already exist —
 * never going through updateRule() at all) and proves
 * loadScheduleForFamily's new self-heal step (planStaleRuleEntryReconciliation,
 * wired into loadScheduleForFamily in scheduleStore.ts) converges it to
 * the correct state, persists that correction to the repository (not just
 * Zustand), and stays converged across repeated reloads.
 *
 * Reproduces the exact real-device evidence: three active rules at 14:00,
 * 21:00, and 08:00, whose today/tomorrow entries are stuck at stale times
 * (09:00/11:00) from before the rules were edited to their current times.
 * "now" is 14:17 — after the 14:00 rule's time today, before the 21:00
 * rule's.
 */
describe('scheduleStore self-heal — converges already-corrupted stale rule/entry data on load, not just future edits', () => {
  const FAMILY_ID = 'family-main';
  let useScheduleStore: typeof import('../scheduleStore').useScheduleStore;

  beforeEach(async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-10-05T14:17:00'));
    jest.resetModules();
    const AsyncStorage = require('@react-native-async-storage/async-storage');
    await AsyncStorage.clear();
    ({ useScheduleStore } = require('../scheduleStore'));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  async function seedCorruptedState() {
    const { repository } = require('../../data');
    await useScheduleStore.getState().load(FAMILY_ID);

    // Neutralize the demo seed's own default rules' today walks so they
    // never interfere with isolating this exact comparison (none of them
    // are part of what this test checks).
    for (const id of ['walk-0700', 'walk-1230', 'walk-1700', 'walk-2130']) {
      const w = useScheduleStore.getState().walks.find((x: Walk) => x.id === id);
      if (w) await repository.saveWalk({ ...w, status: 'done', completedAt: new Date().toISOString(), completedByUserId: w.responsibleUserId });
    }

    const rule1400: ScheduleRule = {
      id: 'rule-1400', familyId: FAMILY_ID, dogId: 'dog-topi', time: '14:00', label: 'אחה"צ',
      daysOfWeek: [0, 1, 2, 3, 4, 5, 6], rotationUserIds: ['user-aba'], rotationAnchorDate: '2026-09-01',
      sortOrder: 10, active: true, createdAt: new Date().toISOString(),
    };
    const rule2100: ScheduleRule = {
      id: 'rule-2100', familyId: FAMILY_ID, dogId: 'dog-topi', time: '21:00', label: 'לילה',
      daysOfWeek: [0, 1, 2, 3, 4, 5, 6], rotationUserIds: ['user-ima'], rotationAnchorDate: '2026-09-01',
      sortOrder: 11, active: true, createdAt: new Date().toISOString(),
    };
    const rule0800: ScheduleRule = {
      id: 'rule-0800', familyId: FAMILY_ID, dogId: 'dog-topi', time: '08:00', label: 'בוקר',
      daysOfWeek: [0, 1, 2, 3, 4, 5, 6], rotationUserIds: ['user-eidan'], rotationAnchorDate: '2026-09-01',
      sortOrder: 12, active: true, createdAt: new Date().toISOString(),
    };
    for (const r of [rule1400, rule2100, rule0800]) await repository.upsertScheduleRule(r);

    // Directly persist the ALREADY-CORRUPTED entries/walks — simulating
    // rows that existed on the server before 807e4db shipped, never
    // touched by updateRule() at all.
    const today = '2026-10-05';
    const tomorrow = '2026-10-06';
    const corruptedEntries: ScheduleEntry[] = [
      { id: 'e-1400-today', familyId: FAMILY_ID, dogId: 'dog-topi', ruleId: 'rule-1400', date: today, time: '09:00', responsibleUserId: 'user-aba', createdAt: new Date().toISOString() },
      { id: 'e-2100-today', familyId: FAMILY_ID, dogId: 'dog-topi', ruleId: 'rule-2100', date: today, time: '11:00', responsibleUserId: 'user-ima', createdAt: new Date().toISOString() },
      { id: 'e-0800-today', familyId: FAMILY_ID, dogId: 'dog-topi', ruleId: 'rule-0800', date: today, time: '08:00', responsibleUserId: 'user-eidan', createdAt: new Date().toISOString() },
      { id: 'e-1400-tmrw', familyId: FAMILY_ID, dogId: 'dog-topi', ruleId: 'rule-1400', date: tomorrow, time: '09:00', responsibleUserId: 'user-aba', createdAt: new Date().toISOString() },
      { id: 'e-2100-tmrw', familyId: FAMILY_ID, dogId: 'dog-topi', ruleId: 'rule-2100', date: tomorrow, time: '11:00', responsibleUserId: 'user-ima', createdAt: new Date().toISOString() },
      { id: 'e-0800-tmrw', familyId: FAMILY_ID, dogId: 'dog-topi', ruleId: 'rule-0800', date: tomorrow, time: '08:00', responsibleUserId: 'user-eidan', createdAt: new Date().toISOString() },
    ];
    await repository.addScheduleEntries(corruptedEntries);

    const mk = (id: string, scheduleEntryId: string, date: string, scheduledTime: string, status: Walk['status'], responsibleUserId: string): Walk => ({
      id, familyId: FAMILY_ID, scheduleEntryId, dogId: 'dog-topi', date, scheduledTime, responsibleUserId, status,
      completedAt: status === 'done' ? new Date().toISOString() : undefined,
      completedByUserId: status === 'done' ? responsibleUserId : undefined,
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    });
    const corruptedWalks: Walk[] = [
      mk('w-1400-today', 'e-1400-today', today, '09:00', 'done', 'user-aba'),
      mk('w-2100-today', 'e-2100-today', today, '11:00', 'done', 'user-ima'),
      mk('w-0800-today', 'e-0800-today', today, '08:00', 'skipped', 'user-eidan'),
      mk('w-1400-tmrw', 'e-1400-tmrw', tomorrow, '09:00', 'pending', 'user-aba'),
      mk('w-2100-tmrw', 'e-2100-tmrw', tomorrow, '11:00', 'pending', 'user-ima'),
      mk('w-0800-tmrw', 'e-0800-tmrw', tomorrow, '08:00', 'pending', 'user-eidan'),
    ];
    for (const w of corruptedWalks) await repository.saveWalk(w);
  }

  it('a single load() converges the already-corrupted data to the exact expected state', async () => {
    await seedCorruptedState();

    await useScheduleStore.getState().load(FAMILY_ID);
    const state = useScheduleStore.getState();

    // Today 14:00 (already passed at 14:17): historical 09:00 done walk
    // is completely untouched; no new occurrence was created.
    const histEntry1400 = state.entries.find((e) => e.id === 'e-1400-today');
    const histWalk1400 = state.walks.find((w) => w.id === 'w-1400-today');
    expect(histEntry1400?.time).toBe('09:00');
    expect(histWalk1400?.status).toBe('done');
    expect(histWalk1400?.scheduledTime).toBe('09:00');
    expect(state.entries.filter((e) => e.ruleId === 'rule-1400' && e.date === '2026-10-05')).toHaveLength(1);

    // Today 21:00 (not yet passed): historical 11:00 done walk untouched,
    // PLUS a new, separate, actionable 21:00 pending occurrence.
    const histWalk2100 = state.walks.find((w) => w.id === 'w-2100-today');
    expect(histWalk2100?.status).toBe('done');
    expect(histWalk2100?.scheduledTime).toBe('11:00');
    const newEntries2100Today = state.entries.filter((e) => e.ruleId === 'rule-2100' && e.date === '2026-10-05' && e.id !== 'e-2100-today');
    expect(newEntries2100Today).toHaveLength(1);
    const newWalk2100Today = state.walks.find((w) => w.scheduleEntryId === newEntries2100Today[0].id);
    expect(newWalk2100Today?.status).toBe('pending');
    expect(newWalk2100Today?.scheduledTime).toBe('21:00');

    // Today 08:00: untouched (was never stale).
    expect(state.entries.find((e) => e.id === 'e-0800-today')?.time).toBe('08:00');
    expect(state.walks.find((w) => w.id === 'w-0800-today')?.status).toBe('skipped');

    // Tomorrow: both stale pending entries reconciled IN PLACE (same ids).
    expect(state.entries.find((e) => e.id === 'e-1400-tmrw')?.time).toBe('14:00');
    expect(state.walks.find((w) => w.id === 'w-1400-tmrw')?.scheduledTime).toBe('14:00');
    expect(state.walks.find((w) => w.id === 'w-1400-tmrw')?.status).toBe('pending');
    expect(state.entries.find((e) => e.id === 'e-2100-tmrw')?.time).toBe('21:00');
    expect(state.walks.find((w) => w.id === 'w-2100-tmrw')?.scheduledTime).toBe('21:00');
    // No duplicates for tomorrow's reconciled entries.
    expect(state.entries.filter((e) => e.ruleId === 'rule-1400' && e.date === '2026-10-06')).toHaveLength(1);
    expect(state.entries.filter((e) => e.ruleId === 'rule-2100' && e.date === '2026-10-06')).toHaveLength(1);
    expect(state.entries.find((e) => e.id === 'e-0800-tmrw')?.time).toBe('08:00');

    // Acceptance criterion: Home's next-walk picker selects today's new 21:00 occurrence.
    const next = computeNextWalk(state.walks, new Date('2026-10-05T14:17:00'));
    expect(next?.id).toBe(newWalk2100Today?.id);
    expect(next?.scheduledTime).toBe('21:00');
    expect(next?.date).toBe('2026-10-05');
  });

  it('persists the correction to the repository, not just Zustand — a fresh getWalks()/getScheduleEntries() reflects it', async () => {
    await seedCorruptedState();
    await useScheduleStore.getState().load(FAMILY_ID);

    const { repository } = require('../../data');
    const persistedEntries: ScheduleEntry[] = await repository.getScheduleEntries(FAMILY_ID);
    const persistedWalks: Walk[] = await repository.getWalks(FAMILY_ID);

    expect(persistedEntries.find((e) => e.id === 'e-1400-tmrw')?.time).toBe('14:00');
    expect(persistedEntries.find((e) => e.id === 'e-2100-tmrw')?.time).toBe('21:00');
    const persistedNew2100Today = persistedEntries.find((e) => e.ruleId === 'rule-2100' && e.date === '2026-10-05' && e.id !== 'e-2100-today');
    expect(persistedNew2100Today).toBeTruthy();
    expect(persistedWalks.find((w) => w.scheduleEntryId === persistedNew2100Today!.id)?.status).toBe('pending');
    // Historical facts survived the round trip through the repository too.
    expect(persistedWalks.find((w) => w.id === 'w-1400-today')?.status).toBe('done');
    expect(persistedWalks.find((w) => w.id === 'w-1400-today')?.scheduledTime).toBe('09:00');
  });

  it('is idempotent across repeated loads — converges once and stays there, no duplicate entries or walks ever appear', async () => {
    await seedCorruptedState();

    await useScheduleStore.getState().load(FAMILY_ID);
    const afterFirst = useScheduleStore.getState();
    const entryCountAfterFirst = afterFirst.entries.filter((e) => e.ruleId === 'rule-1400' || e.ruleId === 'rule-2100' || e.ruleId === 'rule-0800').length;

    await useScheduleStore.getState().load(FAMILY_ID);
    await useScheduleStore.getState().load(FAMILY_ID);
    const afterRepeated = useScheduleStore.getState();
    const entryCountAfterRepeated = afterRepeated.entries.filter((e) => e.ruleId === 'rule-1400' || e.ruleId === 'rule-2100' || e.ruleId === 'rule-0800').length;

    expect(entryCountAfterRepeated).toBe(entryCountAfterFirst);
    // Still exactly one pending/actionable walk for the regenerated 21:00 today entry.
    const new2100Entries = afterRepeated.entries.filter((e) => e.ruleId === 'rule-2100' && e.date === '2026-10-05' && e.id !== 'e-2100-today');
    expect(new2100Entries).toHaveLength(1);
    expect(afterRepeated.walks.filter((w) => w.scheduleEntryId === new2100Entries[0].id)).toHaveLength(1);
    // Tomorrow's reconciled entries are still exactly one each.
    expect(afterRepeated.entries.filter((e) => e.ruleId === 'rule-1400' && e.date === '2026-10-06')).toHaveLength(1);
    expect(afterRepeated.entries.filter((e) => e.ruleId === 'rule-2100' && e.date === '2026-10-06')).toHaveLength(1);
    // History still intact.
    expect(afterRepeated.walks.find((w) => w.id === 'w-1400-today')?.status).toBe('done');
    expect(afterRepeated.walks.find((w) => w.id === 'w-2100-today')?.status).toBe('done');
  });
});
