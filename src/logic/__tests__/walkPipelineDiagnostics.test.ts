import { buildWalkPipelineReport, dedupeTraceEntries, toWalkTraceEntry, type WalksDebugTrace } from '../walkPipelineDiagnostics';
import { dedupeCanonicalWalks } from '../nextWalk';
import type { ScheduleEntry, ScheduleRule, Walk } from '../../types';

/**
 * TEMPORARY P0 DIAGNOSTIC (real-device QA round 5) — see
 * walkPipelineDiagnostics.ts's own doc comment. These tests can be removed
 * alongside that module once the round-5 symptom is root-caused and fixed.
 */
function makeWalk(overrides: Partial<Walk>): Walk {
  return {
    id: 'w', familyId: 'family-1', scheduleEntryId: 'e', dogId: 'dog-1',
    date: '2026-10-05', scheduledTime: '08:00', responsibleUserId: 'user-1',
    status: 'pending', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

describe('dedupeTraceEntries — must stay behaviorally identical to dedupeCanonicalWalks', () => {
  it('agrees with dedupeCanonicalWalks on which walk survives, across every status pairing', () => {
    const statuses: Walk['status'][] = ['pending', 'in_progress', 'done', 'skipped'];
    for (const a of statuses) {
      for (const b of statuses) {
        const walks = [
          makeWalk({ id: 'a', scheduleEntryId: 'entry-x', status: a }),
          makeWalk({ id: 'b', scheduleEntryId: 'entry-x', status: b }),
        ];
        const realResult = dedupeCanonicalWalks(walks).map((w) => w.id);
        const traceEntries = walks.map((w) => toWalkTraceEntry(w, 'remote', false));
        const diagnosticResult = dedupeTraceEntries(traceEntries).map((e) => e.id);
        expect(diagnosticResult).toEqual(realResult);
      }
    }
  });
});

describe('toWalkTraceEntry', () => {
  it('carries over id/scheduleEntryId/date/scheduledTime/status plus the given origin/queue/conflict', () => {
    const walk = makeWalk({ id: 'w1', scheduleEntryId: 'e1', date: '2026-10-05', scheduledTime: '14:00', status: 'pending' });
    const entry = toWalkTraceEntry(walk, 'local-only', true, { code: '23505', message: 'dup', failedAt: '2026-10-05T00:00:00.000Z' });
    expect(entry).toEqual({
      id: 'w1', scheduleEntryId: 'e1', date: '2026-10-05', scheduledTime: '14:00', status: 'pending',
      origin: 'local-only', isPendingInQueue: true, conflict: { code: '23505', message: 'dup', failedAt: '2026-10-05T00:00:00.000Z' },
    });
  });
});

describe('buildWalkPipelineReport', () => {
  const rules: ScheduleRule[] = [
    { id: 'rule-1400', familyId: 'family-1', dogId: 'dog-1', time: '14:00', daysOfWeek: [0, 1, 2, 3, 4, 5, 6], rotationUserIds: ['user-1'], rotationAnchorDate: '2026-10-01', sortOrder: 0, active: true, createdAt: '2026-10-01T00:00:00.000Z' },
  ];
  const entries: ScheduleEntry[] = [
    { id: 'entry-1400', familyId: 'family-1', dogId: 'dog-1', ruleId: 'rule-1400', date: '2026-10-05', time: '14:00', responsibleUserId: 'user-1', createdAt: '2026-10-05T00:00:00.000Z' },
  ];

  it('reports an entry with no walk at all as missing at the merge stage, and absent from the store', () => {
    const trace: WalksDebugTrace = {
      familyId: 'family-1', fetchedAt: new Date().toISOString(), isOnline: true,
      remoteWalks: [], localWalks: [], mergedBeforeDedupe: [], afterDedupe: [],
    };
    const report = buildWalkPipelineReport({ now: new Date('2026-10-05T13:00:00'), familyId: 'family-1', rules, entries, trace, storeWalks: [] });
    expect(report).toContain('entry entry-1400');
    expect(report).toContain('NO WALK references this entry at the getWalks() merge stage at all');
    expect(report).toContain('store.walks: ABSENT');
  });

  it('reports a walk that survives dedupe and reaches the store, and names it as the computeNextWalk selection', () => {
    const walk = makeWalk({ id: 'walk-1400', scheduleEntryId: 'entry-1400', date: '2026-10-05', scheduledTime: '14:00', status: 'pending' });
    const traceEntry = toWalkTraceEntry(walk, 'remote', false);
    const trace: WalksDebugTrace = {
      familyId: 'family-1', fetchedAt: new Date().toISOString(), isOnline: true,
      remoteWalks: [traceEntry], localWalks: [traceEntry], mergedBeforeDedupe: [traceEntry], afterDedupe: [traceEntry],
    };
    const report = buildWalkPipelineReport({ now: new Date('2026-10-05T13:00:00'), familyId: 'family-1', rules, entries, trace, storeWalks: [walk] });
    expect(report).toContain('SURVIVED dedupe');
    expect(report).toContain('store.walks: walk walk-1400');
    expect(report).toContain('selected: walk walk-1400');
    expect(report).toContain('IS the selected walk');
  });

  it('reports a discarded duplicate and explains why the surviving one one wins', () => {
    const loser = makeWalk({ id: 'walk-skipped', scheduleEntryId: 'entry-1400', date: '2026-10-05', scheduledTime: '14:00', status: 'skipped' });
    const winner = makeWalk({ id: 'walk-pending', scheduleEntryId: 'entry-1400', date: '2026-10-05', scheduledTime: '14:00', status: 'pending' });
    const loserEntry = toWalkTraceEntry(loser, 'local-only', false);
    const winnerEntry = toWalkTraceEntry(winner, 'local-only', false);
    const trace: WalksDebugTrace = {
      familyId: 'family-1', fetchedAt: new Date().toISOString(), isOnline: true,
      remoteWalks: [], localWalks: [loserEntry, winnerEntry],
      mergedBeforeDedupe: [loserEntry, winnerEntry], afterDedupe: [winnerEntry],
    };
    const report = buildWalkPipelineReport({ now: new Date('2026-10-05T13:00:00'), familyId: 'family-1', rules, entries, trace, storeWalks: [winner] });
    expect(report).toContain('DISCARDED by dedupe');
    expect(report).toContain('SURVIVED dedupe');
  });

  it('explains an overdue walk winning over a future one', () => {
    const overdueEntry: ScheduleEntry = { id: 'entry-0800', familyId: 'family-1', dogId: 'dog-1', date: '2026-10-05', time: '08:00', responsibleUserId: 'user-1', createdAt: '2026-10-05T00:00:00.000Z' };
    const overdueWalk = makeWalk({ id: 'walk-0800', scheduleEntryId: 'entry-0800', date: '2026-10-05', scheduledTime: '08:00', status: 'pending' });
    const futureWalk = makeWalk({ id: 'walk-1400', scheduleEntryId: 'entry-1400', date: '2026-10-05', scheduledTime: '14:00', status: 'pending' });
    const trace: WalksDebugTrace = {
      familyId: 'family-1', fetchedAt: new Date().toISOString(), isOnline: true,
      remoteWalks: [], localWalks: [], mergedBeforeDedupe: [], afterDedupe: [],
    };
    const report = buildWalkPipelineReport({
      now: new Date('2026-10-05T13:00:00'),
      familyId: 'family-1',
      rules,
      entries: [...entries, overdueEntry],
      trace,
      storeWalks: [overdueWalk, futureWalk],
    });
    expect(report).toContain('selected: walk walk-0800');
    expect(report).toContain('OVERDUE pending walk(s) exist');
  });
});
