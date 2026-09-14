import {
  generateRotationSchedule,
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
