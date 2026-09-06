import { computeLastWalk, computeNextWalk, formatDuration, isOverdue, relativeTimeLabel, upcomingWalks } from '../nextWalk';
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
  it('picks the earliest pending future walk', () => {
    const walks = [
      makeWalk({ id: 'w1', scheduledTime: '07:00', status: 'done' }),
      makeWalk({ id: 'w2', scheduledTime: '20:00' }),
      makeWalk({ id: 'w3', date: '2026-08-27', scheduledTime: '07:00' }),
    ];

    expect(computeNextWalk(walks, NOW)?.id).toBe('w2');
  });

  it('keeps a just-due pending walk as the main walk during the 30-minute grace window', () => {
    const walks = [
      makeWalk({ id: 'current', scheduledTime: '17:30' }),
      makeWalk({ id: 'future', scheduledTime: '20:00' }),
    ];

    expect(computeNextWalk(walks, new Date('2026-08-26T17:59:00'))?.id).toBe('current');
  });

  it('keeps the pending walk at exactly 30 minutes after its scheduled time', () => {
    const walks = [
      makeWalk({ id: 'current', scheduledTime: '17:30' }),
      makeWalk({ id: 'future', scheduledTime: '20:00' }),
    ];

    expect(computeNextWalk(walks, new Date('2026-08-26T18:00:00'))?.id).toBe('current');
  });

  it('advances to the next future walk after the 30-minute grace window', () => {
    const walks = [
      makeWalk({ id: 'overdue', scheduledTime: '17:30' }),
      makeWalk({ id: 'future', scheduledTime: '20:00' }),
    ];

    expect(computeNextWalk(walks, new Date('2026-08-26T18:01:00'))?.id).toBe('future');
  });

  it('does not let an old unresolved pending walk block a future walk', () => {
    const walks = [
      makeWalk({ id: 'old-pending', scheduledTime: '07:00' }),
      makeWalk({ id: 'future', scheduledTime: '20:00' }),
    ];

    expect(computeNextWalk(walks, NOW)?.id).toBe('future');
  });

  it('returns undefined when the only pending walk is older than the grace window', () => {
    const walk = makeWalk({ id: 'old-pending', scheduledTime: '07:00' });

    expect(computeNextWalk([walk], NOW)).toBeUndefined();
    expect(walk.status).toBe('pending');
  });

  it('returns undefined when there are no pending walks', () => {
    const walks = [
      makeWalk({ status: 'done' }),
      makeWalk({ status: 'skipped' }),
    ];

    expect(computeNextWalk(walks, NOW)).toBeUndefined();
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
});
