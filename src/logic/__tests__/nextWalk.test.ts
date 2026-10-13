import { computeLastWalk, computeNextWalk, dailyWalkTimeline, dedupeCanonicalWalks, formatDuration, isOverdue, minutesUntil, nextWalkSelectionRefreshDelayMs, relativeTimeLabel, upcomingWalks, walkDateTime } from '../nextWalk';
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

describe('computeNextWalk', () => {
  it('shows the first scheduled walk today before its time and never carries yesterday forward', () => {
    const walks = [
      makeWalk({ id: 'yesterday', date: '2026-08-25', scheduledTime: '21:00' }),
      makeWalk({ id: 'first-today', date: '2026-08-26', scheduledTime: '08:00' }),
      makeWalk({ id: 'later-today', date: '2026-08-26', scheduledTime: '12:00' }),
    ];

    expect(computeNextWalk(walks, new Date('2026-08-26T07:59:00'))?.id).toBe('first-today');
  });

  it('keeps the current overdue slot only until the next scheduled time', () => {
    const walks = [
      makeWalk({ id: 'morning', scheduledTime: '08:00' }),
      makeWalk({ id: 'noon', scheduledTime: '12:00' }),
      makeWalk({ id: 'evening', scheduledTime: '18:00' }),
    ];

    expect(computeNextWalk(walks, new Date('2026-08-26T11:59:59'))?.id).toBe('morning');
    expect(computeNextWalk(walks, new Date('2026-08-26T12:00:00'))?.id).toBe('noon');
  });

  it('advances at the next scheduled time while preserving the older unresolved walk', () => {
    const morning = makeWalk({ id: 'morning', scheduledTime: '08:00' });
    const noon = makeWalk({ id: 'noon', scheduledTime: '12:00' });

    expect(computeNextWalk([morning, noon], new Date('2026-08-26T12:00:00'))?.id).toBe('noon');
    expect(morning.status).toBe('pending');
  });

  it.each(['done', 'skipped'] as const)('advances past a %s walk to the next relevant scheduled walk', (status) => {
    const walks = [
      makeWalk({ id: 'resolved', scheduledTime: '08:00', status }),
      makeWalk({ id: 'next', scheduledTime: '12:00' }),
      makeWalk({ id: 'tomorrow', date: '2026-08-27', scheduledTime: '08:00' }),
    ];

    expect(computeNextWalk(walks, new Date('2026-08-26T08:00:00'))?.id).toBe('next');
  });

  it('keeps the final overdue walk through the end of the day, then advances to tomorrow', () => {
    const yesterday = makeWalk({ id: 'yesterday', date: '2026-08-25', scheduledTime: '22:00' });
    const finalToday = makeWalk({ id: 'final-today', scheduledTime: '21:00' });
    const tomorrow = makeWalk({ id: 'tomorrow', date: '2026-08-27', scheduledTime: '08:00' });

    expect(computeNextWalk([yesterday, finalToday, tomorrow], new Date('2026-08-26T23:59:59'))?.id).toBe('final-today');
    expect(computeNextWalk([yesterday, finalToday, tomorrow], new Date('2026-08-27T00:00:00'))?.id).toBe('tomorrow');
    expect(yesterday.status).toBe('pending');
    expect(finalToday.status).toBe('pending');
  });

  it('moves to the next future walk when the latest due walk is resolved, without reviving older pending walks', () => {
    const walks = [
      makeWalk({ id: 'older-pending', scheduledTime: '08:00' }),
      makeWalk({ id: 'latest-done', scheduledTime: '12:00', status: 'done' }),
      makeWalk({ id: 'tomorrow', date: '2026-08-27', scheduledTime: '08:00' }),
    ];

    expect(computeNextWalk(walks, new Date('2026-08-26T13:00:00'))?.id).toBe('tomorrow');
    expect(walks[0].status).toBe('pending');
  });

  it('selects same-time walks deterministically by schedule entry then walk id', () => {
    const walks = [
      makeWalk({ id: 'z-walk', scheduleEntryId: 'z-entry', scheduledTime: '12:00' }),
      makeWalk({ id: 'b-walk', scheduleEntryId: 'b-entry', scheduledTime: '12:00' }),
      makeWalk({ id: 'a-walk', scheduleEntryId: 'b-entry', scheduledTime: '12:00' }),
    ];

    expect(computeNextWalk(walks, new Date('2026-08-26T12:00:00'))?.id).toBe('a-walk');
  });

  it('uses the family timezone for both local date and current schedule slot', () => {
    const walks = [
      makeWalk({ id: 'prior-local-day', date: '2026-08-26', scheduledTime: '23:00' }),
      makeWalk({ id: 'new-local-day', date: '2026-08-27', scheduledTime: '08:00' }),
    ];

    // 21:00 UTC is midnight in Asia/Jerusalem on the 27th.
    expect(computeNextWalk(walks, new Date('2026-08-26T21:00:00.000Z'), 'Asia/Jerusalem')?.id).toBe('new-local-day');
  });

  it('keeps an active scheduled walk as the current slot but ignores spontaneous walks', () => {
    const walks = [
      makeWalk({ id: 'spontaneous', isUnplanned: true, status: 'in_progress' }),
      makeWalk({ id: 'active', scheduledTime: '08:00', status: 'in_progress' }),
      makeWalk({ id: 'future', scheduledTime: '12:00' }),
    ];

    expect(computeNextWalk(walks, new Date('2026-08-26T10:00:00'))?.id).toBe('active');
  });

  it('returns the next future walk when there is no current-day overdue walk', () => {
    const walks = [
      makeWalk({ id: 'done', scheduledTime: '08:00', status: 'done' }),
      makeWalk({ id: 'future', scheduledTime: '20:00' }),
      makeWalk({ id: 'tomorrow', date: '2026-08-27', scheduledTime: '08:00' }),
    ];

    expect(computeNextWalk(walks, NOW)?.id).toBe('future');
  });

  it('returns undefined when all remaining walks are resolved or stale', () => {
    const walks = [
      makeWalk({ id: 'stale', date: '2026-08-25', status: 'pending' }),
      makeWalk({ id: 'done', status: 'done' }),
      makeWalk({ id: 'skipped', status: 'skipped' }),
    ];

    expect(computeNextWalk(walks, NOW)).toBeUndefined();
  });
});

describe('family-local walk transition clock', () => {
  it('converts a scheduled time to the family timezone instant', () => {
    const walk = makeWalk({ date: '2026-08-26', scheduledTime: '12:00' });
    expect(walkDateTime(walk, 'Asia/Jerusalem').toISOString()).toBe('2026-08-26T09:00:00.000Z');
  });

  it('refreshes exactly at the next scheduled time boundary', () => {
    const walk = makeWalk({ date: '2026-08-26', scheduledTime: '12:00' });
    const now = new Date('2026-08-26T08:59:50.000Z'); // 11:59:50 in Jerusalem.
    expect(nextWalkSelectionRefreshDelayMs([walk], now, 'Asia/Jerusalem')).toBe(10_000);
  });

  it('refreshes at family-local midnight even when the device timezone differs', () => {
    const tomorrow = makeWalk({ date: '2026-08-27', scheduledTime: '08:00' });
    const now = new Date('2026-08-26T20:59:30.000Z'); // 23:59:30 in Jerusalem.
    expect(nextWalkSelectionRefreshDelayMs([tomorrow], now, 'Asia/Jerusalem')).toBe(30_000);
  });
});

describe('computeLastWalk', () => {
  it('returns the most recently completed/skipped walk up to now', () => {
    const walks = [
      makeWalk({ id: 'w1', scheduledTime: '07:00', status: 'done' }),
      makeWalk({ id: 'w2', scheduledTime: '14:00', status: 'skipped' }),
      makeWalk({ id: 'w3', scheduledTime: '20:00', status: 'pending' }),
    ];
    expect(computeLastWalk(walks, NOW)?.id).toBe('w2');
  });

  it('uses completedAt for a walk completed before its scheduled time', () => {
    const walks = [
      makeWalk({
        id: 'earlier',
        scheduledTime: '09:25',
        status: 'done',
        completedAt: new Date(2026, 7, 26, 9, 30).toISOString(),
      }),
      makeWalk({
        id: 'completed-early',
        scheduledTime: '20:00',
        status: 'done',
        completedAt: new Date(2026, 7, 26, 17, 50).toISOString(),
      }),
    ];

    expect(computeLastWalk(walks, NOW)?.id).toBe('completed-early');
  });

  it('returns undefined when there are no completed/skipped walks yet', () => {
    const walks = [makeWalk({ status: 'pending' })];
    expect(computeLastWalk(walks, NOW)).toBeUndefined();
  });

  it('defaults `now` to the current time when omitted', () => {
    const walk = makeWalk({ status: 'done', completedAt: new Date(2020, 0, 1).toISOString() });
    expect(computeLastWalk([walk])?.id).toBe('w');
  });
});

describe('isOverdue / a walk that passed without being marked done', () => {
  it('flags a pending walk whose time has passed as overdue', () => {
    const walk = makeWalk({ scheduledTime: '07:00', status: 'pending' });
    expect(isOverdue(walk, NOW)).toBe(true);
  });

  it('does not flag a done walk as overdue even if its time passed', () => {
    const walk = makeWalk({ scheduledTime: '07:00', status: 'done' });
    expect(isOverdue(walk, NOW)).toBe(false);
  });

  it('does not flag a future pending walk as overdue', () => {
    const walk = makeWalk({ scheduledTime: '20:00', status: 'pending' });
    expect(isOverdue(walk, NOW)).toBe(false);
  });

  it('defaults `now` to the current time when omitted', () => {
    const walk = makeWalk({ date: '2020-01-01', scheduledTime: '00:00', status: 'pending' });
    expect(isOverdue(walk)).toBe(true);
  });
});

describe('minutesUntil', () => {
  it('defaults `now` to the current time when omitted', () => {
    const walk = makeWalk({ date: '2099-01-01', scheduledTime: '00:00' });
    expect(minutesUntil(walk)).toBeGreaterThan(0);
  });
});

describe('formatDuration', () => {
  it('never floors away the minutes remainder (the reported bug)', () => {
    expect(formatDuration(171)).toBe('2 שעות ו-51 דקות'); // 10:09 -> 13:00
    expect(formatDuration(75)).toBe('שעה ו-15 דקות'); // 11:45 -> 13:00
    expect(formatDuration(5)).toBe('5 דקות'); // 12:55 -> 13:00
  });

  it('omits the minutes clause on an exact hour boundary', () => {
    expect(formatDuration(120)).toBe('2 שעות');
    expect(formatDuration(60)).toBe('שעה');
  });

  it('uses singular forms for exactly one hour or one minute', () => {
    expect(formatDuration(61)).toBe('שעה ו-דקה');
    expect(formatDuration(1)).toBe('דקה');
  });
});

describe('relativeTimeLabel', () => {
  it('matches every worked example from the requirements', () => {
    const walk = makeWalk({ date: '2026-08-26', scheduledTime: '13:00' });
    expect(relativeTimeLabel(walk, new Date('2026-08-26T10:09:00'))).toBe('עוד 2 שעות ו-51 דקות');
    expect(relativeTimeLabel(walk, new Date('2026-08-26T11:45:00'))).toBe('עוד שעה ו-15 דקות');
    expect(relativeTimeLabel(walk, new Date('2026-08-26T12:55:00'))).toBe('עוד 5 דקות');
    expect(relativeTimeLabel(walk, new Date('2026-08-26T13:00:00'))).toBe('עכשיו');
  });

  it('reports an overdue-but-still-pending walk as time-ago, not a negative number', () => {
    const walk = makeWalk({ date: '2026-08-26', scheduledTime: '13:00' });
    expect(relativeTimeLabel(walk, new Date('2026-08-26T13:10:00'))).toBe('לפני 10 דקות');
  });

  it('handles a walk landing on the next calendar day correctly', () => {
    const walk = makeWalk({ date: '2026-08-27', scheduledTime: '00:30' });
    expect(relativeTimeLabel(walk, new Date('2026-08-26T23:00:00'))).toBe('עוד שעה ו-30 דקות');
  });

  it('defaults `now` to the current time when omitted', () => {
    const walk = makeWalk({ date: '2099-01-01', scheduledTime: '00:00' });
    expect(relativeTimeLabel(walk)).toMatch(/^עוד /);
  });
});

describe('upcomingWalks', () => {
  it('returns only future pending walks sorted chronologically', () => {
    const walks = [
      makeWalk({ id: 'past', scheduledTime: '07:00' }),
      makeWalk({ id: 'w1', date: '2026-08-27', scheduledTime: '07:00' }),
      makeWalk({ id: 'w2', scheduledTime: '20:00' }),
      makeWalk({ id: 'w3', status: 'done' }),
    ];

    expect(upcomingWalks(walks, NOW).map((w) => w.id)).toEqual(['w2', 'w1']);
  });

  it('defaults `now` to the current time when omitted', () => {
    const walks = [
      makeWalk({ id: 'past', date: '2020-01-01', scheduledTime: '00:00' }),
      makeWalk({ id: 'future', date: '2099-01-01', scheduledTime: '00:00' }),
    ];

    expect(upcomingWalks(walks).map((w) => w.id)).toEqual(['future']);
  });
});

/**
 * P0 real-device fix — after a scheduled occurrence's Walk was legitimately
 * finished (status 'done'), the SAME occurrence reappeared as a second,
 * separately startable pending Walk. See dedupeCanonicalWalks's own doc
 * comment (nextWalk.ts) and offlineFirstRepository.ts's
 * pruneAndDedupeCanonicalWalks for the full mechanism: a stale local
 * duplicate Walk (never its own row on the server — see
 * resolveCanonicalWalkId) can survive in the local cache under a different
 * id than the real, already-completed canonical Walk for the same
 * schedule_entry_id.
 */
describe('dedupeCanonicalWalks', () => {
  it('collapses a stale pending duplicate down to the already-done canonical walk for the same schedule_entry_id', () => {
    const walks = [
      makeWalk({ id: 'walk-stale-pending', scheduleEntryId: 'entry-1', status: 'pending' }),
      makeWalk({ id: 'walk-canonical-done', scheduleEntryId: 'entry-1', status: 'done', completedAt: NOW.toISOString() }),
    ];

    const deduped = dedupeCanonicalWalks(walks);
    expect(deduped).toHaveLength(1);
    expect(deduped[0].id).toBe('walk-canonical-done');
    expect(deduped[0].status).toBe('done');
  });

  it('is stable across repeated calls — a reload after the first prune never re-surfaces the stale duplicate', () => {
    const walks = [
      makeWalk({ id: 'walk-stale-pending', scheduleEntryId: 'entry-1', status: 'pending' }),
      makeWalk({ id: 'walk-canonical-done', scheduleEntryId: 'entry-1', status: 'done' }),
    ];

    const first = dedupeCanonicalWalks(walks);
    const second = dedupeCanonicalWalks(first);
    expect(first).toHaveLength(1);
    expect(second).toHaveLength(1);
    expect(second[0].id).toBe('walk-canonical-done');
  });

  it('an in-progress canonical walk still outranks a stale pending duplicate', () => {
    const walks = [
      makeWalk({ id: 'walk-stale-pending', scheduleEntryId: 'entry-1', status: 'pending' }),
      makeWalk({ id: 'walk-canonical-active', scheduleEntryId: 'entry-1', status: 'in_progress', startedAt: NOW.toISOString() }),
    ];

    expect(dedupeCanonicalWalks(walks).map((w) => w.id)).toEqual(['walk-canonical-active']);
  });

  it('leaves unplanned walks (no schedule_entry_id) untouched — this bug class cannot apply to them', () => {
    const walks = [
      makeWalk({ id: 'unplanned-1', scheduleEntryId: undefined, isUnplanned: true, status: 'done' }),
      makeWalk({ id: 'unplanned-2', scheduleEntryId: undefined, isUnplanned: true, status: 'pending' }),
    ];

    expect(dedupeCanonicalWalks(walks)).toHaveLength(2);
  });

  it('leaves a schedule with no duplicates completely unchanged', () => {
    const walks = [
      makeWalk({ id: 'w1', scheduleEntryId: 'entry-1', status: 'pending' }),
      makeWalk({ id: 'w2', scheduleEntryId: 'entry-2', status: 'done' }),
    ];

    expect(dedupeCanonicalWalks(walks)).toEqual(walks);
  });

  it('a completed occurrence never becomes selectable as the next walk once deduped — the exact reported symptom', () => {
    const walks = [
      makeWalk({ id: 'walk-stale-pending', scheduleEntryId: 'entry-1', scheduledTime: '07:00', status: 'pending' }),
      makeWalk({ id: 'walk-canonical-done', scheduleEntryId: 'entry-1', scheduledTime: '07:00', status: 'done', completedAt: NOW.toISOString() }),
    ];

    const deduped = dedupeCanonicalWalks(walks);
    expect(computeNextWalk(deduped, NOW)).toBeUndefined();
  });

  /**
   * P0 real-device fix, ROUND 4 — a valid, still-future 14:00 occurrence
   * TODAY vanished from Home entirely (fell through to TOMORROW's
   * occurrence instead), even though an earlier walk the same day was
   * correctly 'done'. Root-caused to dedupeCanonicalWalks's own
   * status-rank ordering: the exact duplicate-local-id race the round-3
   * fix addresses can leave ONE copy of an occurrence genuinely 'pending'
   * (still actionable, not yet due) and another stuck as 'skipped'. The
   * original rank table put `skipped` ABOVE `pending`, so dedup picked the
   * stale, dead-end `skipped` copy as canonical and discarded the
   * genuinely actionable `pending` one — silently removing a valid future
   * occurrence. `pending` now outranks `skipped`.
   */
  it('a genuinely pending future occurrence outranks a stale skipped duplicate for the same schedule_entry_id — the exact reported symptom', () => {
    const now = new Date('2026-10-05T13:00:00');
    const walks = [
      makeWalk({ id: 'w-0800-done', scheduleEntryId: 'e-0800', date: '2026-10-05', scheduledTime: '08:00', status: 'done' }),
      makeWalk({ id: 'w-1400-pending', scheduleEntryId: 'e-1400', date: '2026-10-05', scheduledTime: '14:00', status: 'pending' }),
      makeWalk({ id: 'w-1400-stale-skipped', scheduleEntryId: 'e-1400', date: '2026-10-05', scheduledTime: '14:00', status: 'skipped' }),
      makeWalk({ id: 'w-tomorrow-0800-pending', scheduleEntryId: 'e-tmrw-0800', date: '2026-10-06', scheduledTime: '08:00', status: 'pending' }),
    ];

    const deduped = dedupeCanonicalWalks(walks);
    const forEntry1400 = deduped.filter((w) => w.scheduleEntryId === 'e-1400');
    expect(forEntry1400).toHaveLength(1);
    expect(forEntry1400[0].status).toBe('pending');
    expect(forEntry1400[0].id).toBe('w-1400-pending');

    expect(computeNextWalk(deduped, now)?.id).toBe('w-1400-pending');
  });

  it('done and in_progress still outrank pending — the round-3 completed-walk guarantee is unaffected by the round-4 fix', () => {
    const pendingVsDone = dedupeCanonicalWalks([
      makeWalk({ id: 'stale-pending', scheduleEntryId: 'entry-1', status: 'pending' }),
      makeWalk({ id: 'canonical-done', scheduleEntryId: 'entry-1', status: 'done' }),
    ]);
    expect(pendingVsDone.map((w) => w.id)).toEqual(['canonical-done']);

    const pendingVsActive = dedupeCanonicalWalks([
      makeWalk({ id: 'stale-pending', scheduleEntryId: 'entry-2', status: 'pending' }),
      makeWalk({ id: 'canonical-active', scheduleEntryId: 'entry-2', status: 'in_progress' }),
    ]);
    expect(pendingVsActive.map((w) => w.id)).toEqual(['canonical-active']);
  });
});

describe('computeNextWalk — today\'s later occurrence vs tomorrow\'s (P0 round 4 regression spec)', () => {
  it('at ~13:00, with an earlier walk today already done, selects today 14:00 over tomorrow 08:00', () => {
    const now = new Date('2026-10-05T13:00:00');
    const walks = [
      makeWalk({ id: 'w-0800-done', scheduleEntryId: 'e-0800', date: '2026-10-05', scheduledTime: '08:00', status: 'done', completedAt: '2026-10-05T08:15:00' }),
      makeWalk({ id: 'w-1400-pending', scheduleEntryId: 'e-1400', date: '2026-10-05', scheduledTime: '14:00', status: 'pending' }),
      makeWalk({ id: 'w-tomorrow-0800-pending', scheduleEntryId: 'e-tmrw-0800', date: '2026-10-06', scheduledTime: '08:00', status: 'pending' }),
    ];

    expect(computeNextWalk(walks, now)?.id).toBe('w-1400-pending');
  });
});

describe('dailyWalkTimeline', () => {
  it('keeps every local-today status in chronological order instead of hiding resolved walks', () => {
    const walks = [
      makeWalk({ id: 'future', scheduledTime: '20:00', status: 'pending' }),
      makeWalk({ id: 'done', scheduledTime: '07:00', status: 'done', completedAt: '2026-08-26T07:18:00' }),
      makeWalk({ id: 'skipped', scheduledTime: '12:00', status: 'skipped' }),
      makeWalk({ id: 'active', scheduledTime: '16:00', status: 'in_progress' }),
      makeWalk({ id: 'tomorrow', date: '2026-08-27', scheduledTime: '08:00', status: 'pending' }),
    ];

    expect(dailyWalkTimeline(walks, NOW).map((item) => item.id)).toEqual(['done', 'skipped', 'active', 'future']);
  });
});
