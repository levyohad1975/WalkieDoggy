import { reminderOpenFromNotificationData } from '../reminderEntry';

describe('reminder notification entry', () => {
  it('accepts a genuine scheduled-walk reminder payload', () => {
    expect(reminderOpenFromNotificationData({ walkId: 'walk-7', kind: 'pre_walk_reminder' })).toEqual({ walkId: 'walk-7', kind: 'pre_walk_reminder' });
  });

  it('rejects ordinary or malformed notification data', () => {
    expect(reminderOpenFromNotificationData({ walkId: 'walk-7', kind: 'other' })).toBeNull();
    expect(reminderOpenFromNotificationData({ kind: 'overdue_reminder' })).toBeNull();
  });
});
