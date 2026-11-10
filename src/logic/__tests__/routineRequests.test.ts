import { planCellAssignment } from '../routineGrid';
import {
  describeRoutineRequest,
  openRequestCellKeys,
  routineRequestState,
  routineRequestSteps,
  type RoutineChangeRequest,
} from '../routineRequests';
import type { ScheduleRule } from '../../types';

const rule = (id: string, time: string, days: number[], users: string[]): ScheduleRule => ({
  id, familyId: 'f', dogId: 'd', time, daysOfWeek: days, rotationUserIds: users,
  rotationAnchorDate: '2026-11-01', sortOrder: 0, active: true, createdAt: '2026-11-01T00:00:00Z',
});

const base = [
  rule('r2', '13:30', [0, 2, 3, 5], ['maor']),
  rule('r3', '13:30', [1, 4, 6], ['hadar']),
  rule('r5', '18:00', [0, 2], ['omer']),
  rule('r6', '18:00', [1, 3, 4, 6], ['idan']),
];

const req = (over: Partial<RoutineChangeRequest>): RoutineChangeRequest => ({
  id: 'q', familyId: 'f', dogId: 'd', requesterUserId: 'maor', targetUserId: 'hadar', kind: 'swap',
  myDay: 0, myTime: '13:30', theirDay: 1, theirTime: '13:30', newTime: null, note: null,
  status: 'pending_admin', createdAt: '2026-11-10T08:00:00Z', decidedAt: null, ...over,
});

/** Apply a request the way the admin's device does: step by step on fresh rules. */
function apply(rules: ScheduleRule[], r: RoutineChangeRequest): ScheduleRule[] {
  let current = rules.map((x) => ({ ...x, daysOfWeek: [...x.daysOfWeek] }));
  let n = 0;
  for (const step of routineRequestSteps(r)) {
    for (const op of planCellAssignment(current, step.time, [step.day], step.userId)) {
      if (op.type === 'delete') current = current.filter((x) => x.id !== op.ruleId);
      else if (op.type === 'update') current = current.map((x) => (x.id === op.ruleId ? { ...x, daysOfWeek: op.daysOfWeek } : x));
      else current = [...current, rule(`new${n++}`, op.time, op.daysOfWeek, [op.userId])];
    }
  }
  return current;
}

describe('routine change requests', () => {
  it('a swap exchanges the two cells and is then reported as applied', () => {
    const r = req({});
    expect(routineRequestState(base, r)).toBe('ok');
    const after = apply(base, r);
    expect(routineRequestState(after, r)).toBe('applied');
    // Applying again changes nothing (a retry after a partial failure is safe).
    expect(apply(after, r)).toEqual(after);
  });

  it('give, take and change_time', () => {
    const give = req({ kind: 'give', theirDay: null, theirTime: null, targetUserId: 'omer' });
    expect(routineRequestState(apply(base, give), give)).toBe('applied');

    const take = req({ kind: 'take', myDay: null, myTime: null, requesterUserId: 'omer', targetUserId: 'idan', theirDay: 3, theirTime: '18:00' });
    expect(routineRequestState(base, take)).toBe('ok');
    expect(routineRequestState(apply(base, take), take)).toBe('applied');

    const move = req({ kind: 'change_time', targetUserId: null, theirDay: null, theirTime: null, newTime: '14:00' });
    expect(routineRequestState(base, move)).toBe('ok');
    const moved = apply(base, move);
    expect(routineRequestState(moved, move)).toBe('applied');
    expect(moved.find((x) => x.time === '14:00')?.daysOfWeek).toEqual([0]);
    expect(moved.find((x) => x.id === 'r2')?.daysOfWeek).toEqual([2, 3, 5]);
  });

  it('is stale when the routine changed since the request', () => {
    const r = req({});
    const changed = base.map((x) => (x.id === 'r3' ? { ...x, rotationUserIds: ['omer'] } : x));
    expect(routineRequestState(changed, r)).toBe('stale');
    const move = req({ kind: 'change_time', targetUserId: null, theirDay: null, theirTime: null, newTime: '18:00' });
    expect(routineRequestState(base, move)).toBe('stale'); // 18:00 on Sunday is taken
  });

  it('describes the request and marks its cells', () => {
    const users = { maor: { name: 'מאור' }, hadar: { name: 'הדר' } };
    expect(describeRoutineRequest(req({}), users)).toBe('מאור ⇄ הדר: ראשון 13:30 של מאור תמורת שני 13:30 של הדר');
    expect([...openRequestCellKeys([req({}), req({ id: 'x', status: 'approved', myDay: 3 })])]).toEqual(['0|13:30', '1|13:30']);
  });
});
