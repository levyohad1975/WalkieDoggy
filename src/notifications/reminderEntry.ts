import type { NotificationKind } from '../types';
import { isDuplicateNotificationOpen, __resetNotificationOpenDedupForTests } from './notificationOpenDedup';

export interface ReminderOpenEvent {
  walkId: string;
  kind: NotificationKind;
}

const listeners = new Set<(event: ReminderOpenEvent) => void>();
let pendingEvent: ReminderOpenEvent | null = null;

/** Native notification responses, and (mascot-notification-experiences round) web notification-click events, are the sources of these events. */
export function publishReminderOpen(event: ReminderOpenEvent) {
  if (isDuplicateNotificationOpen(`reminder:${event.walkId}:${event.kind}`)) return;
  pendingEvent = event;
  listeners.forEach((listener) => listener(event));
}

export function subscribeToReminderOpens(listener: (event: ReminderOpenEvent) => void) {
  listeners.add(listener);
  if (pendingEvent) {
    const event = pendingEvent;
    pendingEvent = null;
    listener(event);
  }
  return () => { listeners.delete(listener); };
}

/**
 * Reject arbitrary notification data; only scheduled walk-reminder payloads
 * qualify.
 *
 * BUG FIX (mascot-notification-experiences round): this previously read
 * `data.kind`, but the actual server payload — built once, in
 * supabase/functions/send-walk-reminders/index.ts's `sendToRecipients()`
 * call, and sent unchanged to both the Expo push API and Web Push — names
 * the field `stage` (`{ type: 'walkReminder' | 'walkAttentionEscalation',
 * walkId, stage }`), never `kind`. `data.kind` was therefore always
 * `undefined` for a REAL notification tap on every platform, so this
 * function always returned null and publishReminderOpen() was never
 * actually reached from a real push — only from this file's own tests,
 * which constructed their input with the (wrong) `kind` field directly.
 * Reading `data.stage` here, and renaming it to this module's own `kind`
 * field on the returned event (an internal name, unrelated to the bug),
 * fixes the end-to-end path without touching anything server-side — the
 * server's payload was already correct.
 */
export function reminderOpenFromNotificationData(data: unknown): ReminderOpenEvent | null {
  if (!data || typeof data !== 'object') return null;
  const value = data as { type?: unknown; walkId?: unknown; stage?: unknown };
  if (value.type !== undefined && value.type !== 'walkReminder' && value.type !== 'walkAttentionEscalation') return null;
  if (typeof value.walkId !== 'string') return null;
  if (
    value.stage !== 'T-15' &&
    value.stage !== 'T' &&
    value.stage !== 'T+15' &&
    value.stage !== 'T+30'
  ) return null;
  return { walkId: value.walkId, kind: value.stage };
}

/**
 * Test-only hook: clears in-memory listener/pending-event state between
 * tests so one test's publishReminderOpen() can never leak into another
 * test's subscribeToReminderOpens() call via the "replay the last event to a
 * late subscriber" behavior above. Not used by production code paths.
 */
export function __resetReminderEntryForTests(): void {
  listeners.clear();
  pendingEvent = null;
  __resetNotificationOpenDedupForTests();
}
