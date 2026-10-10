import type { NotificationSetting, ScheduledNotification, Walk } from '../types';
import { walkDateTime } from './nextWalk';
import { REMINDER_STAGES, REMINDER_STAGE_OFFSET_MINUTES } from './reminderMessages';

/**
 * Computes which notifications should exist for a given walk + the
 * responsible user's settings. Pure function: given the same inputs it
 * always returns the same plan, so the notification service just has to
 * diff this against what's already scheduled.
 *
 * PRD §8: exactly the four fixed stages the server-side scheduler already
 * uses (supabase/migrations/0025_walk_reminder_scheduler.sql) — T-15, T
 * (walk time), T+15, T+30 — via REMINDER_STAGES/REMINDER_STAGE_OFFSET_MINUTES
 * (reminderMessages.ts), so this LOCAL fallback (see
 * src/lib/remoteReminderChannel.ts's own doc comment on when it's actually
 * used — only when this device has no active server-reachable push
 * channel) matches the authoritative server timing exactly rather than a
 * separately-tuned approximation.
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

  return REMINDER_STAGES.map((stage) => ({
    id: idFactory(),
    familyId: walk.familyId,
    walkId: walk.id,
    userId: setting.userId,
    kind: stage,
    fireAt: new Date(walkTime.getTime() + REMINDER_STAGE_OFFSET_MINUTES[stage] * 60000).toISOString(),
  }));
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
    enabled: true,
  };
}
