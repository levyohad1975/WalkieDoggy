import { reminderOpenFromNotificationData } from '../reminderEntry';

describe('reminder notification entry', () => {
  it.each(['T-15', 'T', 'T+15', 'T+30'] as const)('accepts a genuine scheduled-walk reminder payload for stage %s', (kind) => {
    expect(reminderOpenFromNotificationData({ walkId: 'walk-7', kind })).toEqual({ walkId: 'walk-7', kind });
  });

  it('rejects ordinary or malformed notification data', () => {
    expect(reminderOpenFromNotificationData({ walkId: 'walk-7', kind: 'other' })).toBeNull();
    expect(reminderOpenFromNotificationData({ kind: 'T+30' })).toBeNull();
    // Stale kind values from before the PRD §8 four-stage model must not
    // be accepted either — an old app build's scheduled notification (or
    // one whose payload was corrupted) should never resurrect the retired
    // two-kind scheme.
    expect(reminderOpenFromNotificationData({ walkId: 'walk-7', kind: 'pre_walk_reminder' })).toBeNull();
    expect(reminderOpenFromNotificationData({ walkId: 'walk-7', kind: 'overdue_reminder' })).toBeNull();
  });
});
