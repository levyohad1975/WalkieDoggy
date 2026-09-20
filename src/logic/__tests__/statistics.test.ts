import {
  computeCompletionStats,
  computeMemberDistribution,
  computePeePoopStats,
  computePlannedVsSpontaneous,
  filterWalksByPeriod,
} from '../statistics';
import type { Walk } from '../../types';

function makeWalk(overrides: Partial<Walk>): Walk {
  return {
    id: 'w',
    familyId: 'family-1',
    scheduleEntryId: 'e',
    dogId: 'dog-1',
    date: '2026-08-26',
    scheduledTime: '20:00',
    responsibleUserId: 'noam',
    status: 'pending',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

const NOW = new Date('2026-08-26T18:00:00');

describe('filterWalksByPeriod', () => {
  it('keeps only walks within the last 7 days (inclusive) for "7d"', () => {
    const walks = [
      makeWalk({ id: 'in', date: '2026-08-21' }), // exactly 5 days back
      makeWalk({ id: 'out', date: '2026-08-01' }),
    ];
    expect(filterWalksByPeriod(walks, '7d', NOW).map((w) => w.id)).toEqual(['in']);
  });

  it('"all" returns every walk unfiltered', () => {
    const walks = [makeWalk({ id: 'a', date: '2020-01-01' })];
    expect(filterWalksByPeriod(walks, 'all', NOW)).toHaveLength(1);
  });

  it('keeps only walks within the last 30 days (inclusive) for "30d"', () => {
    const walks = [
      makeWalk({ id: 'in', date: '2026-07-28' }), // exactly 29 days back
      makeWalk({ id: 'out', date: '2026-07-01' }),
    ];
    expect(filterWalksByPeriod(walks, '30d', NOW).map((w) => w.id)).toEqual(['in']);
  });

  it('defaults to the real current moment when called with no `now` argument', () => {
    const walks = [makeWalk({ id: 'today', date: new Date().toISOString().slice(0, 10) })];
    expect(filterWalksByPeriod(walks, '7d').map((w) => w.id)).toEqual(['today']);
  });
});

describe('computeCompletionStats', () => {
  it('counts done/notDone/pending and computes donePercentOfResolved', () => {
    const walks = [
      makeWalk({ status: 'done' }),
      makeWalk({ status: 'done' }),
      makeWalk({ status: 'skipped' }),
      makeWalk({ status: 'pending' }),
    ];
    const stats = computeCompletionStats(walks);
    expect(stats).toEqual({ done: 2, notDone: 1, pending: 1, total: 4, donePercentOfResolved: 67 });
  });

  it('is 0%, not NaN, when nothing is resolved yet', () => {
    const stats = computeCompletionStats([makeWalk({ status: 'pending' })]);
    expect(stats.donePercentOfResolved).toBe(0);
  });
});

describe('computeMemberDistribution', () => {
  it('counts DONE walks by completedByUserId, sorted descending', () => {
    const walks = [
      makeWalk({ status: 'done', completedByUserId: 'a' }),
      makeWalk({ status: 'done', completedByUserId: 'b' }),
      makeWalk({ status: 'done', completedByUserId: 'a' }),
      makeWalk({ status: 'pending', completedByUserId: 'a' }), // not done — excluded
    ];
    expect(computeMemberDistribution(walks)).toEqual([
      { userId: 'a', count: 2 },
      { userId: 'b', count: 1 },
    ]);
  });

  it('falls back to responsibleUserId when completedByUserId is missing', () => {
    const walks = [makeWalk({ status: 'done', responsibleUserId: 'c', completedByUserId: undefined })];
    expect(computeMemberDistribution(walks)).toEqual([{ userId: 'c', count: 1 }]);
  });
});

describe('computePlannedVsSpontaneous', () => {
  it('splits by isUnplanned', () => {
    const walks = [makeWalk({ isUnplanned: true }), makeWalk({ isUnplanned: false }), makeWalk({})];
    expect(computePlannedVsSpontaneous(walks)).toEqual({ planned: 2, spontaneous: 1 });
  });
});

describe('computePeePoopStats', () => {
  it('computes pee/poop percentages out of DONE walks only', () => {
    const walks = [
      makeWalk({ status: 'done', hadPee: true, hadPoop: false }),
      makeWalk({ status: 'done', hadPee: true, hadPoop: true }),
      makeWalk({ status: 'pending', hadPee: true }), // excluded — not done
    ];
    const stats = computePeePoopStats(walks);
    expect(stats).toEqual({ peeCount: 2, poopCount: 1, doneCount: 2, peePercent: 100, poopPercent: 50 });
  });

  it('is 0%, not NaN, when no walk is done yet', () => {
    const stats = computePeePoopStats([makeWalk({ status: 'pending', hadPee: true, hadPoop: true })]);
    expect(stats).toEqual({ peeCount: 0, poopCount: 0, doneCount: 0, peePercent: 0, poopPercent: 0 });
  });
});
