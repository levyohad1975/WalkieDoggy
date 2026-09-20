import type { NotificationKind } from '../types';

export interface ReminderOpenEvent {
  walkId: string;
  kind: NotificationKind;
}

const listeners = new Set<(event: ReminderOpenEvent) => void>();
let pendingEvent: ReminderOpenEvent | null = null;

/** Native notification responses are the sole source of these events. */
export function publishReminderOpen(event: ReminderOpenEvent) {
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

/** Reject arbitrary notification data; only scheduled walk-reminder payloads qualify. */
export function reminderOpenFromNotificationData(data: unknown): ReminderOpenEvent | null {
  if (!data || typeof data !== 'object') return null;
  const value = data as { walkId?: unknown; kind?: unknown };
  if (typeof value.walkId !== 'string') return null;
  if (value.kind !== 'pre_walk_reminder' && value.kind !== 'overdue_reminder') return null;
  return { walkId: value.walkId, kind: value.kind };
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
}
