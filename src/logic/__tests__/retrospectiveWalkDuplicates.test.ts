import { findRetrospectiveWalkDuplicates } from '../retrospectiveWalkDuplicates';
import type { Walk } from '../../types';

const walk = (overrides: Partial<Walk> = {}): Walk => ({
  id: 'existing', familyId: 'family', dogId: 'dog', date: '2026-10-13', scheduledTime: '10:00',
  responsibleUserId: 'walker', status: 'done', createdAt: '2026-10-13T10:00:00Z', updatedAt: '2026-10-13T10:00:00Z', ...overrides,
});

describe('findRetrospectiveWalkDuplicates', () => {
  const input = { dogId: 'dog', performedByUserId: 'walker', date: '2026-10-13', time: '10:30', durationMinutes: 20 };
  it('flags a completed walk for the same dog, walker, date and overlapping time', () => {
    expect(findRetrospectiveWalkDuplicates([walk()], input)).toHaveLength(1);
  });
  it('uses actual-walker attribution when it differs from the scheduled assignee', () => {
    expect(findRetrospectiveWalkDuplicates([walk({ responsibleUserId: 'scheduled', actualWalkerUserId: 'walker' })], input)).toHaveLength(1);
  });
  it('ignores other dogs, other walkers, other dates, pending walks and the edited row', () => {
    const candidates = [
      walk({ dogId: 'other' }), walk({ responsibleUserId: 'other' }), walk({ date: '2026-10-12' }),
      walk({ status: 'pending' }), walk({ id: 'edited' }),
    ];
    expect(findRetrospectiveWalkDuplicates(candidates, { ...input, excludeWalkId: 'edited' })).toEqual([]);
  });
  it('ignores same-day walks with non-overlapping times', () => {
    expect(findRetrospectiveWalkDuplicates([walk({ scheduledTime: '08:00', durationMinutes: 15 })], input)).toEqual([]);
  });
});
