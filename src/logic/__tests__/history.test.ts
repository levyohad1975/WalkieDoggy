import { isWalkEligibleForHistory, walkMatchesHistorySearch } from '../history';
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

  it('defaults to the real current moment when called with no `now` argument', () => {
    const today = new Date().toISOString().slice(0, 10);
    expect(isWalkEligibleForHistory(walk({ date: today, status: 'done' }))).toBe(true);
  });
});

describe('walkMatchesHistorySearch (PRD §14 — History "filtering and search")', () => {
  it('matches a case-insensitive substring of the walk note', () => {
    expect(walkMatchesHistorySearch(walk({ note: 'רץ מהר בפארק' }), 'פארק')).toBe(true);
    expect(walkMatchesHistorySearch(walk({ note: 'Ran in the Park' }), 'park')).toBe(true);
  });

  it('ignores leading/trailing whitespace in the query', () => {
    expect(walkMatchesHistorySearch(walk({ note: 'פגש כלב אחר' }), '  כלב  ')).toBe(true);
  });

  it('does not match unrelated note text', () => {
    expect(walkMatchesHistorySearch(walk({ note: 'טיול רגיל' }), 'גשם')).toBe(false);
  });

  it('a walk with no note never matches a non-empty query', () => {
    expect(walkMatchesHistorySearch(walk({ note: undefined }), 'כלב')).toBe(false);
  });

  it('an empty or whitespace-only query matches every walk, including one with no note', () => {
    expect(walkMatchesHistorySearch(walk({ note: undefined }), '')).toBe(true);
    expect(walkMatchesHistorySearch(walk({ note: 'משהו' }), '   ')).toBe(true);
  });
});
