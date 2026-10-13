import type { ScheduleRule } from '../../types';

/**
 * Real-device QA fix — "Schedule save false failure / double-tap bug".
 *
 * Real sequence on a real iPhone: tapping "שמירה" on the schedule-rule
 * form twice before the first save had visibly responded fired TWO
 * independent addRule() calls for the identical time slot (RuleFormModal
 * had no busy/disabled state — see RuleFormModal.doubleTapGuard.test.ts
 * for that half of the fix). Each call gets its own fresh rule id
 * (ScheduleScreen.tsx's generateId('rule')), so the two inserts never
 * collide on `id` — they collide on migration 0099's
 * schedule_rules_active_identity_uidx instead, a unique index on every
 * OTHER identity column (family_id, dog_id, time, days_of_week,
 * rotation_user_ids, rotation_anchor_date) where active = true. The FIRST
 * insert actually succeeds; the SECOND throws a raw Postgres "duplicate
 * key" error with no entry in errorMessages.ts's table, which used to
 * fall back to the generic "לא הצלחנו להוסיף את שעת הטיול" for a save
 * that, in truth, had already worked.
 *
 * This suite exercises addRule()'s own defense-in-depth handling of that
 * specific constraint violation (kept even though RuleFormModal's own fix
 * already prevents the double-tap at its source — see
 * isDuplicateActiveScheduleRuleError()'s own doc comment in
 * scheduleStore.ts for why).
 */
describe('scheduleStore.addRule — duplicate-active-rule constraint (double-tap defense-in-depth)', () => {
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

  function duplicateRule(id: string, before: number): ScheduleRule {
    return {
      id,
      familyId: FAMILY_ID,
      dogId: 'dog-topi',
      time: '11:00',
      daysOfWeek: [0, 1, 2, 3, 4, 5, 6],
      rotationUserIds: ['user-aba'],
      rotationAnchorDate: '2026-08-27',
      sortOrder: before,
      active: true,
      createdAt: new Date().toISOString(),
    };
  }

  it('a schedule_rules_active_identity_uidx violation is reported as success (reloads, clears actionError) instead of a scary "couldn\'t add" error', async () => {
    await useScheduleStore.getState().load(FAMILY_ID);
    const { repository } = require('../../data');
    const before = useScheduleStore.getState().rules.length;

    const constraintError = {
      message: 'duplicate key value violates unique constraint "schedule_rules_active_identity_uidx"',
      code: '23505',
    };
    const spy = jest.spyOn(repository, 'upsertScheduleRule').mockRejectedValueOnce(constraintError);
    const loadSpy = jest.spyOn(useScheduleStore.getState(), 'load');

    await useScheduleStore.getState().addRule(duplicateRule('rule-second-tap', before));

    const state = useScheduleStore.getState();
    expect(state.actionError).toBeNull(); // never the misleading "לא הצלחנו להוסיף את שעת הטיול"
    expect(loadSpy).toHaveBeenCalledWith(FAMILY_ID); // refreshed from the server so the (already-successful) first add is reflected

    spy.mockRestore();
    loadSpy.mockRestore();
  });

  it('any OTHER repository failure still surfaces the normal, visible actionError — this fix is scoped only to the duplicate-identity constraint', async () => {
    await useScheduleStore.getState().load(FAMILY_ID);
    const { repository } = require('../../data');
    const before = useScheduleStore.getState().rules.length;
    const spy = jest.spyOn(repository, 'upsertScheduleRule').mockRejectedValueOnce(new Error('network down'));

    await useScheduleStore.getState().addRule(duplicateRule('rule-genuine-failure', before));

    const state = useScheduleStore.getState();
    expect(state.rules).toHaveLength(before); // nothing added
    expect(state.actionError).toBe('לא הצלחנו להוסיף את שעת הטיול');

    spy.mockRestore();
  });
});
