import { findSpontaneousAssociationCandidates } from '../spontaneousWalkAssociation';
import type { Walk } from '../../types';

function walk(id: string, date: string, scheduledTime: string, overrides: Partial<Walk> = {}): Walk {
  return {
    id, familyId: 'family', dogId: 'dog', scheduleEntryId: `entry-${id}`, date, scheduledTime,
    responsibleUserId: 'member', status: 'pending', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('findSpontaneousAssociationCandidates', () => {
  it('offers nearby scheduled occurrences without associating or changing the walk', () => {
    const source = walk('planned', '2026-10-13', '08:00');
    const candidates = findSpontaneousAssociationCandidates([source], 'dog', new Date('2026-10-13T05:15:00.000Z'), 'Asia/Jerusalem');
    expect(candidates).toEqual([source]);
    expect(source.status).toBe('pending');
  });

  it('does not offer resolved, spontaneous, other-dog, or out-of-window walks', () => {
    const now = new Date('2026-10-13T05:30:00.000Z');
    const candidates = findSpontaneousAssociationCandidates([
      walk('done', '2026-10-13', '08:00', { status: 'done' }),
      walk('spontaneous', '2026-10-13', '08:00', { isUnplanned: true, scheduleEntryId: undefined }),
      walk('other-dog', '2026-10-13', '08:00', { dogId: 'other' }),
      walk('far', '2026-10-13', '11:00'),
    ], 'dog', now, 'Asia/Jerusalem');
    expect(candidates).toEqual([]);
  });

  it('offers a scheduled walk 90 minutes ahead but not one more than two hours ahead', () => {
    const now = new Date('2026-10-13T05:00:00.000Z'); // 08:00 in Israel
    const candidates = findSpontaneousAssociationCandidates([
      walk('replaceable', '2026-10-13', '09:30'),
      walk('too-far', '2026-10-13', '10:01'),
    ], 'dog', now, 'Asia/Jerusalem');
    expect(candidates.map((item) => item.id)).toEqual(['replaceable']);
  });

  it('keeps the existing 30-minute window for overdue scheduled walks', () => {
    const now = new Date('2026-10-13T06:00:00.000Z'); // 09:00 in Israel
    const candidates = findSpontaneousAssociationCandidates([
      walk('recent', '2026-10-13', '08:30'),
      walk('old', '2026-10-13', '08:29'),
    ], 'dog', now, 'Asia/Jerusalem');
    expect(candidates.map((item) => item.id)).toEqual(['recent']);
  });

  it('orders identical-time choices deterministically by id', () => {
    const candidates = findSpontaneousAssociationCandidates([
      walk('b', '2026-10-13', '08:00'), walk('a', '2026-10-13', '08:00'),
    ], 'dog', new Date('2026-10-13T05:00:00.000Z'), 'Asia/Jerusalem');
    expect(candidates.map((item) => item.id)).toEqual(['a', 'b']);
  });
});
