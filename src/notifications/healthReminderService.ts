import { Platform } from 'react-native';
import type { HealthTask } from '../types';
import { getNotifications } from './notificationService';
import { HEALTH_TASK_CATEGORY_LABELS, planHealthTaskNotifications } from '../logic/healthTasks';
import type * as ExpoNotifications from 'expo-notifications';

/**
 * Local reminders for Health & Grooming tasks (PRD §10: "תזכורות בריאות/
 * טיפוח משתמשות באותה תשתית Notification אך נבדלות מתזכורות טיול" — same
 * infrastructure, a distinct kind namespace). Reuses notificationService.ts's
 * getNotifications() (the lazy-load + Expo-Go-crash-avoidance guard — see
 * that function's own doc comment for why that specific logic must never be
 * duplicated) rather than reimplementing it, but keeps every walk-specific
 * function (scheduleWalkNotifications, NOTIFICATION_KINDS, etc.) completely
 * untouched — this file adds a second, independent kind namespace on the
 * same underlying OS scheduling APIs, exactly the way the walk-reminder
 * system itself already is one namespace among what the OS can schedule.
 *
 * SCOPE NOTE: like every walk reminder before migration 0025's server-side
 * scheduler, this is LOCAL-ONLY — no server-side push, no Edge Function, no
 * pg_cron. It fires only while this device has the app installed with
 * notification permission granted, and (like all local scheduling in this
 * app) is unavailable on Web entirely — see notificationService.ts's own
 * Platform.OS==='web' guard, inherited here via getNotifications(). A
 * future server-side health-reminder scheduler (health_task_reminder_events,
 * mirroring walk_reminder_events) is a natural next increment, deliberately
 * out of scope for this slice.
 */

const HEALTH_REMINDER_CHANNEL_ID = 'health-grooming-reminders';

/** Android-only, no-op elsewhere — same pattern as ensureAndroidNotificationChannel(), a separate channel id/name so a person can mute/tune health reminders independently of walk reminders in the OS settings. */
export async function ensureAndroidHealthReminderChannel(): Promise<void> {
  if (Platform.OS !== 'android') return;
  const Notifications = await getNotifications();
  if (!Notifications) return;
  await Notifications.setNotificationChannelAsync(HEALTH_REMINDER_CHANNEL_ID, {
    name: 'תזכורות בריאות וטיפוח',
    importance: Notifications.AndroidImportance.DEFAULT,
    sound: 'default',
  });
}

const HEALTH_NOTIFICATION_KINDS = ['health_task_due', 'health_task_overdue'] as const;
type HealthNotificationKind = (typeof HEALTH_NOTIFICATION_KINDS)[number];

/**
 * STABLE, DETERMINISTIC id per (task, kind) — same exact-once-by-replace
 * scheme as notificationIdentifier() in notificationService.ts (see that
 * function's doc comment for the restart-survival bug it fixes): scheduling
 * with the same identifier REPLACES the OS's existing entry rather than
 * adding a duplicate, which is what makes this dedup-safe to call
 * repeatedly (on every load(), every save) with no other bookkeeping.
 * Prefixed distinctly from walk notifications' `notif:` scheme so the two
 * kind namespaces can never collide or be mistaken for one another.
 */
function healthNotificationIdentifier(taskId: string, kind: HealthNotificationKind): string {
  return `health-notif:${taskId}:${kind}`;
}

/**
 * Schedules (or reschedules, or cancels) this task's due/overdue local
 * reminders from its CURRENT data — safe to call repeatedly / after a
 * restart, exactly like scheduleWalkNotifications(). A completed task (or
 * one somehow missing a dueDate) has its reminders cancelled outright
 * rather than scheduled. No-op in Expo Go / on Web — see getNotifications().
 *
 * `now` is injectable (defaults to the real current moment) — same
 * convention as logic/healthTasks.ts's own getImportantHealthReminders() —
 * so the "is this fire time already in the past" check below is testable
 * without depending on the real wall-clock hour at test-run time.
 */
export async function scheduleHealthTaskNotifications(task: HealthTask, dogName: string, now: Date = new Date()): Promise<void> {
  const Notifications = await getNotifications();
  if (!Notifications) return;

  if (task.completedAt || !task.dueDate) {
    await cancelHealthTaskNotifications(task.id);
    return;
  }

  const plan = planHealthTaskNotifications(task);
  const scheduledKinds = new Set<HealthNotificationKind>();
  const categoryLabel = HEALTH_TASK_CATEGORY_LABELS[task.category];

  for (const item of plan) {
    const fireDate = new Date(item.fireAt);
    if (fireDate.getTime() <= now.getTime()) continue; // don't schedule reminders in the past

    const title = item.kind === 'health_task_due' ? `🏥 ${categoryLabel} מגיע/ה היום` : `⏰ ${categoryLabel} עדיין לא סומן/ה כבוצע`;
    const body =
      item.kind === 'health_task_due'
        ? `${task.title} עבור ${dogName} מתוכנן/ת להיום.`
        : `${task.title} עבור ${dogName} עדיין פתוח/ה. אפשר לסמן כבוצע באפליקציה.`;

    await Notifications.scheduleNotificationAsync({
      identifier: healthNotificationIdentifier(task.id, item.kind),
      content: {
        title,
        body,
        data: { healthTaskId: task.id, kind: item.kind },
        ...(Platform.OS === 'android' ? { channelId: HEALTH_REMINDER_CHANNEL_ID } : null),
      },
      trigger: Platform.select({
        default: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: fireDate },
      }) as any,
    });
    scheduledKinds.add(item.kind);
  }

  const staleKinds = HEALTH_NOTIFICATION_KINDS.filter((kind) => !scheduledKinds.has(kind));
  await Promise.all(
    staleKinds.map((kind) => Notifications.cancelScheduledNotificationAsync(healthNotificationIdentifier(task.id, kind)))
  );
}

/** Cancels every notification that could ever have been scheduled for this task, by deterministic id. Safe for a task with nothing scheduled, and a no-op in Expo Go. */
export async function cancelHealthTaskNotifications(taskId: string): Promise<void> {
  const Notifications = await getNotifications();
  if (!Notifications) return;
  await Promise.all(
    HEALTH_NOTIFICATION_KINDS.map((kind) =>
      Notifications.cancelScheduledNotificationAsync(healthNotificationIdentifier(taskId, kind))
    )
  );
}

function ownedHealthNotification(request: ExpoNotifications.NotificationRequest): { taskId: string; kind: HealthNotificationKind } | null {
  const data = request.content?.data as { healthTaskId?: unknown; kind?: unknown } | undefined;
  if (
    data &&
    typeof data.healthTaskId === 'string' &&
    typeof data.kind === 'string' &&
    (HEALTH_NOTIFICATION_KINDS as readonly string[]).includes(data.kind)
  ) {
    return { taskId: data.healthTaskId, kind: data.kind as HealthNotificationKind };
  }

  const parts = request.identifier.split(':');
  if (parts.length === 3 && parts[0] === 'health-notif' && (HEALTH_NOTIFICATION_KINDS as readonly string[]).includes(parts[2])) {
    return { taskId: parts[1], kind: parts[2] as HealthNotificationKind };
  }

  return null;
}

/**
 * Cancels every app-owned health-reminder notification currently scheduled
 * on the device whose task id is NOT in `currentTaskIds` — the same
 * "reconciled against what's actually scheduled on the OS" fix
 * cancelOrphanedWalkNotifications() applies for walks (BUG 4), so a task
 * deleted... well, health_tasks has no client DELETE (0049) — but this
 * still correctly cleans up a task that became invisible to THIS dog's
 * loaded set for any other reason (switched family, a sync conflict that
 * dropped it locally, etc.) without needing to enumerate why.
 */
async function cancelOrphanedHealthTaskNotifications(currentTaskIds: Set<string>): Promise<void> {
  const Notifications = await getNotifications();
  if (!Notifications) return;

  let scheduled: ExpoNotifications.NotificationRequest[];
  try {
    scheduled = await Notifications.getAllScheduledNotificationsAsync();
  } catch {
    return; // best-effort — must never break the rest of reconciliation
  }

  const toCancel = scheduled
    .map((request) => ({ request, owned: ownedHealthNotification(request) }))
    .filter(({ owned }) => owned && !currentTaskIds.has(owned.taskId))
    .map(({ request }) => request.identifier);

  await Promise.all(toCancel.map((id) => Notifications.cancelScheduledNotificationAsync(id)));
}

/**
 * Reconciliation pass for ONE dog's currently-loaded tasks (mirrors
 * reconcileWalkNotifications()'s doc comment) — call whenever healthStore's
 * `tasks` changes for the loaded dog (load(), saveTask(), completeTask()).
 * (Re)schedules every non-completed task's reminders from its current data,
 * cancels a completed one's outright, and finally cancels any orphaned
 * health-reminder notification on the device whose task id isn't in this
 * dog's set at all. Deterministic ids make repeated calls a safe no-op when
 * nothing changed. Degrades to "does nothing" in Expo Go / on Web.
 *
 * `now` is injectable (see scheduleHealthTaskNotifications' own doc
 * comment) and threaded through to every per-task call, so a whole
 * reconciliation pass can be exercised deterministically in tests.
 */
export async function reconcileHealthTaskNotifications(tasks: HealthTask[], dogName: string, now: Date = new Date()): Promise<void> {
  for (const task of tasks) {
    await scheduleHealthTaskNotifications(task, dogName, now);
  }
  await cancelOrphanedHealthTaskNotifications(new Set(tasks.map((t) => t.id)));
}
