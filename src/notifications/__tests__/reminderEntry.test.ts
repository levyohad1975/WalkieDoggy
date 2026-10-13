import { reminderOpenFromNotificationData } from '../reminderEntry';

/**
 * BUG FIX (mascot-notification-experiences round): these tests previously
 * constructed their input with a `kind` field, matching the (buggy)
 * implementation rather than the REAL server payload —
 * supabase/functions/send-walk-reminders/index.ts's `sendToRecipients()`
 * call sends `{ type: 'walkReminder' | 'walkAttentionEscalation', walkId,
 * stage }`, never `kind`. That drift meant a real notification tap never
 * actually published a reminder-open event on any platform. Every test
 * below now constructs the real server shape.
 */
describe('reminder notification entry', () => {
  it.each(['T-15', 'T', 'T+15', 'T+30'] as const)('accepts a genuine scheduled-walk reminder payload for stage %s', (stage) => {
    expect(reminderOpenFromNotificationData({ type: 'walkReminder', walkId: 'walk-7', stage })).toEqual({ walkId: 'walk-7', kind: stage });
  });

  it('accepts the admin-escalation payload shape too (T+30 only, a different recipient role, same stage field)', () => {
    expect(reminderOpenFromNotificationData({ type: 'walkAttentionEscalation', walkId: 'walk-7', stage: 'T+30' })).toEqual({
      walkId: 'walk-7',
      kind: 'T+30',
    });
  });

  it('accepts a payload with no `type` field at all, for forward/backward compatibility', () => {
    expect(reminderOpenFromNotificationData({ walkId: 'walk-7', stage: 'T' })).toEqual({ walkId: 'walk-7', kind: 'T' });
  });

  it('rejects a swap/time-change request payload (the OTHER real payload shape) even though its other fields might coincidentally overlap', () => {
    expect(reminderOpenFromNotificationData({ type: 'request', walkId: 'walk-7', stage: 'T' })).toBeNull();
  });

  it('rejects ordinary or malformed notification data', () => {
    expect(reminderOpenFromNotificationData({ type: 'walkReminder', walkId: 'walk-7', stage: 'other' })).toBeNull();
    expect(reminderOpenFromNotificationData({ type: 'walkReminder', stage: 'T+30' })).toBeNull();
    // Stale stage values from before the PRD §8 four-stage model must not
    // be accepted either — an old app build's scheduled notification (or
    // one whose payload was corrupted) should never resurrect the retired
    // two-kind scheme.
    expect(reminderOpenFromNotificationData({ type: 'walkReminder', walkId: 'walk-7', stage: 'pre_walk_reminder' })).toBeNull();
    expect(reminderOpenFromNotificationData({ type: 'walkReminder', walkId: 'walk-7', stage: 'overdue_reminder' })).toBeNull();
    expect(reminderOpenFromNotificationData(null)).toBeNull();
    expect(reminderOpenFromNotificationData('not an object')).toBeNull();
  });
});
