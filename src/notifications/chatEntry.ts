import { isDuplicateNotificationOpen } from './notificationOpenDedup';

export interface ChatOpenEvent {
  conversationId: string;
  messageId?: string;
}

const listeners = new Set<(event: ChatOpenEvent) => void>();
let pendingEvent: ChatOpenEvent | null = null;

/**
 * Family Chat counterpart to requestEntry.ts / reminderEntry.ts — same
 * publish / subscribe / replay-to-a-late-subscriber shape. A tapped chat
 * notification (web: src/lib/webNotificationEntry.ts, native:
 * notificationService.ts) publishes here; RootNavigator subscribes and
 * switches to the Chat tab. The event carries no message content and grants
 * nothing: the screen still loads the conversation under the caller's own
 * server-side access.
 */
export function publishChatOpen(event: ChatOpenEvent) {
  if (isDuplicateNotificationOpen(`chat:${event.conversationId}:${event.messageId ?? ''}`)) return;
  pendingEvent = event;
  listeners.forEach((listener) => listener(event));
}

export function subscribeToChatOpens(listener: (event: ChatOpenEvent) => void) {
  listeners.add(listener);
  if (pendingEvent) {
    const event = pendingEvent;
    pendingEvent = null;
    listener(event);
  }
  return () => {
    listeners.delete(listener);
  };
}

/** A consumer that handled the event live clears it so it is not replayed to a later subscriber. */
export function consumePendingChatOpen(): void {
  pendingEvent = null;
}

/**
 * Accepts only the exact payload supabase/functions/send-chat-push sends:
 * `{ type: 'chat', conversationId, messageId }`.
 */
export function chatOpenFromNotificationData(data: unknown): ChatOpenEvent | null {
  if (!data || typeof data !== 'object') return null;
  const value = data as { type?: unknown; conversationId?: unknown; messageId?: unknown };
  if (value.type !== 'chat') return null;
  if (typeof value.conversationId !== 'string' || value.conversationId.length === 0) return null;
  return {
    conversationId: value.conversationId,
    messageId: typeof value.messageId === 'string' ? value.messageId : undefined,
  };
}

/** Test-only hook. Not used by production code paths. */
export function __resetChatEntryForTests(): void {
  listeners.clear();
  pendingEvent = null;
}
