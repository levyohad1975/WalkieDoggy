import { isDuplicateNotificationOpen, __resetNotificationOpenDedupForTests } from './notificationOpenDedup';

export type RequestOpenKind = 'swap' | 'timeChange';
export type RequestOpenEventKind = 'created' | 'approved' | 'rejected';

export interface RequestOpenEvent {
  requestId: string;
  kind: RequestOpenKind;
  event: RequestOpenEventKind;
}

const listeners = new Set<(event: RequestOpenEvent) => void>();
let pendingEvent: RequestOpenEvent | null = null;

/**
 * Mascot-notification-experiences round — the swap/time-change counterpart
 * to reminderEntry.ts's publishReminderOpen(), same shape and same
 * publish/subscribe/replay-to-late-subscriber pattern. Sources: a web
 * notification-click (src/lib/webNotificationEntry.ts) or a native
 * notification response (src/notifications/notificationService.ts),
 * whenever the tapped notification's payload matches
 * requestOpenFromNotificationData() below.
 */
export function publishRequestOpen(event: RequestOpenEvent) {
  if (isDuplicateNotificationOpen(`request:${event.requestId}:${event.event}`)) return;
  pendingEvent = event;
  listeners.forEach((listener) => listener(event));
}

export function subscribeToRequestOpens(listener: (event: RequestOpenEvent) => void) {
  listeners.add(listener);
  if (pendingEvent) {
    const event = pendingEvent;
    pendingEvent = null;
    listener(event);
  }
  return () => { listeners.delete(listener); };
}

/**
 * Reject arbitrary notification data; only swap/time-change request
 * payloads qualify. Matches the exact shape
 * supabase/functions/send-request-push/index.ts sends (both Expo push and
 * Web Push): `{ type: 'request', requestId, kind: 'swap' | 'timeChange',
 * event: 'created' | 'approved' | 'rejected' }` — see that function's own
 * `data: { type: 'request', requestId: row.id, kind: row.kind, event }`.
 */
export function requestOpenFromNotificationData(data: unknown): RequestOpenEvent | null {
  if (!data || typeof data !== 'object') return null;
  const value = data as { type?: unknown; requestId?: unknown; kind?: unknown; event?: unknown };
  if (value.type !== 'request') return null;
  if (typeof value.requestId !== 'string') return null;
  if (value.kind !== 'swap' && value.kind !== 'timeChange') return null;
  if (value.event !== 'created' && value.event !== 'approved' && value.event !== 'rejected') return null;
  return { requestId: value.requestId, kind: value.kind, event: value.event };
}

/**
 * Test-only hook: clears in-memory listener/pending-event/dedupe state
 * between tests. Not used by production code paths.
 */
export function __resetRequestEntryForTests(): void {
  listeners.clear();
  pendingEvent = null;
  __resetNotificationOpenDedupForTests();
}
