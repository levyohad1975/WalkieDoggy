import { isWalkEligibleForHistory } from '../history';
import type { Walk } from '../../types';

function walk(overrides: Partial<Walk> = {}): Walk {
  return {
    id: 'w1', familyId: 'f1', dogId: 'd1', date: '2026-09-05',
    scheduledTime: '08:00', responsibleUserId: 'u1', status: 'done',
    createdAt: '2026-09-01T00:00:00.000Z', updatedAt: '2026-09-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('isWalkEligibleForHistory', () => {
  const now = new Date(2026, 8, 5, 12, 0, 0);

  it('includes a resolved walk from today or the past', () => {
    expect(isWalkEligibleForHistory(walk({ date: '2026-09-05', status: 'done' }), now)).toBe(true);
    expect(isWalkEligibleForHistory(walk({ date: '2026-09-04', status: 'skipped' }), now)).toBe(true);
  });

  it('includes an overdue pending walk without changing its status', () => {
    const overdue = walk({ status: 'pending', scheduledTime: '08:00' });

    expect(isWalkEligibleForHistory(overdue, now)).toBe(true);
    expect(overdue.status).toBe('pending');
  });

  it('excludes a pending walk whose scheduled time is still in the future', () => {
    expect(
      isWalkEligibleForHistory(
        walk({ status: 'pending', scheduledTime: '18:00' }),
        now,
      ),
    ).toBe(false);
  });

  it('never shows a future resolved occurrence as history', () => {
    expect(isWalkEligibleForHistory(walk({ date: '2026-09-07', status: 'skipped' }), now)).toBe(false);
    expect(isWalkEligibleForHistory(walk({ date: '2026-09-07', status: 'done' }), now)).toBe(false);
  });
});
