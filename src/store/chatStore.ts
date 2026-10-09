import { create } from 'zustand';
import { generateId } from '../lib/id';
import { friendlyErrorMessage } from '../lib/errorMessages';
import {
  getChatTransport,
  isChatBackendMissing,
  isChatNetworkError,
  type ChatLiveStatus,
} from '../lib/chat';
import {
  CHAT_PAGE_SIZE,
  mergeChatMessages,
  validateChatBody,
} from '../logic/chat';
import type { ChatConversationState, ChatMessage } from '../types';

/**
 * Family Chat client state (see lib/chat.ts for why this is not routed
 * through the offline-first Repository).
 *
 * LIFECYCLE. Exactly one conversation session is live at a time, keyed by
 * "family + profile". start() tears the previous session down first, so
 * switching family or profile, signing out, or unmounting the navigator can
 * never leave a Realtime channel subscribed to the wrong family. Every async
 * continuation re-checks its session token (`generation`) and drops its
 * result if the session changed underneath it — a slow response for family A
 * can never be written into family B's screen.
 *
 * DUPLICATES. A message id is generated once on this device and reused for
 * every retry; the server treats it as an idempotency key and the list is
 * merged by id, so the optimistic bubble, the RPC result and the Realtime
 * echo of the same message are always one bubble.
 */

export type ChatStatus =
  | 'idle'
  | 'loading'
  | 'ready'
  | 'error'
  /** Migration 0108 is not applied on this environment yet. */
  | 'unavailable';

export type ChatSendResult =
  | { ok: true }
  | { ok: false; reason: 'empty' | 'too_long' | 'not_ready' };

interface ChatState {
  status: ChatStatus;
  errorMessage: string | null;
  /** A transient failure of a single action (delete / mute), shown as a banner. */
  actionError: string | null;
  conversation: ChatConversationState | null;
  messages: ChatMessage[];
  hasMore: boolean;
  loadingOlder: boolean;
  unreadCount: number;
  /** Read marker captured when the screen was opened — positions the "new messages" divider. */
  unreadDividerFrom: string | null;
  live: ChatLiveStatus;
  online: boolean;
  /** True while the chat screen is focused AND the app is in the foreground. */
  screenActive: boolean;
  /** Why a given unsent message failed, when the reason is not just "no connection". */
  sendErrors: Record<string, string>;

  start: (sessionKey: string) => Promise<void>;
  stop: () => void;
  refresh: () => Promise<void>;
  resync: () => Promise<void>;
  loadOlder: () => Promise<void>;
  send: (draft: string) => ChatSendResult;
  retry: (messageId: string) => void;
  discard: (messageId: string) => void;
  remove: (messageId: string) => Promise<boolean>;
  setMuted: (muted: boolean) => Promise<void>;
  setScreenActive: (active: boolean) => void;
  setOnline: (online: boolean) => void;
  clearActionError: () => void;
}

const INITIAL = {
  status: 'idle' as ChatStatus,
  errorMessage: null,
  actionError: null,
  conversation: null,
  messages: [] as ChatMessage[],
  hasMore: false,
  loadingOlder: false,
  unreadCount: 0,
  unreadDividerFrom: null,
  live: 'reconnecting' as ChatLiveStatus,
  sendErrors: {} as Record<string, string>,
};

// Session bookkeeping lives outside the store: none of it is render state.
let generation = 0;
let activeSessionKey: string | null = null;
let unsubscribe: (() => void) | null = null;
let hasBeenLive = false;
const inFlight = new Set<string>();
let markReadTimer: ReturnType<typeof setTimeout> | null = null;
let unreadRefreshTimer: ReturnType<typeof setTimeout> | null = null;

const LOAD_ERROR_MESSAGE = 'לא הצלחנו לטעון את הצ׳אט. בדקו את החיבור ונסו שוב.';

function clearTimers() {
  if (markReadTimer) clearTimeout(markReadTimer);
  if (unreadRefreshTimer) clearTimeout(unreadRefreshTimer);
  markReadTimer = null;
  unreadRefreshTimer = null;
}

function latestConfirmed(messages: ChatMessage[]): ChatMessage | undefined {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    if (messages[i].delivery === 'sent') return messages[i];
  }
  return undefined;
}

export const useChatStore = create<ChatState>((set, get) => {
  const isCurrent = (token: number) => token === generation;

  /** Advances the server read marker to the newest confirmed message. Debounced: a burst of arrivals is one call. */
  const scheduleMarkRead = () => {
    if (markReadTimer) clearTimeout(markReadTimer);
    const token = generation;
    markReadTimer = setTimeout(() => {
      markReadTimer = null;
      if (!isCurrent(token)) return;
      const { conversation, messages, screenActive } = get();
      if (!conversation || !screenActive) return;
      const newest = latestConfirmed(messages);
      const readAt = newest?.createdAt;
      if (!readAt || readAt <= conversation.lastReadAt) {
        if (get().unreadCount !== 0) set({ unreadCount: 0 });
        return;
      }
      set({ unreadCount: 0, conversation: { ...conversation, lastReadAt: readAt } });
      getChatTransport()
        .markRead(conversation.conversationId, readAt)
        .catch(() => {
          // Best-effort: the next open() re-reads the true counter.
        });
    }, 400);
  };

  /** Re-reads the authoritative unread counter (used when a change cannot be counted locally). */
  const scheduleUnreadRefresh = () => {
    if (unreadRefreshTimer) clearTimeout(unreadRefreshTimer);
    const token = generation;
    unreadRefreshTimer = setTimeout(() => {
      unreadRefreshTimer = null;
      if (!isCurrent(token) || get().screenActive) return;
      getChatTransport()
        .open()
        .then((conversation) => {
          if (!isCurrent(token) || get().screenActive) return;
          set({ unreadCount: conversation.unreadCount });
        })
        .catch(() => undefined);
    }, 600);
  };

  const handleIncoming = (token: number, message: ChatMessage) => {
    if (!isCurrent(token)) return;
    const { messages, conversation, screenActive } = get();
    if (!conversation || message.conversationId !== conversation.conversationId) return;

    const known = messages.find((m) => m.id === message.id);
    set({ messages: mergeChatMessages(messages, [message]) });

    if (screenActive) {
      scheduleMarkRead();
      return;
    }
    const fromSomeoneElse = message.senderUserId !== conversation.userId;
    if (!known && fromSomeoneElse && !message.deletedAt) {
      set({ unreadCount: get().unreadCount + 1 });
    } else if (message.deletedAt && fromSomeoneElse) {
      // An unread message was moderated away: ask the server for the truth.
      scheduleUnreadRefresh();
    }
  };

  const deliver = async (token: number, message: ChatMessage) => {
    if (inFlight.has(message.id)) return;
    const { conversation } = get();
    if (!conversation) return;
    inFlight.add(message.id);
    try {
      const confirmed = await getChatTransport().send(conversation.conversationId, message.id, message.body);
      if (!isCurrent(token)) return;
      const sendErrors = { ...get().sendErrors };
      delete sendErrors[message.id];
      set({ messages: mergeChatMessages(get().messages, [confirmed]), sendErrors });
      if (get().screenActive) scheduleMarkRead();
      void getChatTransport().notify(confirmed.id);
    } catch (error) {
      if (!isCurrent(token)) return;
      if (isChatBackendMissing(error)) {
        set({ status: 'unavailable' });
      }
      const sendErrors = { ...get().sendErrors };
      if (isChatNetworkError(error) || !get().online) {
        delete sendErrors[message.id];
      } else {
        sendErrors[message.id] = friendlyErrorMessage(error, [], 'ההודעה לא נשלחה. נסו שוב.');
      }
      set({
        messages: get().messages.map((m) => (m.id === message.id ? { ...m, delivery: 'failed' as const } : m)),
        sendErrors,
      });
    } finally {
      inFlight.delete(message.id);
    }
  };

  /** Re-sends everything that failed only because there was no connection, oldest first. */
  const flushUnsent = async (token: number) => {
    const pending = get().messages.filter((m) => m.delivery === 'failed' && !get().sendErrors[m.id]);
    for (const message of pending) {
      if (!isCurrent(token) || !get().online) return;
      set({ messages: get().messages.map((m) => (m.id === message.id ? { ...m, delivery: 'sending' as const } : m)) });
      await deliver(token, { ...message, delivery: 'sending' });
    }
  };

  const loadLatest = async (token: number): Promise<void> => {
    const transport = getChatTransport();
    const conversation = await transport.open();
    if (!isCurrent(token)) return;
    const page = await transport.listMessages(conversation.conversationId, { limit: CHAT_PAGE_SIZE });
    if (!isCurrent(token)) return;

    const previous = get().conversation;
    const sameConversation = previous?.conversationId === conversation.conversationId;
    // Keep what this device already holds (older pages, unsent bubbles) when
    // re-syncing the same conversation; start clean for a different one.
    const base = sameConversation ? get().messages : [];
    const screenActive = get().screenActive;

    set({
      status: 'ready',
      errorMessage: null,
      conversation,
      messages: mergeChatMessages(base, page),
      hasMore: sameConversation ? get().hasMore || page.length >= CHAT_PAGE_SIZE : page.length >= CHAT_PAGE_SIZE,
      unreadCount: screenActive ? 0 : conversation.unreadCount,
      unreadDividerFrom:
        screenActive && !sameConversation && conversation.unreadCount > 0
          ? conversation.lastReadAt
          : get().unreadDividerFrom,
    });

    if (!sameConversation) {
      unsubscribe?.();
      hasBeenLive = false;
      unsubscribe = transport.subscribe(conversation.conversationId, {
        onMessage: (message) => handleIncoming(token, message),
        onStatus: (live) => {
          if (!isCurrent(token)) return;
          const wasLive = get().live === 'live';
          set({ live });
          if (live === 'live') {
            // A re-established stream may have missed messages while it was
            // down. The very first SUBSCRIBED needs no catch-up.
            if (hasBeenLive && !wasLive) void get().resync();
            hasBeenLive = true;
          }
        },
      });
    }

    if (screenActive) scheduleMarkRead();
  };

  return {
    ...INITIAL,
    online: true,
    screenActive: false,

    start: async (sessionKey) => {
      if (activeSessionKey === sessionKey && get().status !== 'idle') return;
      get().stop();
      activeSessionKey = sessionKey;
      const token = generation;
      set({ status: 'loading' });
      try {
        await loadLatest(token);
      } catch (error) {
        if (!isCurrent(token)) return;
        if (isChatBackendMissing(error)) {
          set({ status: 'unavailable', errorMessage: null });
        } else {
          set({ status: 'error', errorMessage: friendlyErrorMessage(error, [], LOAD_ERROR_MESSAGE) });
        }
      }
    },

    stop: () => {
      generation += 1;
      activeSessionKey = null;
      clearTimers();
      inFlight.clear();
      hasBeenLive = false;
      const release = unsubscribe;
      unsubscribe = null;
      release?.();
      set({ ...INITIAL });
    },

    refresh: async () => {
      const key = activeSessionKey;
      if (!key) return;
      const token = generation;
      if (get().status !== 'ready') set({ status: 'loading', errorMessage: null });
      try {
        await loadLatest(token);
      } catch (error) {
        if (!isCurrent(token)) return;
        if (isChatBackendMissing(error)) {
          set({ status: 'unavailable', errorMessage: null });
        } else if (get().status !== 'ready') {
          set({ status: 'error', errorMessage: friendlyErrorMessage(error, [], LOAD_ERROR_MESSAGE) });
        }
      }
    },

    resync: async () => {
      if (!activeSessionKey || get().status === 'idle' || get().status === 'loading') return;
      const token = generation;
      await get().refresh();
      if (isCurrent(token) && get().status === 'ready') await flushUnsent(token);
    },

    loadOlder: async () => {
      const { conversation, messages, hasMore, loadingOlder } = get();
      if (!conversation || !hasMore || loadingOlder) return;
      const oldest = messages.find((m) => m.delivery === 'sent');
      if (!oldest) return;
      const token = generation;
      set({ loadingOlder: true });
      try {
        const page = await getChatTransport().listMessages(conversation.conversationId, {
          before: oldest.createdAt,
          limit: CHAT_PAGE_SIZE,
        });
        if (!isCurrent(token)) return;
        const known = new Set(get().messages.map((m) => m.id));
        const fresh = page.filter((m) => !known.has(m.id));
        set({
          messages: mergeChatMessages(get().messages, fresh),
          // A full page that still produced something new means there may be more.
          hasMore: fresh.length > 0 && page.length >= CHAT_PAGE_SIZE,
          loadingOlder: false,
        });
      } catch (error) {
        if (!isCurrent(token)) return;
        set({
          loadingOlder: false,
          actionError: friendlyErrorMessage(error, [], 'לא הצלחנו לטעון הודעות קודמות. נסו שוב.'),
        });
      }
    },

    send: (draft) => {
      const { conversation, status } = get();
      if (!conversation || status !== 'ready') return { ok: false, reason: 'not_ready' };
      const validation = validateChatBody(draft);
      if (!validation.ok) return { ok: false, reason: validation.reason };

      const message: ChatMessage = {
        id: generateId(),
        conversationId: conversation.conversationId,
        familyId: conversation.familyId,
        senderUserId: conversation.userId,
        body: validation.body,
        createdAt: new Date().toISOString(),
        delivery: get().online ? 'sending' : 'failed',
      };
      set({ messages: mergeChatMessages(get().messages, [message]) });
      // Offline: keep it as a visibly-unsent bubble; setOnline(true) / resync flushes it.
      if (get().online) void deliver(generation, message);
      return { ok: true };
    },

    retry: (messageId) => {
      const message = get().messages.find((m) => m.id === messageId);
      if (!message || message.delivery !== 'failed' || inFlight.has(messageId)) return;
      const sendErrors = { ...get().sendErrors };
      delete sendErrors[messageId];
      set({
        sendErrors,
        messages: get().messages.map((m) => (m.id === messageId ? { ...m, delivery: 'sending' as const } : m)),
      });
      void deliver(generation, { ...message, delivery: 'sending' });
    },

    discard: (messageId) => {
      const message = get().messages.find((m) => m.id === messageId);
      if (!message || message.delivery !== 'failed' || inFlight.has(messageId)) return;
      const sendErrors = { ...get().sendErrors };
      delete sendErrors[messageId];
      set({ sendErrors, messages: get().messages.filter((m) => m.id !== messageId) });
    },

    remove: async (messageId) => {
      const token = generation;
      try {
        const removed = await getChatTransport().remove(messageId);
        if (!isCurrent(token)) return false;
        set({ messages: mergeChatMessages(get().messages, [removed]) });
        return true;
      } catch (error) {
        if (!isCurrent(token)) return false;
        set({ actionError: friendlyErrorMessage(error, [], 'לא הצלחנו למחוק את ההודעה. נסו שוב.') });
        return false;
      }
    },

    setMuted: async (muted) => {
      const { conversation } = get();
      if (!conversation) return;
      const token = generation;
      const before = conversation.notificationsMuted;
      set({ conversation: { ...conversation, notificationsMuted: muted } });
      try {
        await getChatTransport().setMuted(conversation.conversationId, muted);
      } catch (error) {
        if (!isCurrent(token)) return;
        const current = get().conversation;
        set({
          conversation: current ? { ...current, notificationsMuted: before } : current,
          actionError: friendlyErrorMessage(error, [], 'לא הצלחנו לעדכן את ההתראות. נסו שוב.'),
        });
      }
    },

    setScreenActive: (active) => {
      if (get().screenActive === active) return;
      if (active) {
        const { conversation, unreadCount } = get();
        set({
          screenActive: true,
          unreadDividerFrom: conversation && unreadCount > 0 ? conversation.lastReadAt : null,
        });
        if (conversation) scheduleMarkRead();
      } else {
        set({ screenActive: false, unreadDividerFrom: null });
      }
    },

    setOnline: (online) => {
      if (get().online === online) return;
      set({ online });
      if (online) void get().resync();
    },

    clearActionError: () => set({ actionError: null }),
  };
});

/** Test-only: returns the store and its module-level session state to a clean slate. */
export function __resetChatStoreForTests(): void {
  useChatStore.getState().stop();
  useChatStore.setState({ online: true, screenActive: false });
}
