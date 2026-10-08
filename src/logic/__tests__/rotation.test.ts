import {
  generateRotationSchedule,
  planRuleDaysReconciliation,
  planStaleRuleEntryReconciliation,
  previewRotation,
  resolveResponsibleForDate,
  ruleNeedsEntryBackfill,
} from '../rotation';
import type { ScheduleEntry, ScheduleRule } from '../../types';

function makeRule(overrides: Partial<ScheduleRule> = {}): ScheduleRule {
  return {
    id: 'rule-1',
    familyId: 'family-1',
    dogId: 'dog-1',
    time: '20:00',
    daysOfWeek: [0, 1, 2, 3, 4, 5, 6],
    rotationUserIds: ['danny', 'yael', 'noam'],
    rotationAnchorDate: '2026-08-24', // Monday
    sortOrder: 0,
    active: true,
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

describe('resolveResponsibleForDate (rotation)', () => {
  it('returns the anchor user on the anchor date', () => {
    const rule = makeRule();
    expect(resolveResponsibleForDate(rule, '2026-08-24')).toBe('danny');
  });

  it('rotates day by day: דני → יעל → נועם → דני', () => {
    const rule = makeRule();
    expect(resolveResponsibleForDate(rule, '2026-08-25')).toBe('yael');
    expect(resolveResponsibleForDate(rule, '2026-08-26')).toBe('noam');
    expect(resolveResponsibleForDate(rule, '2026-08-27')).toBe('danny');
  });

  it('returns a fixed single responsible user for every date when rotation has one member', () => {
    const rule = makeRule({ rotationUserIds: ['danny'] });
    expect(resolveResponsibleForDate(rule, '2026-08-24')).toBe('danny');
    expect(resolveResponsibleForDate(rule, '2026-09-10')).toBe('danny');
  });

  it('only counts days matching daysOfWeek when advancing the rotation', () => {
    // Rule only active on weekends (Fri=5, Sat=6); weekdays should be skipped
    // when counting whose turn it is.
    const rule = makeRule({ daysOfWeek: [5, 6], rotationAnchorDate: '2026-08-21' }); // Friday
    expect(resolveResponsibleForDate(rule, '2026-08-21')).toBe('danny'); // Fri
    expect(resolveResponsibleForDate(rule, '2026-08-22')).toBe('yael'); // Sat
    expect(resolveResponsibleForDate(rule, '2026-08-28')).toBe('noam'); // next Fri
  });

  it('throws for an empty rotation list', () => {
    const rule = makeRule({ rotationUserIds: [] });
    expect(() => resolveResponsibleForDate(rule, '2026-08-24')).toThrow();
  });

  it('throws when targetDate is before rotationAnchorDate', () => {
    const rule = makeRule({ rotationAnchorDate: '2026-08-24' });
    expect(() => resolveResponsibleForDate(rule, '2026-08-23')).toThrow(
      'targetDate must be on or after rotationAnchorDate'
    );
  });

  it('treats an empty daysOfWeek as every day (same as an explicit 0-6 list)', () => {
    const rule = makeRule({ daysOfWeek: [] });
    expect(resolveResponsibleForDate(rule, '2026-08-25')).toBe('yael');
    expect(resolveResponsibleForDate(rule, '2026-08-26')).toBe('noam');
  });
});

describe('generateRotationSchedule', () => {
  it('creates one entry per matching day in range, in rotation order', () => {
    const rule = makeRule();
    const entries = generateRotationSchedule(rule, '2026-08-24', '2026-08-28', () => 'id');
    expect(entries.map((e) => e.date)).toEqual([
      '2026-08-24',
      '2026-08-25',
      '2026-08-26',
      '2026-08-27',
      '2026-08-28',
    ]);
    expect(entries.map((e) => e.responsibleUserId)).toEqual(['danny', 'yael', 'noam', 'danny', 'yael']);
    expect(entries.every((e) => e.time === '20:00')).toBe(true);
  });

  it('skips days not in daysOfWeek', () => {
    const rule = makeRule({ daysOfWeek: [1, 3, 5] }); // Mon/Wed/Fri
    const entries = generateRotationSchedule(rule, '2026-08-24', '2026-08-30', () => 'id');
    // 2026-08-24 = Mon, 08-26 = Wed, 08-28 = Fri
    expect(entries.map((e) => e.date)).toEqual(['2026-08-24', '2026-08-26', '2026-08-28']);
  });

  it('returns an empty array when endDate precedes startDate', () => {
    const rule = makeRule();
    expect(generateRotationSchedule(rule, '2026-08-28', '2026-08-24')).toEqual([]);
  });

  it('builds example schedule 07:00 danny / 14:00 yael / 20:00 noam for a single day from three rules', () => {
    const rules = [
      makeRule({ id: 'r1', time: '07:00', rotationUserIds: ['danny'], rotationAnchorDate: '2026-08-24' }),
      makeRule({ id: 'r2', time: '14:00', rotationUserIds: ['yael'], rotationAnchorDate: '2026-08-24' }),
      makeRule({ id: 'r3', time: '20:00', rotationUserIds: ['noam'], rotationAnchorDate: '2026-08-24' }),
    ];
    const entries = rules.flatMap((r) => generateRotationSchedule(r, '2026-08-24', '2026-08-24', () => `${r.id}-e`));
    expect(entries).toHaveLength(3);
    expect(entries.map((e) => `${e.time} ${e.responsibleUserId}`)).toEqual([
      '07:00 danny',
      '14:00 yael',
      '20:00 noam',
    ]);
  });

  it('falls back to a default idFactory (prefixed with the rule id) when none is provided', () => {
    const rule = makeRule({ id: 'rule-42' });
    const entries = generateRotationSchedule(rule, '2026-08-24', '2026-08-24');
    expect(entries).toHaveLength(1);
    expect(entries[0].id.startsWith('rule-42-')).toBe(true);
  });

  it('treats an empty daysOfWeek as every day (same as an explicit 0-6 list)', () => {
    const rule = makeRule({ daysOfWeek: [] });
    const entries = generateRotationSchedule(rule, '2026-08-24', '2026-08-26', () => 'id');
    expect(entries.map((e) => e.date)).toEqual(['2026-08-24', '2026-08-25', '2026-08-26']);
  });
});

describe('previewRotation', () => {
  it('returns an empty string for an empty rotation list', () => {
    expect(previewRotation([], 3)).toBe('');
  });

  it('builds an arrow-joined preview for the requested number of turns', () => {
    expect(previewRotation(['דני', 'יעל', 'נועם'], 4)).toBe('דני → יעל → נועם → דני');
  });

  it('wraps around the rotation when turns exceeds the member count', () => {
    expect(previewRotation(['a', 'b'], 5)).toBe('a → b → a → b → a');
  });

  it('returns an empty string when turns is zero', () => {
    expect(previewRotation(['a', 'b'], 0)).toBe('');
  });
});

/**
 * Final QA round v2 — extracted from scheduleStore.ts's load() specifically
 * to prove, as a plain unit test rather than only prose, that this
 * predicate can never observe a deleted WALK — only entries. This is the
 * basis for treating a raw DELETE of a resolved scheduled walk's row (with
 * its schedule_entry row left untouched) as safe from silent regeneration.
 */
describe('ruleNeedsEntryBackfill', () => {
  const rule = makeRule({ id: 'rule-1', active: true });
  const today = '2026-08-24';

  function makeEntry(overrides: Partial<ScheduleEntry> = {}): ScheduleEntry {
    return {
      id: 'entry-1',
      familyId: 'family-1',
      ruleId: 'rule-1',
      dogId: 'dog-1',
      date: '2026-08-24',
      time: '20:00',
      responsibleUserId: 'danny',
      createdAt: new Date().toISOString(),
      ...overrides,
    };
  }

  it('is true when an active rule has zero entries at or after today', () => {
    expect(ruleNeedsEntryBackfill(rule, [], today)).toBe(true);
    expect(ruleNeedsEntryBackfill(rule, [makeEntry({ date: '2026-08-20' })], today)).toBe(true);
  });

  it('is false when the rule already has at least one entry at or after today — regardless of whether any walk exists for it', () => {
    // No `walks` array is passed at all — this predicate has no way to
    // know a walk was deleted. Deleting a walk (never its schedule_entry)
    // therefore can never make this predicate flip to true.
    expect(ruleNeedsEntryBackfill(rule, [makeEntry({ date: today })], today)).toBe(false);
    expect(ruleNeedsEntryBackfill(rule, [makeEntry({ date: '2026-09-01' })], today)).toBe(false);
  });

  it('is false for an inactive rule even with zero future entries (nothing to backfill)', () => {
    expect(ruleNeedsEntryBackfill(makeRule({ active: false }), [], today)).toBe(false);
  });

  it('only counts entries belonging to the same rule', () => {
    expect(ruleNeedsEntryBackfill(rule, [makeEntry({ ruleId: 'some-other-rule', date: today })], today)).toBe(true);
  });
});

/**
 * Regression coverage for a real, first-discovered bug: updateRule() in
 * scheduleStore.ts previously recomputed time/responsibleUserId for every
 * already-generated future entry on a daysOfWeek edit, but never removed an
 * entry whose day was just disabled nor generated one for a day just
 * enabled — a day dropped from the rule (e.g. an admin turning off
 * Saturday for Shabbat) kept its already-generated future walk/reminder
 * alive for up to GENERATE_DAYS_AHEAD days, and a day added to the rule got
 * no entries until the rule's entire window emptied out and the unrelated
 * ruleNeedsEntryBackfill()-driven regen eventually caught up.
 */
describe('planRuleDaysReconciliation', () => {
  const today = '2026-08-24'; // Monday
  const endDate = '2026-08-30'; // following Sunday

  function makeEntry(overrides: Partial<ScheduleEntry> = {}): ScheduleEntry {
    return {
      id: `entry-${overrides.date ?? today}`,
      familyId: 'family-1',
      ruleId: 'rule-1',
      dogId: 'dog-1',
      date: today,
      time: '20:00',
      responsibleUserId: 'danny',
      createdAt: new Date().toISOString(),
      ...overrides,
    };
  }

  it('is a no-op when daysOfWeek is unchanged: entries just get their time/responsibleUserId recomputed', () => {
    const previousRule = makeRule({ daysOfWeek: [0, 1, 2, 3, 4, 5, 6] });
    const updatedRule = makeRule({ daysOfWeek: [0, 1, 2, 3, 4, 5, 6], time: '21:00' });
    const entries = [makeEntry({ date: '2026-08-24', time: '20:00' }), makeEntry({ id: 'entry-2', date: '2026-08-25', time: '20:00' })];

    const plan = planRuleDaysReconciliation(previousRule, updatedRule, entries, today, endDate);

    expect(plan.toRemove).toEqual([]);
    expect(plan.toAdd).toEqual([]);
    expect(plan.toUpdate.map((e) => e.date).sort()).toEqual(['2026-08-24', '2026-08-25']);
    expect(plan.toUpdate.every((e) => e.time === '21:00')).toBe(true);
  });

  it('removes a future entry whose day was just dropped from the rule (Saturday turned off), keeps the rest in toUpdate', () => {
    const previousRule = makeRule({ daysOfWeek: [0, 1, 2, 3, 4, 5, 6] });
    const updatedRule = makeRule({ daysOfWeek: [0, 1, 2, 3, 4, 5] }); // Saturday (6) dropped
    const entries = [
      makeEntry({ id: 'entry-mon', date: '2026-08-24' }), // Monday, stays active
      makeEntry({ id: 'entry-sat', date: '2026-08-29' }), // Saturday, just disabled
    ];

    const plan = planRuleDaysReconciliation(previousRule, updatedRule, entries, today, endDate);

    expect(plan.toRemove.map((e) => e.id)).toEqual(['entry-sat']);
    expect(plan.toUpdate.map((e) => e.id)).toEqual(['entry-mon']);
    expect(plan.toAdd).toEqual([]);
  });

  it('generates entries for a day just added to the rule, within the window', () => {
    const previousRule = makeRule({ daysOfWeek: [1, 3, 5] }); // Mon/Wed/Fri
    const updatedRule = makeRule({ daysOfWeek: [0, 1, 2, 3, 4, 5, 6] }); // every day
    const entries = [
      makeEntry({ id: 'entry-mon', date: '2026-08-24' }),
      makeEntry({ id: 'entry-wed', date: '2026-08-26' }),
      makeEntry({ id: 'entry-fri', date: '2026-08-28' }),
    ];

    const plan = planRuleDaysReconciliation(previousRule, updatedRule, entries, today, endDate, () => 'id');

    expect(plan.toRemove).toEqual([]);
    // Mon/Wed/Fri already existed and still match -> updated in place, not duplicated.
    expect(plan.toUpdate.map((e) => e.id).sort()).toEqual(['entry-fri', 'entry-mon', 'entry-wed']);
    // Tue/Thu/Sat/Sun are newly active and had no entry yet.
    expect(plan.toAdd.map((e) => e.date).sort()).toEqual(['2026-08-25', '2026-08-27', '2026-08-29', '2026-08-30']);
  });

  it('does NOT resurrect a deliberately-deleted single occurrence on a day active both before and after the edit', () => {
    // Monday was already active before this edit; its one entry was
    // presumably deleted on purpose (scheduleStore.ts's deleteEntry).
    // Adding Wednesday to the rule must only create the Wednesday entry.
    const previousRule = makeRule({ daysOfWeek: [1] }); // Monday only
    const updatedRule = makeRule({ daysOfWeek: [1, 3] }); // Monday + Wednesday
    const entries: ScheduleEntry[] = []; // Monday's entry is gone

    const plan = planRuleDaysReconciliation(previousRule, updatedRule, entries, today, endDate, () => 'id');

    expect(plan.toRemove).toEqual([]);
    expect(plan.toUpdate).toEqual([]);
    expect(plan.toAdd.map((e) => e.date)).toEqual(['2026-08-26']); // Wednesday only, not Monday
  });

  it('does not add a newly-active day that already has an entry (defensive dedup)', () => {
    const previousRule = makeRule({ daysOfWeek: [1] }); // Monday only
    const updatedRule = makeRule({ daysOfWeek: [1, 3] }); // Monday + Wednesday
    const entries = [makeEntry({ id: 'entry-wed', ruleId: 'rule-1', date: '2026-08-26' })]; // already has a Wednesday entry

    const plan = planRuleDaysReconciliation(previousRule, updatedRule, entries, today, endDate, () => 'id');

    expect(plan.toAdd).toEqual([]);
    expect(plan.toUpdate.map((e) => e.id)).toEqual(['entry-wed']);
  });

  it('only reconciles entries belonging to the same rule', () => {
    const previousRule = makeRule({ daysOfWeek: [0, 1, 2, 3, 4, 5, 6] });
    const updatedRule = makeRule({ daysOfWeek: [0, 1, 2, 3, 4, 5] }); // Saturday dropped
    const entries = [makeEntry({ id: 'other-rule-sat', ruleId: 'some-other-rule', date: '2026-08-29' })];

    const plan = planRuleDaysReconciliation(previousRule, updatedRule, entries, today, endDate);

    expect(plan.toRemove).toEqual([]);
    expect(plan.toUpdate).toEqual([]);
    expect(plan.toAdd).toEqual([]);
  });

  it('ignores past entries (date before today)', () => {
    const previousRule = makeRule({ daysOfWeek: [0, 1, 2, 3, 4, 5, 6] });
    const updatedRule = makeRule({ daysOfWeek: [0, 1, 2, 3, 4, 5] }); // Saturday dropped
    const entries = [makeEntry({ id: 'past-sat', date: '2026-08-22' })]; // a past Saturday

    const plan = planRuleDaysReconciliation(previousRule, updatedRule, entries, today, endDate);

    expect(plan.toRemove).toEqual([]);
    expect(plan.toUpdate).toEqual([]);
  });

  /**
   * P0 real-device fix — real-iPhone QA: editing a rule's time (09:00 ->
   * 14:00) after today's occurrence under the OLD time had already been
   * completed left today's entry stuck at 09:00 forever, with no new
   * actionable occurrence ever created. Root cause: the pre-fix version of
   * this function blindly mutated EVERY future entry's time in place,
   * including one whose walk was already 'done' — rewriting completed
   * history — while the caller (scheduleStore.updateRule) correctly
   * refuses to touch a non-'pending' walk, leaving the entry and its done
   * walk disagreeing with no new occurrence to show. These tests cover the
   * `currentWalks` parameter that fixes it.
   */
  describe('with currentWalks — locked (already-resolved) entries are never mutated', () => {
    it('a date whose only entry has a done walk is left untouched, and a fresh pending entry is regenerated for it instead', () => {
      const previousRule = makeRule({ time: '09:00' });
      const updatedRule = makeRule({ time: '14:00' });
      const entries = [makeEntry({ id: 'entry-today', date: today, time: '09:00' })];
      const walks = [{ scheduleEntryId: 'entry-today', status: 'done' as const }];

      const plan = planRuleDaysReconciliation(previousRule, updatedRule, entries, today, endDate, () => 'entry-fresh', walks);

      expect(plan.toUpdate).toEqual([]);
      expect(plan.toRegenerate).toHaveLength(1);
      expect(plan.toRegenerate[0]).toMatchObject({ id: 'entry-fresh', date: today, time: '14:00' });
      // The original entry is not present anywhere in the output — it was
      // never touched, matching the "never rewrite completed history" requirement.
      expect(plan.toRemove.find((e) => e.id === 'entry-today')).toBeUndefined();
    });

    it('a date whose only entry has an in_progress walk is also locked', () => {
      const previousRule = makeRule({ time: '09:00' });
      const updatedRule = makeRule({ time: '14:00' });
      const entries = [makeEntry({ id: 'entry-today', date: today, time: '09:00' })];
      const walks = [{ scheduleEntryId: 'entry-today', status: 'in_progress' as const }];

      const plan = planRuleDaysReconciliation(previousRule, updatedRule, entries, today, endDate, () => 'entry-fresh', walks);

      expect(plan.toUpdate).toEqual([]);
      expect(plan.toRegenerate).toHaveLength(1);
    });

    it('a pending walk is still updated in place, same as with no currentWalks given at all', () => {
      const previousRule = makeRule({ time: '09:00' });
      const updatedRule = makeRule({ time: '14:00' });
      const entries = [makeEntry({ id: 'entry-today', date: today, time: '09:00' })];
      const walks = [{ scheduleEntryId: 'entry-today', status: 'pending' as const }];

      const plan = planRuleDaysReconciliation(previousRule, updatedRule, entries, today, endDate, () => 'entry-fresh', walks);

      expect(plan.toRegenerate).toEqual([]);
      expect(plan.toUpdate).toHaveLength(1);
      expect(plan.toUpdate[0]).toMatchObject({ id: 'entry-today', time: '14:00' });
    });

    it('an entry with no matching walk at all is treated as freely mutable (not locked)', () => {
      const previousRule = makeRule({ time: '09:00' });
      const updatedRule = makeRule({ time: '14:00' });
      const entries = [makeEntry({ id: 'entry-today', date: today, time: '09:00' })];

      const plan = planRuleDaysReconciliation(previousRule, updatedRule, entries, today, endDate, () => 'entry-fresh', []);

      expect(plan.toRegenerate).toEqual([]);
      expect(plan.toUpdate).toHaveLength(1);
    });

    it('re-editing the rule again after a regenerated entry exists updates the NEW pending entry in place, never regenerating a second one', () => {
      const previousRule = makeRule({ time: '14:00' });
      const updatedRule = makeRule({ time: '18:00' });
      // Simulates the state right after the FIRST edit's regeneration: the
      // old done entry is still there (history), plus the fresh pending one.
      const entries = [
        makeEntry({ id: 'entry-today-old', date: today, time: '09:00' }),
        makeEntry({ id: 'entry-today-fresh', date: today, time: '14:00' }),
      ];
      const walks = [
        { scheduleEntryId: 'entry-today-old', status: 'done' as const },
        { scheduleEntryId: 'entry-today-fresh', status: 'pending' as const },
      ];

      const plan = planRuleDaysReconciliation(previousRule, updatedRule, entries, today, endDate, () => 'entry-should-not-be-used', walks);

      expect(plan.toRegenerate).toEqual([]);
      expect(plan.toUpdate).toHaveLength(1);
      expect(plan.toUpdate[0]).toMatchObject({ id: 'entry-today-fresh', time: '18:00' });
    });

    it('omitting currentWalks entirely (legacy call shape) behaves exactly as if nothing were locked', () => {
      const previousRule = makeRule({ time: '09:00' });
      const updatedRule = makeRule({ time: '14:00' });
      const entries = [makeEntry({ id: 'entry-today', date: today, time: '09:00' })];

      const plan = planRuleDaysReconciliation(previousRule, updatedRule, entries, today, endDate);

      expect(plan.toRegenerate).toEqual([]);
      expect(plan.toUpdate).toHaveLength(1);
    });
  });
});

/**
 * P0 real-device fix, self-heal round — reproduces the exact real-device
 * evidence: three active rules (14:00, 21:00, 08:00) whose schedule_entries
 * were left stale by edits made before 807e4db shipped (so no further rule
 * edit will ever correct them on its own — see planStaleRuleEntryReconciliation's
 * own doc comment). "now" is 14:17, so the 14:00 rule's time for today has
 * already passed, while 21:00 has not.
 */
describe('planStaleRuleEntryReconciliation', () => {
  const today = '2026-10-05';
  const tomorrow = '2026-10-06';
  const endDate = '2026-10-19';
  const now = new Date('2026-10-05T14:17:00');

  const rule1400 = (overrides: Partial<ScheduleRule> = {}): ScheduleRule =>
    makeRule({ id: 'rule-1400', time: '14:00', rotationUserIds: ['user-a'], rotationAnchorDate: '2026-09-01', ...overrides });
  const rule2100 = (overrides: Partial<ScheduleRule> = {}): ScheduleRule =>
    makeRule({ id: 'rule-2100', time: '21:00', rotationUserIds: ['user-b'], rotationAnchorDate: '2026-09-01', ...overrides });
  const rule0800 = (overrides: Partial<ScheduleRule> = {}): ScheduleRule =>
    makeRule({ id: 'rule-0800', time: '08:00', rotationUserIds: ['user-c'], rotationAnchorDate: '2026-09-01', ...overrides });

  function entry(overrides: Partial<ScheduleEntry>): ScheduleEntry {
    return {
      id: 'e', familyId: 'family-1', dogId: 'dog-1', date: today, time: '00:00',
      responsibleUserId: 'user-a', createdAt: new Date().toISOString(), ...overrides,
    };
  }

  it('reproduces the exact reported state and converges to the exact expected result', () => {
    const rules = [rule1400(), rule2100(), rule0800()];
    const entries: ScheduleEntry[] = [
      // today
      entry({ id: 'e-1400-today', ruleId: 'rule-1400', date: today, time: '09:00' }), // stale, done
      entry({ id: 'e-2100-today', ruleId: 'rule-2100', date: today, time: '11:00' }), // stale, done
      entry({ id: 'e-0800-today', ruleId: 'rule-0800', date: today, time: '08:00' }), // NOT stale, skipped
      // tomorrow
      entry({ id: 'e-1400-tmrw', ruleId: 'rule-1400', date: tomorrow, time: '09:00' }), // stale, pending
      entry({ id: 'e-2100-tmrw', ruleId: 'rule-2100', date: tomorrow, time: '11:00' }), // stale, pending
      entry({ id: 'e-0800-tmrw', ruleId: 'rule-0800', date: tomorrow, time: '08:00' }), // NOT stale, pending
    ];
    const walks = [
      { scheduleEntryId: 'e-1400-today', status: 'done' as const },
      { scheduleEntryId: 'e-2100-today', status: 'done' as const },
      { scheduleEntryId: 'e-0800-today', status: 'skipped' as const },
      { scheduleEntryId: 'e-1400-tmrw', status: 'pending' as const },
      { scheduleEntryId: 'e-2100-tmrw', status: 'pending' as const },
      { scheduleEntryId: 'e-0800-tmrw', status: 'pending' as const },
    ];

    let idCounter = 0;
    const plan = planStaleRuleEntryReconciliation(rules, entries, walks, today, endDate, now, () => `regen-${++idCounter}`);

    // Today 14:00: already passed at 14:17, and the only entry is locked
    // (done) — no new occurrence; the historical 09:00 done record is
    // untouched (not even present in toUpdate/toRegenerate).
    expect(plan.toRegenerate.some((e) => e.ruleId === 'rule-1400' && e.date === today)).toBe(false);
    expect(plan.toUpdate.some((e) => e.id === 'e-1400-today')).toBe(false);

    // Today 21:00: locked (done) but 21:00 hasn't passed yet — a fresh
    // pending occurrence is generated for today.
    const regen2100Today = plan.toRegenerate.find((e) => e.ruleId === 'rule-2100' && e.date === today);
    expect(regen2100Today).toBeTruthy();
    expect(regen2100Today?.time).toBe('21:00');

    // Today 08:00: already correctly represented (skipped, but time
    // matches) — untouched.
    expect(plan.toUpdate.some((e) => e.id === 'e-0800-today')).toBe(false);
    expect(plan.toRegenerate.some((e) => e.ruleId === 'rule-0800' && e.date === today)).toBe(false);

    // Tomorrow 14:00/21:00: stale but still PENDING (open, not locked) —
    // updated in place, not regenerated.
    const upd1400Tmrw = plan.toUpdate.find((e) => e.id === 'e-1400-tmrw');
    const upd2100Tmrw = plan.toUpdate.find((e) => e.id === 'e-2100-tmrw');
    expect(upd1400Tmrw?.time).toBe('14:00');
    expect(upd2100Tmrw?.time).toBe('21:00');
    expect(plan.toRegenerate.some((e) => e.date === tomorrow)).toBe(false);

    // Tomorrow 08:00: already correct — untouched.
    expect(plan.toUpdate.some((e) => e.id === 'e-0800-tmrw')).toBe(false);
  });

  it('is idempotent: re-running on the already-converged result produces an empty plan', () => {
    const rules = [rule1400(), rule2100(), rule0800()];
    // Start from what the FIRST run above would converge to.
    const entries: ScheduleEntry[] = [
      entry({ id: 'e-1400-today', ruleId: 'rule-1400', date: today, time: '09:00' }), // stays — 14:00 already passed
      entry({ id: 'e-2100-today', ruleId: 'rule-2100', date: today, time: '11:00' }), // old done record, preserved
      entry({ id: 'e-2100-today-fresh', ruleId: 'rule-2100', date: today, time: '21:00' }), // regenerated
      entry({ id: 'e-0800-today', ruleId: 'rule-0800', date: today, time: '08:00' }),
      entry({ id: 'e-1400-tmrw', ruleId: 'rule-1400', date: tomorrow, time: '14:00' }), // already reconciled
      entry({ id: 'e-2100-tmrw', ruleId: 'rule-2100', date: tomorrow, time: '21:00' }), // already reconciled
      entry({ id: 'e-0800-tmrw', ruleId: 'rule-0800', date: tomorrow, time: '08:00' }),
    ];
    const walks = [
      { scheduleEntryId: 'e-1400-today', status: 'done' as const },
      { scheduleEntryId: 'e-2100-today', status: 'done' as const },
      { scheduleEntryId: 'e-2100-today-fresh', status: 'pending' as const },
      { scheduleEntryId: 'e-0800-today', status: 'skipped' as const },
      { scheduleEntryId: 'e-1400-tmrw', status: 'pending' as const },
      { scheduleEntryId: 'e-2100-tmrw', status: 'pending' as const },
      { scheduleEntryId: 'e-0800-tmrw', status: 'pending' as const },
    ];

    const plan = planStaleRuleEntryReconciliation(rules, entries, walks, today, endDate, now, () => 'should-not-be-used');

    expect(plan.toUpdate).toEqual([]);
    expect(plan.toRegenerate).toEqual([]);
  });

  it('ignores entries belonging to an inactive rule', () => {
    const rules = [rule1400({ active: false })];
    const entries = [entry({ id: 'e-1400-today', ruleId: 'rule-1400', date: today, time: '09:00' })];
    const walks = [{ scheduleEntryId: 'e-1400-today', status: 'done' as const }];

    const plan = planStaleRuleEntryReconciliation(rules, entries, walks, today, endDate, now);

    expect(plan.toUpdate).toEqual([]);
    expect(plan.toRegenerate).toEqual([]);
  });

  it('a future date whose only entry is locked and stale always regenerates (its time cannot have "already passed")', () => {
    const rules = [rule1400()];
    const entries = [entry({ id: 'e-1400-tmrw-done', ruleId: 'rule-1400', date: tomorrow, time: '09:00' })];
    const walks = [{ scheduleEntryId: 'e-1400-tmrw-done', status: 'done' as const }];

    const plan = planStaleRuleEntryReconciliation(rules, entries, walks, today, endDate, now, () => 'fresh-tmrw');

    expect(plan.toRegenerate).toHaveLength(1);
    expect(plan.toRegenerate[0]).toMatchObject({ date: tomorrow, time: '14:00', ruleId: 'rule-1400' });
  });

  // P0 BUG FIX — real-device report: editing a scheduled walk's time via
  // EditWalkModal (scheduleStore.rescheduleWalk / admin_reschedule_walk)
  // did not survive an app restart. Root cause: a deliberate one-off
  // per-occurrence time edit makes entry.time diverge from its rule's
  // time by design (see ScheduleEntry.time's own doc comment), which this
  // function's `time !== rule.time` staleness test could not tell apart
  // from a genuine pre-807e4db stale leftover — so it silently reverted
  // every deliberate edit back to the rule's time on the very next load.
  // The fix: an entry with `timeOverridden: true` is now always treated
  // as correctly represented, regardless of its time value.
  it('never reverts a deliberately overridden entry, even though its time differs from the rule (the P0 bug)', () => {
    const rules = [rule1400()];
    const entries = [
      entry({ id: 'e-1400-tmrw', ruleId: 'rule-1400', date: tomorrow, time: '14:05', timeOverridden: true }),
    ];
    const walks = [{ scheduleEntryId: 'e-1400-tmrw', status: 'pending' as const }];

    const plan = planStaleRuleEntryReconciliation(rules, entries, walks, today, endDate, now);

    expect(plan.toUpdate).toEqual([]);
    expect(plan.toRegenerate).toEqual([]);
  });

  it('still reconciles a genuinely stale entry that was never overridden, alongside an unrelated overridden one for a different rule', () => {
    const rules = [rule1400(), rule2100()];
    const entries = [
      // Genuinely stale (pre-807e4db leftover) — no timeOverridden flag.
      entry({ id: 'e-1400-tmrw', ruleId: 'rule-1400', date: tomorrow, time: '09:00' }),
      // Deliberately overridden — must survive untouched.
      entry({ id: 'e-2100-tmrw', ruleId: 'rule-2100', date: tomorrow, time: '21:30', timeOverridden: true }),
    ];
    const walks = [
      { scheduleEntryId: 'e-1400-tmrw', status: 'pending' as const },
      { scheduleEntryId: 'e-2100-tmrw', status: 'pending' as const },
    ];

    const plan = planStaleRuleEntryReconciliation(rules, entries, walks, today, endDate, now);

    expect(plan.toUpdate).toHaveLength(1);
    expect(plan.toUpdate[0]).toMatchObject({ id: 'e-1400-tmrw', time: '14:00' });
    expect(plan.toRegenerate).toEqual([]);
  });
});
