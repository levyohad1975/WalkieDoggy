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
  it('schedules all four PRD §8 stages (T-15, T, T+15, T+30) relative to the walk time, matching the server-side scheduler exactly', () => {
    const walk = makeWalk();
    const setting = defaultNotificationSetting('noam');
    const plan = planWalkNotifications(walk, setting, () => 'id');

    expect(plan).toHaveLength(4);
    const byKind = Object.fromEntries(plan.map((p) => [p.kind, p]));
    expect(new Date(byKind['T-15'].fireAt)).toEqual(new Date('2026-08-26T19:45:00'));
    expect(new Date(byKind['T'].fireAt)).toEqual(new Date('2026-08-26T20:00:00'));
    expect(new Date(byKind['T+15'].fireAt)).toEqual(new Date('2026-08-26T20:15:00'));
    expect(new Date(byKind['T+30'].fireAt)).toEqual(new Date('2026-08-26T20:30:00'));
  });

  it('every planned item carries the walk/family/user identifiers', () => {
    const walk = makeWalk();
    const setting = defaultNotificationSetting('noam');
    const plan = planWalkNotifications(walk, setting, () => 'id');

    for (const item of plan) {
      expect(item.familyId).toBe('family-1');
      expect(item.walkId).toBe('w1');
      expect(item.userId).toBe('noam');
    }
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
