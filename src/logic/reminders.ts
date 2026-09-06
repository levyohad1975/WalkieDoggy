import type { NotificationSetting, ScheduledNotification, Walk } from '../types';
import { walkDateTime } from './nextWalk';

export const DEFAULT_MINUTES_BEFORE = 15;
export const DEFAULT_OVERDUE_MINUTES_AFTER = 10;

/**
 * Computes which notifications should exist for a given walk + the
 * responsible user's settings. Pure function: given the same inputs it
 * always returns the same plan, so the notification service just has to
 * diff this against what's already scheduled.
 *
 * Rules:
 *  - No notifications at all if the user disabled reminders.
 *  - No notifications for a walk that isn't pending anymore (done/skipped) —
 *    this is also re-checked at fire time so a walk completed *after*
 *    scheduling still won't buzz anyone.
 */
export function planWalkNotifications(
  walk: Walk,
  setting: NotificationSetting,
  idFactory: () => string = () => `${walk.id}-${Math.random().toString(36).slice(2, 8)}`
): Omit<ScheduledNotification, 'sent' | 'canceledReason'>[] {
  if (!setting.enabled) return [];
  if (walk.status !== 'pending') return [];

  const walkTime = walkDateTime(walk);
  const preFireAt = new Date(walkTime.getTime() - setting.minutesBefore * 60000);
  const overdueFireAt = new Date(walkTime.getTime() + setting.overdueMinutesAfter * 60000);

  return [
    {
      id: idFactory(),
      familyId: walk.familyId,
      walkId: walk.id,
      userId: setting.userId,
      kind: 'pre_walk_reminder',
      fireAt: preFireAt.toISOString(),
    },
    {
      id: idFactory(),
      familyId: walk.familyId,
      walkId: walk.id,
      userId: setting.userId,
      kind: 'overdue_reminder',
      fireAt: overdueFireAt.toISOString(),
    },
  ];
}

/**
 * Given the current walk status, decides whether a previously-scheduled
 * notification should still be sent when its fireAt time arrives.
 * A walk marked done/skipped after the notification was scheduled must not
 * still buzz the family — "Don't send a reminder for a walk already done."
 */
export function shouldSendNotification(walk: Pick<Walk, 'status'>): boolean {
  return walk.status === 'pending';
}

export function defaultNotificationSetting(userId: string): NotificationSetting {
  return {
    userId,
    minutesBefore: DEFAULT_MINUTES_BEFORE,
    overdueMinutesAfter: DEFAULT_OVERDUE_MINUTES_AFTER,
    enabled: true,
  };
}
