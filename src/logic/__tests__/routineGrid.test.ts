import { buildRoutineRows, planCellAssignment, weeklyLoad } from '../routineGrid';
import type { ScheduleRule } from '../../types';

const rule = (id: string, time: string, days: number[], users: string[], active = true): ScheduleRule => ({
  id, familyId: 'f', dogId: 'd', time, daysOfWeek: days, rotationUserIds: users,
  rotationAnchorDate: '2026-11-01', sortOrder: 0, active, createdAt: '2026-11-01T00:00:00Z',
});

// The real family routine of 2026-11-09 (8 rules).
const rules = [
  rule('r1', '08:00', [0, 1, 2, 3, 4, 5, 6], ['aba']),
  rule('r2', '13:30', [0, 2, 3, 5], ['maor']),
  rule('r3', '13:30', [1, 4, 6], ['hadar']),
  rule('r4', '18:00', [4, 6], ['idan']),
  rule('r5', '18:00', [0, 2], ['omer']),
  rule('r6', '18:00', [1, 3], ['idan']),
  rule('r7', '22:00', [0, 2, 4, 5], ['idan']),
  rule('r8', '22:00', [1, 3, 6], ['omer']),
];

describe('routine grid', () => {
  it('shows 8 rules as 4 times × 7 days, with the Friday 18:00 gap', () => {
    const rows = buildRoutineRows(rules);
    expect(rows.map((r) => r.time)).toEqual(['08:00', '13:30', '18:00', '22:00']);
    expect(rows[2].cells.map((c) => (c && c.kind === 'person' ? c.userId : null))).toEqual(['omer', 'idan', 'omer', 'idan', 'idan', null, 'idan']);
    const load = weeklyLoad(rows);
    expect(load.byUser).toEqual({ aba: 7, maor: 4, hadar: 3, idan: 8, omer: 5 });
    expect(load.empty).toBe(1);
  });

  it('fills an empty cell by extending the person\'s rule at that time', () => {
    expect(planCellAssignment(rules, '18:00', [5], 'omer')).toEqual([{ type: 'update', ruleId: 'r5', daysOfWeek: [0, 2, 5] }]);
  });

  it('moves a day: removes it from the old rule first, then adds it to the new person', () => {
    expect(planCellAssignment(rules, '13:30', [1], 'maor')).toEqual([
      { type: 'update', ruleId: 'r3', daysOfWeek: [4, 6] },
      { type: 'update', ruleId: 'r2', daysOfWeek: [0, 1, 2, 3, 5] },
    ]);
  });

  it('merges one person\'s duplicate rules at the same time', () => {
    expect(planCellAssignment(rules, '18:00', [4], 'idan')).toEqual([
      { type: 'delete', ruleId: 'r6' },
      { type: 'update', ruleId: 'r4', daysOfWeek: [1, 3, 4, 6] },
    ]);
  });

  it('"every day at this time" and "no walk"', () => {
    expect(planCellAssignment(rules, '22:00', [0, 1, 2, 3, 4, 5, 6], 'omer')).toEqual([
      { type: 'delete', ruleId: 'r7' },
      { type: 'update', ruleId: 'r8', daysOfWeek: [0, 1, 2, 3, 4, 5, 6] },
    ]);
    expect(planCellAssignment(rules, '08:00', [6], null)).toEqual([{ type: 'update', ruleId: 'r1', daysOfWeek: [0, 1, 2, 3, 4, 5] }]);
    expect(planCellAssignment(rules, '13:30', [1, 4, 6], null)).toEqual([{ type: 'delete', ruleId: 'r3' }]);
  });

  it('a new person at a time creates a rule; an unchanged cell does nothing', () => {
    expect(planCellAssignment(rules, '08:00', [0], 'ima')).toEqual([
      { type: 'update', ruleId: 'r1', daysOfWeek: [1, 2, 3, 4, 5, 6] },
      { type: 'add', time: '08:00', daysOfWeek: [0], userId: 'ima' },
    ]);
    expect(planCellAssignment(rules, '08:00', [3], 'aba')).toEqual([]);
  });

  it('ignores inactive rules and keeps rotation rules as their own cells', () => {
    const rows = buildRoutineRows([rule('x', '07:00', [1], ['a']), rule('y', '09:00', [2], ['a', 'b']), rule('z', '10:00', [3], ['a'], false)]);
    expect(rows.map((r) => r.time)).toEqual(['07:00', '09:00']);
    expect(rows[1].cells[2]).toEqual({ kind: 'rotation', ruleId: 'y', userIds: ['a', 'b'] });
  });
});
