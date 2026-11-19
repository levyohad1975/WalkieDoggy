/**
 * Field report 2026-11-19: Thursday's 22:00 walk did not exist although the
 * routine grid showed it. Entries were generated only on rule edits or when a
 * rule had no upcoming entry at all, so the horizon never rolled forward and
 * gaps left by an edit were never filled.
 */
import { missingRuleOccurrences } from '../rotation';
import type { ScheduleEntry, ScheduleRule } from '../../types';

const rule: ScheduleRule = {
  id: 'rule-idan-2200', familyId: 'f', dogId: 'dog', time: '22:00', daysOfWeek: [0, 2, 4, 6],
  rotationUserIds: ['idan'], rotationAnchorDate: '2026-11-01', active: true, createdAt: '2026-11-01T00:00:00Z',
} as ScheduleRule;
const entry = (date: string, time = '22:00', ruleId: string | undefined = rule.id): Pick<ScheduleEntry, 'ruleId' | 'dogId' | 'date' | 'time'> =>
  ({ ruleId, dogId: 'dog', date, time });

describe('missingRuleOccurrences', () => {
  it('fills a gap inside the horizon and rolls it forward', () => {
    // 2026-11-19 is a Thursday. Existing: Sat 21 and Sun 15 (past). Missing: Thu 19, Sun 22, Tue 24, Thu 26...
    const missing = missingRuleOccurrences(rule, [entry('2026-11-21'), entry('2026-11-28')], '2026-11-19', '2026-11-29');
    expect(missing.map((e) => e.date)).toEqual(['2026-11-19', '2026-11-22', '2026-11-24', '2026-11-26', '2026-11-29']);
    expect(missing.every((e) => e.time === '22:00' && e.ruleId === rule.id && e.responsibleUserId === 'idan')).toBe(true);
  });

  it('a slot taken by another rule (or a legacy entry) at the same time is covered', () => {
    const missing = missingRuleOccurrences(rule, [entry('2026-11-19', '22:00', 'other-rule')], '2026-11-19', '2026-11-19');
    expect(missing).toEqual([]);
  });

  it('a one-off time change of this rule on that date does not bring the original slot back', () => {
    const missing = missingRuleOccurrences(rule, [entry('2026-11-19', '23:15')], '2026-11-19', '2026-11-19');
    expect(missing).toEqual([]);
  });

  it('ignores another dog, inactive rules and empty rotations', () => {
    expect(missingRuleOccurrences(rule, [{ ...entry('2026-11-19', '22:00', 'other-dog-rule'), dogId: 'other-dog' }], '2026-11-19', '2026-11-19')).toHaveLength(1);
    expect(missingRuleOccurrences({ ...rule, active: false }, [], '2026-11-19', '2026-11-26')).toEqual([]);
    expect(missingRuleOccurrences({ ...rule, rotationUserIds: [] }, [], '2026-11-19', '2026-11-26')).toEqual([]);
  });

  it('a rotation anchored in the future starts at its anchor instead of throwing', () => {
    const rotating = { ...rule, rotationUserIds: ['a', 'b'], rotationAnchorDate: '2026-11-22', daysOfWeek: [0, 1, 2, 3, 4, 5, 6] };
    const missing = missingRuleOccurrences(rotating, [], '2026-11-19', '2026-11-24');
    expect(missing.map((e) => [e.date, e.responsibleUserId])).toEqual([['2026-11-22', 'a'], ['2026-11-23', 'b'], ['2026-11-24', 'a']]);
  });
});
