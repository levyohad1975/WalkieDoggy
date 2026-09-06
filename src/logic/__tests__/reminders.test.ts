import { defaultNotificationSetting, planWalkNotifications, shouldSendNotification } from '../reminders';
import type { Walk } from '../../types';

function makeWalk(overrides: Partial<Walk> = {}): Walk {
  return {
    id: 'w1',
    familyId: 'family-1',
    scheduleEntryId: 'e1',
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

describe('planWalkNotifications', () => {
  it('schedules a pre-walk reminder 15 minutes before by default and an overdue reminder 10 minutes after', () => {
    const walk = makeWalk();
    const setting = defaultNotificationSetting('noam');
    const plan = planWalkNotifications(walk, setting, () => 'id');

    const pre = plan.find((p) => p.kind === 'pre_walk_reminder')!;
    const overdue = plan.find((p) => p.kind === 'overdue_reminder')!;

    expect(new Date(pre.fireAt)).toEqual(new Date('2026-08-26T19:45:00'));
    expect(new Date(overdue.fireAt)).toEqual(new Date('2026-08-26T20:10:00'));
  });

  it('respects a custom minutesBefore/overdueMinutesAfter setting', () => {
    const walk = makeWalk();
    const setting = { userId: 'noam', minutesBefore: 30, overdueMinutesAfter: 5, enabled: true };
    const plan = planWalkNotifications(walk, setting, () => 'id');
    expect(new Date(plan[0].fireAt)).toEqual(new Date('2026-08-26T19:30:00'));
    expect(new Date(plan[1].fireAt)).toEqual(new Date('2026-08-26T20:05:00'));
  });

  it('plans no notifications when the user disabled reminders', () => {
    const walk = makeWalk();
    const setting = { ...defaultNotificationSetting('noam'), enabled: false };
    expect(planWalkNotifications(walk, setting)).toEqual([]);
  });

  it('plans no notifications for a walk that is already done or skipped', () => {
    const setting = defaultNotificationSetting('noam');
    expect(planWalkNotifications(makeWalk({ status: 'done' }), setting)).toEqual([]);
    expect(planWalkNotifications(makeWalk({ status: 'skipped' }), setting)).toEqual([]);
  });
});

describe('shouldSendNotification', () => {
  it('does not send a reminder for a walk that was already marked done before the reminder fired', () => {
    expect(shouldSendNotification({ status: 'done' })).toBe(false);
  });

  it('sends a reminder for a walk still pending at fire time', () => {
    expect(shouldSendNotification({ status: 'pending' })).toBe(true);
  });
});
