import {
  applyStatisticsFilters,
  computeCompletionStats,
  computeDailyTrend,
  computeDistanceStats,
  computeDogDistribution,
  computeDurationStats,
  computeInsights,
  computeMemberDistribution,
  computeOnTimeStats,
  computePeePoopStats,
  computePlannedVsSpontaneous,
  DEFAULT_STATISTICS_FILTERS,
  filterWalksByPeriod,
  periodToDateRange,
  wasCompletedOnTime,
} from '../statistics';
import type { Walk, WalkGpsSession } from '../../types';

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

describe('periodToDateRange', () => {
  it('returns null for "all" (unbounded)', () => {
    expect(periodToDateRange('all', NOW)).toBeNull();
  });

  it('returns an inclusive 7-day range ending today for "7d"', () => {
    expect(periodToDateRange('7d', NOW)).toEqual({ start: '2026-08-20', end: '2026-08-26' });
  });

  it('returns an inclusive 30-day range ending today for "30d"', () => {
    expect(periodToDateRange('30d', NOW)).toEqual({ start: '2026-07-28', end: '2026-08-26' });
  });
});

describe('applyStatisticsFilters', () => {
  it('with DEFAULT_STATISTICS_FILTERS returns every walk unfiltered', () => {
    const walks = [makeWalk({ id: 'a' }), makeWalk({ id: 'b' })];
    expect(applyStatisticsFilters(walks, DEFAULT_STATISTICS_FILTERS)).toHaveLength(2);
  });

  it('filters by inclusive dateRange', () => {
    const walks = [
      makeWalk({ id: 'in', date: '2026-08-15' }),
      makeWalk({ id: 'out', date: '2026-08-01' }),
    ];
    const result = applyStatisticsFilters(walks, { ...DEFAULT_STATISTICS_FILTERS, dateRange: { start: '2026-08-10', end: '2026-08-20' } });
    expect(result.map((w) => w.id)).toEqual(['in']);
  });

  it('filters by dogId', () => {
    const walks = [makeWalk({ id: 'a', dogId: 'dog-1' }), makeWalk({ id: 'b', dogId: 'dog-2' })];
    expect(applyStatisticsFilters(walks, { ...DEFAULT_STATISTICS_FILTERS, dogId: 'dog-2' }).map((w) => w.id)).toEqual(['b']);
  });

  it('filters by memberId matching either responsibleUserId or completedByUserId', () => {
    const walks = [
      makeWalk({ id: 'scheduled-for', responsibleUserId: 'noam', completedByUserId: 'dana' }),
      makeWalk({ id: 'completed-by', responsibleUserId: 'other', completedByUserId: 'noam' }),
      makeWalk({ id: 'unrelated', responsibleUserId: 'x', completedByUserId: 'y' }),
    ];
    const result = applyStatisticsFilters(walks, { ...DEFAULT_STATISTICS_FILTERS, memberId: 'noam' });
    expect(result.map((w) => w.id).sort()).toEqual(['completed-by', 'scheduled-for']);
  });

  it('filters by status', () => {
    const walks = [makeWalk({ id: 'a', status: 'done' }), makeWalk({ id: 'b', status: 'pending' })];
    expect(applyStatisticsFilters(walks, { ...DEFAULT_STATISTICS_FILTERS, status: 'done' }).map((w) => w.id)).toEqual(['a']);
  });

  it('filters planned vs adhoc', () => {
    const walks = [makeWalk({ id: 'planned', isUnplanned: false }), makeWalk({ id: 'adhoc', isUnplanned: true })];
    expect(applyStatisticsFilters(walks, { ...DEFAULT_STATISTICS_FILTERS, planned: 'planned' }).map((w) => w.id)).toEqual(['planned']);
    expect(applyStatisticsFilters(walks, { ...DEFAULT_STATISTICS_FILTERS, planned: 'adhoc' }).map((w) => w.id)).toEqual(['adhoc']);
  });

  it('combines multiple filters (AND semantics)', () => {
    const walks = [
      makeWalk({ id: 'match', dogId: 'dog-1', status: 'done' }),
      makeWalk({ id: 'wrong-dog', dogId: 'dog-2', status: 'done' }),
      makeWalk({ id: 'wrong-status', dogId: 'dog-1', status: 'pending' }),
    ];
    const result = applyStatisticsFilters(walks, { ...DEFAULT_STATISTICS_FILTERS, dogId: 'dog-1', status: 'done' });
    expect(result.map((w) => w.id)).toEqual(['match']);
  });
});

describe('wasCompletedOnTime', () => {
  it('returns null for a walk that is not done', () => {
    expect(wasCompletedOnTime(makeWalk({ status: 'pending' }))).toBeNull();
  });

  it('returns null for an unplanned/ad-hoc walk even if done', () => {
    expect(wasCompletedOnTime(makeWalk({ status: 'done', completedAt: new Date().toISOString(), isUnplanned: true }))).toBeNull();
  });

  it('returns null when completedAt is missing', () => {
    expect(wasCompletedOnTime(makeWalk({ status: 'done', completedAt: undefined }))).toBeNull();
  });

  it('is true when completed within the grace period', () => {
    const walk = makeWalk({ status: 'done', date: '2026-08-26', scheduledTime: '20:00', completedAt: new Date(2026, 7, 26, 20, 5).toISOString() });
    expect(wasCompletedOnTime(walk)).toBe(true);
  });

  it('is false when completed after the grace period', () => {
    const walk = makeWalk({ status: 'done', date: '2026-08-26', scheduledTime: '20:00', completedAt: new Date(2026, 7, 26, 20, 25).toISOString() });
    expect(wasCompletedOnTime(walk)).toBe(false);
  });
});

describe('computeOnTimeStats', () => {
  it('tallies onTime/late/notApplicable and computes onTimePercent of resolved only', () => {
    const walks = [
      makeWalk({ status: 'done', date: '2026-08-26', scheduledTime: '20:00', completedAt: new Date(2026, 7, 26, 20, 0).toISOString() }), // onTime
      makeWalk({ status: 'done', date: '2026-08-26', scheduledTime: '20:00', completedAt: new Date(2026, 7, 26, 20, 30).toISOString() }), // late
      makeWalk({ status: 'pending' }), // n/a
      makeWalk({ status: 'done', isUnplanned: true, completedAt: new Date().toISOString() }), // n/a
    ];
    expect(computeOnTimeStats(walks)).toEqual({ onTime: 1, late: 1, notApplicable: 2, onTimePercent: 50 });
  });

  it('is 0%, not NaN, when nothing is resolved', () => {
    expect(computeOnTimeStats([makeWalk({ status: 'pending' })]).onTimePercent).toBe(0);
  });
});

describe('computeDurationStats', () => {
  it('sums and averages durationMinutes across done walks that have one', () => {
    const walks = [
      makeWalk({ status: 'done', durationMinutes: 20 }),
      makeWalk({ status: 'done', durationMinutes: 30 }),
      makeWalk({ status: 'done', durationMinutes: undefined }),
      makeWalk({ status: 'pending', durationMinutes: 99 }),
    ];
    expect(computeDurationStats(walks)).toEqual({ totalMinutes: 50, averageMinutes: 25, countWithDuration: 2 });
  });

  it('averageMinutes is null (not 0) when no walk has a recorded duration', () => {
    const stats = computeDurationStats([makeWalk({ status: 'done', durationMinutes: undefined })]);
    expect(stats.averageMinutes).toBeNull();
    expect(stats.totalMinutes).toBe(0);
  });
});

describe('computeDogDistribution', () => {
  it('counts DONE walks by dogId, sorted descending', () => {
    const walks = [
      makeWalk({ status: 'done', dogId: 'a' }),
      makeWalk({ status: 'done', dogId: 'a' }),
      makeWalk({ status: 'done', dogId: 'b' }),
      makeWalk({ status: 'pending', dogId: 'a' }),
    ];
    expect(computeDogDistribution(walks)).toEqual([
      { dogId: 'a', count: 2 },
      { dogId: 'b', count: 1 },
    ]);
  });
});

describe('computeDailyTrend', () => {
  it('counts DONE walks per date, ascending by date', () => {
    const walks = [
      makeWalk({ status: 'done', date: '2026-08-26' }),
      makeWalk({ status: 'done', date: '2026-08-24' }),
      makeWalk({ status: 'done', date: '2026-08-24' }),
      makeWalk({ status: 'pending', date: '2026-08-25' }),
    ];
    expect(computeDailyTrend(walks)).toEqual([
      { date: '2026-08-24', count: 2 },
      { date: '2026-08-26', count: 1 },
    ]);
  });
});

function makeGpsSession(overrides: Partial<WalkGpsSession>): WalkGpsSession {
  return {
    id: 'gps',
    walkId: 'w',
    familyId: 'family-1',
    dogId: 'dog-1',
    pointCount: 10,
    source: 'device_gps',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

describe('computeDistanceStats', () => {
  it('sums and averages distanceMeters across sessions', () => {
    const sessions = [makeGpsSession({ distanceMeters: 500 }), makeGpsSession({ distanceMeters: 1000 })];
    expect(computeDistanceStats(sessions)).toEqual({ totalMeters: 1500, averageMeters: 750, sessionCount: 2 });
  });

  it('prefers correctedDistanceMeters over distanceMeters when present', () => {
    const sessions = [makeGpsSession({ distanceMeters: 500, correctedDistanceMeters: 800 })];
    expect(computeDistanceStats(sessions)).toEqual({ totalMeters: 800, averageMeters: 800, sessionCount: 1 });
  });

  it('averageMeters is null and sessionCount is 0 when no session has a distance', () => {
    const stats = computeDistanceStats([makeGpsSession({ distanceMeters: undefined })]);
    expect(stats).toEqual({ totalMeters: 0, averageMeters: null, sessionCount: 0 });
  });
});

describe('computeInsights', () => {
  it('returns [] for an empty walk list', () => {
    expect(computeInsights([], {}, {})).toEqual([]);
  });

  it('names the most active member by name when known', () => {
    const walks = [makeWalk({ status: 'done', completedByUserId: 'noam' })];
    const insights = computeInsights(walks, { noam: { name: 'נועם' } }, {});
    expect(insights[0]).toContain('נועם');
  });

  it('never surfaces pee/poop as anything but one supplementary sentence, and only with >= 3 done walks', () => {
    const fewWalks = [makeWalk({ status: 'done', hadPee: true, completedByUserId: 'a' })];
    expect(computeInsights(fewWalks, {}, {}).some((s) => s.includes('פיפי'))).toBe(false);

    const manyWalks = [
      makeWalk({ id: '1', status: 'done', hadPee: true, hadPoop: true, completedByUserId: 'a' }),
      makeWalk({ id: '2', status: 'done', hadPee: true, hadPoop: false, completedByUserId: 'a' }),
      makeWalk({ id: '3', status: 'done', hadPee: false, hadPoop: false, completedByUserId: 'a' }),
    ];
    const insights = computeInsights(manyWalks, {}, {});
    const peePoopSentences = insights.filter((s) => s.includes('פיפי') || s.includes('קקי'));
    expect(peePoopSentences).toHaveLength(1);
  });

  it('only mentions dog distribution when there is more than one dog', () => {
    const singleDog = [makeWalk({ status: 'done', dogId: 'dog-1', completedByUserId: 'a' })];
    expect(computeInsights(singleDog, {}, {}).some((s) => s.includes('הכי הרבה טיולים'))).toBe(false);

    const twoDogs = [
      makeWalk({ id: '1', status: 'done', dogId: 'dog-1', completedByUserId: 'a' }),
      makeWalk({ id: '2', status: 'done', dogId: 'dog-1', completedByUserId: 'a' }),
      makeWalk({ id: '3', status: 'done', dogId: 'dog-2', completedByUserId: 'a' }),
    ];
    expect(computeInsights(twoDogs, {}, { 'dog-1': { name: 'ריקי' } }).some((s) => s.includes('ריקי'))).toBe(true);
  });
});
