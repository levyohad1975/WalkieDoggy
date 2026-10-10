import { create } from 'zustand';
import { generateId } from '../lib/id';
import { friendlyErrorMessage } from '../lib/errorMessages';
import {
  ChatUploadCancelledError,
  clearChatAttachmentUrlCache,
  getChatTransport,
  isChatBackendMissing,
  isChatNetworkError,
  type ChatCapabilities,
  type ChatLiveStatus,
  type ChatUploadHandle,
} from '../lib/chat';
import { releasePreparedChatImage, type PreparedChatImage } from '../lib/chatImages';
import {
  CHAT_PAGE_SIZE,
  applyMessageToConversations,
  mergeChatMessages,
  sortChatConversations,
  totalUnreadChatMessages,
  validateChatBody,
} from '../logic/chat';
import { chatAttachmentPath, checkPreparedChatImage } from '../logic/chatImages';
import type { ChatConversationState, ChatMessage } from '../types';

/**
 * Chat client state: the conversation list (the family conversation plus the
 * signed-in profile's private conversations) and one message thread per
 * conversation that has been opened. See lib/chat.ts for why this is not
 * routed through the offline-first Repository.
 *
 * LIFECYCLE. Exactly one session is live at a time, keyed by "family +
 * profile". start() tears the previous session down first — releasing its
 * Realtime channel and dropping every conversation, message, image preview
 * and signed URL held in memory — so switching family or profile, signing
 * out, or unmounting the navigator can never leave one person's private
 * messages readable by the next. Every async continuation re-checks its
 * session token (`generation`) and drops its result if the session changed
 * underneath it.
 *
 * DUPLICATES. A message id is generated once on this device and reused for
 * every retry; the server treats it as an idempotency key and threads are
 * merged by id, so the optimistic bubble, the RPC result and the Realtime
 * echo of the same message are always one bubble. An image's file is named
 * after its message id, so a retried upload lands on the same object.
 */

export type ChatStatus =
  | 'idle'
  | 'loading'
  | 'ready'
  | 'error'
  /** Migration 0108 is not applied on this environment yet. */
  | 'unavailable';

export type ChatThreadStatus = 'idle' | 'loading' | 'ready' | 'error';

export interface ChatThread {
  status: ChatThreadStatus;
  messages: ChatMessage[];
  hasMore: boolean;
  loadingOlder: boolean;
}

export type ChatSendResult =
  | { ok: true }
  | { ok: false; reason: 'empty' | 'too_long' | 'not_ready' | 'invalid_image' };

const NO_CAPABILITIES: ChatCapabilities = { privateConversations: false, images: false };
const EMPTY_THREAD: ChatThread = { status: 'idle', messages: [], hasMore: false, loadingOlder: false };

interface ChatState {
  status: ChatStatus;
  errorMessage: string | null;
  /** A transient failure of a single action, shown as a dismissible banner. */
  actionError: string | null;
  capabilities: ChatCapabilities;
  conversations: ChatConversationState[];
  /** Message threads by conversation id; present once a conversation has been opened. */
  threads: Record<string, ChatThread>;
  /** The conversation currently open on screen, if any. */
  activeConversationId: string | null;
  /** Unread messages across ALL conversations — the Chat tab badge. */
  unreadCount: number;
  /** Read marker captured when the open conversation was entered — positions the "new messages" divider. */
  unreadDividerFrom: string | null;
  live: ChatLiveStatus;
  online: boolean;
  /** True while the chat screen is focused AND the app is in the foreground. */
  screenActive: boolean;
  /** Why a given unsent message failed, when the reason is not just "no connection". */
  sendErrors: Record<string, string>;
  /** True while a private conversation is being opened/created. */
  openingDirect: boolean;

  start: (sessionKey: string) => Promise<void>;
  stop: () => void;
  refresh: () => Promise<void>;
  resync: () => Promise<void>;
  openConversation: (conversationId: string) => void;
  /** Opens a conversation as soon as it is known (used by a tapped notification that can arrive before the list). */
  requestOpenConversation: (conversationId: string) => void;
  closeConversation: () => void;
  startDirect: (otherUserId: string) => Promise<string | null>;
  loadOlder: () => Promise<void>;
  send: (draft: string) => ChatSendResult;
  sendImage: (image: PreparedChatImage, caption: string) => ChatSendResult;
  retry: (messageId: string) => void;
  /** Removes an unsent message; for an image that is still uploading this cancels the upload. */
  discard: (messageId: string) => void;
  remove: (messageId: string) => Promise<boolean>;
  removeMany: (messageIds: string[]) => Promise<boolean>;
  clearForMe: () => Promise<boolean>;
  clearForEveryone: () => Promise<boolean>;
  setMuted: (muted: boolean) => Promise<void>;
  setScreenActive: (active: boolean) => void;
  setOnline: (online: boolean) => void;
  clearActionError: () => void;
}

const INITIAL = {
  status: 'idle' as ChatStatus,
  errorMessage: null,
  actionError: null,
  capabilities: NO_CAPABILITIES,
  conversations: [] as ChatConversationState[],
  threads: {} as Record<string, ChatThread>,
  activeConversationId: null as string | null,
  unreadCount: 0,
  unreadDividerFrom: null as string | null,
  live: 'reconnecting' as ChatLiveStatus,
  sendErrors: {} as Record<string, string>,
  openingDirect: false,
};

// Session bookkeeping lives outside the store: none of it is render state.
let generation = 0;
let activeSessionKey: string | null = null;
let unsubscribe: (() => void) | null = null;
let hasBeenLive = false;
let pendingOpenId: string | null = null;
const inFlight = new Set<string>();
/** Ids already counted, so a redelivered Realtime event never bumps the badge twice. */
const countedIds = new Set<string>();
let markReadTimer: ReturnType<typeof setTimeout> | null = null;
let listRefreshTimer: ReturnType<typeof setTimeout> | null = null;

interface PendingImage {
  image: PreparedChatImage;
  path: string;
  uploaded: boolean;
  handle: ChatUploadHandle | null;
}
/** Images this device is still sending, by message id. Held in memory only. */
const pendingImages = new Map<string, PendingImage>();
/** Local previews of images this device sent, by storage path — shown instantly instead of re-downloading. */
const localPreviews = new Map<string, PreparedChatImage>();

/** A local preview for an image this device sent in the current session, if any. */
export function getLocalChatImagePreview(path: string): string | undefined {
  return localPreviews.get(path)?.uri;
}

const LOAD_ERROR_MESSAGE = 'לא הצלחנו לטעון את הצ׳אט. בדקו את החיבור ונסו שוב.';

function clearTimers() {
  if (markReadTimer) clearTimeout(markReadTimer);
  if (listRefreshTimer) clearTimeout(listRefreshTimer);
  markReadTimer = null;
  listRefreshTimer = null;
}

function latestConfirmed(messages: ChatMessage[]): ChatMessage | undefined {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    if (messages[i].delivery === 'sent') return messages[i];
  }
  return undefined;
}

export const useChatStore = create<ChatState>((set, get) => {
  const isCurrent = (token: number) => token === generation;

  const setConversations = (conversations: ChatConversationState[]) => {
    const sorted = sortChatConversations(conversations);
    set({ conversations: sorted, unreadCount: totalUnreadChatMessages(sorted) });
  };

  const threadOf = (conversationId: string): ChatThread => get().threads[conversationId] ?? EMPTY_THREAD;

  const patchThread = (conversationId: string, patch: Partial<ChatThread>) => {
    set({ threads: { ...get().threads, [conversationId]: { ...threadOf(conversationId), ...patch } } });
  };

  const patchMessage = (message: Pick<ChatMessage, 'id' | 'conversationId'>, patch: Partial<ChatMessage>) => {
    const thread = threadOf(message.conversationId);
    patchThread(message.conversationId, {
      messages: thread.messages.map((m) => (m.id === message.id ? { ...m, ...patch } : m)),
    });
  };

  const isBeingRead = (conversationId: string) =>
    get().screenActive && get().activeConversationId === conversationId;

  /** Advances the server read marker of the open conversation to its newest confirmed message. Debounced. */
  const scheduleMarkRead = () => {
    if (markReadTimer) clearTimeout(markReadTimer);
    const token = generation;
    markReadTimer = setTimeout(() => {
      markReadTimer = null;
      if (!isCurrent(token)) return;
      const { activeConversationId, screenActive, conversations } = get();
      if (!activeConversationId || !screenActive) return;
      const conversation = conversations.find((c) => c.conversationId === activeConversationId);
      if (!conversation) return;
      const newest = latestConfirmed(threadOf(activeConversationId).messages);
      const readAt = newest?.createdAt;
      if (!readAt || readAt <= conversation.lastReadAt) {
        if (conversation.unreadCount !== 0) {
          setConversations(conversations.map((c) => (c.conversationId === activeConversationId ? { ...c, unreadCount: 0 } : c)));
        }
        return;
      }
      setConversations(
        conversations.map((c) => (c.conversationId === activeConversationId ? { ...c, unreadCount: 0, lastReadAt: readAt } : c))
      );
      getChatTransport()
        .markRead(activeConversationId, readAt)
        .catch(() => {
          // Best-effort: the next list refresh re-reads the true counter.
        });
    }, 400);
  };

  const loadList = async (token: number): Promise<void> => {
    const transport = getChatTransport();
    const listing = await transport.listConversations();
    if (!isCurrent(token)) return;

    const reading = get().screenActive ? get().activeConversationId : null;
    setConversations(
      listing.conversations.map((c) => (c.conversationId === reading ? { ...c, unreadCount: 0 } : c))
    );
    set({ status: 'ready', errorMessage: null, capabilities: listing.capabilities });

    if (!unsubscribe) {
      hasBeenLive = false;
      unsubscribe = transport.subscribe({
        onMessage: (message) => handleIncoming(token, message),
        onConversationCleared: (conversationId, clearedAt) => {
          if (!isCurrent(token)) return;
          applyConversationClear(conversationId, clearedAt);
          void get().refresh();
        },
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

    if (pendingOpenId && listing.conversations.some((c) => c.conversationId === pendingOpenId)) {
      const target = pendingOpenId;
      pendingOpenId = null;
      get().openConversation(target);
    }
  };

  /** Re-reads the authoritative list (new private conversation, moderated unread message, ...). Debounced. */
  const scheduleListRefresh = () => {
    if (listRefreshTimer) clearTimeout(listRefreshTimer);
    const token = generation;
    listRefreshTimer = setTimeout(() => {
      listRefreshTimer = null;
      if (!isCurrent(token) || get().status !== 'ready') return;
      loadList(token).catch(() => undefined);
    }, 600);
  };

  const loadThread = async (token: number, conversationId: string): Promise<void> => {
    const existing = threadOf(conversationId);
    if (existing.status !== 'ready') patchThread(conversationId, { status: 'loading' });
    try {
      const page = await getChatTransport().listMessages(conversationId, { limit: CHAT_PAGE_SIZE });
      if (!isCurrent(token)) return;
      const current = threadOf(conversationId);
      const wasLoaded = current.status === 'ready';
      page.forEach((m) => countedIds.add(m.id));
      patchThread(conversationId, {
        status: 'ready',
        // Keep what this device already holds (older pages, unsent bubbles).
        messages: mergeChatMessages(current.messages, page),
        hasMore: wasLoaded ? current.hasMore || page.length >= CHAT_PAGE_SIZE : page.length >= CHAT_PAGE_SIZE,
      });
      if (isBeingRead(conversationId)) scheduleMarkRead();
    } catch (error) {
      if (!isCurrent(token)) return;
      if (threadOf(conversationId).status !== 'ready') patchThread(conversationId, { status: 'error' });
      throw error;
    }
  };

  function handleIncoming(token: number, message: ChatMessage) {
    if (!isCurrent(token)) return;
    const { conversations } = get();
    const conversation = conversations.find((c) => c.conversationId === message.conversationId);
    if (!conversation) {
      // A conversation this session does not know: either a private
      // conversation someone just started with this profile, or something
      // this profile is not part of. Never store it — ask the server, which
      // only lists what the caller may see.
      scheduleListRefresh();
      return;
    }

    const thread = get().threads[message.conversationId];
    const knownInThread = Boolean(thread?.messages.some((m) => m.id === message.id));
    const alreadyCounted = countedIds.has(message.id);
    countedIds.add(message.id);
    const reading = isBeingRead(message.conversationId);

    if (thread && thread.status === 'ready') {
      patchThread(message.conversationId, { messages: mergeChatMessages(thread.messages, [message]) });
    }

    const isNew = !knownInThread && !alreadyCounted && message.createdAt > conversation.lastReadAt;
    setConversations(applyMessageToConversations(get().conversations, message, { isNew, isBeingRead: reading }));

    if (reading) {
      scheduleMarkRead();
    } else if (message.deletedAt && message.senderUserId !== conversation.userId) {
      // An unread message may have been removed: ask the server for the truth.
      scheduleListRefresh();
    }
  }

  const failMessage = (message: ChatMessage, error: unknown) => {
    const sendErrors = { ...get().sendErrors };
    if (isChatNetworkError(error) || !get().online) {
      delete sendErrors[message.id];
    } else {
      sendErrors[message.id] = friendlyErrorMessage(error, [], 'ההודעה לא נשלחה. נסו שוב.');
    }
    set({ sendErrors });
    patchMessage(message, { delivery: 'failed' });
  };

  const deliver = async (token: number, message: ChatMessage) => {
    if (inFlight.has(message.id)) return;
    inFlight.add(message.id);
    const transport = getChatTransport();
    try {
      let confirmed: ChatMessage;
      const pending = pendingImages.get(message.id);
      if (pending) {
        if (!pending.uploaded) {
          pending.handle = transport.uploadAttachment(pending.path, pending.image, (fraction) => {
            if (!isCurrent(token)) return;
            const current = threadOf(message.conversationId).messages.find((m) => m.id === message.id);
            if (current?.upload) patchMessage(message, { upload: { ...current.upload, progress: fraction } });
          });
          await pending.handle.promise;
          pending.handle = null;
          pending.uploaded = true;
        }
        if (!isCurrent(token)) return;
        confirmed = await transport.sendImage(
          message.conversationId,
          message.id,
          { path: pending.path, width: pending.image.width, height: pending.image.height },
          message.body
        );
        localPreviews.set(pending.path, pending.image);
        pendingImages.delete(message.id);
      } else {
        confirmed = await transport.send(message.conversationId, message.id, message.body);
      }
      if (!isCurrent(token)) return;

      countedIds.add(confirmed.id);
      const sendErrors = { ...get().sendErrors };
      delete sendErrors[message.id];
      set({ sendErrors });
      patchThread(message.conversationId, {
        messages: mergeChatMessages(threadOf(message.conversationId).messages, [confirmed]),
      });
      setConversations(applyMessageToConversations(get().conversations, confirmed, { isNew: false, isBeingRead: true }));
      if (isBeingRead(message.conversationId)) scheduleMarkRead();
      void transport.notify(confirmed.id);
    } catch (error) {
      if (!isCurrent(token)) return;
      if (error instanceof ChatUploadCancelledError) {
        // discard() already removed the bubble; nothing was sent.
        return;
      }
      if (isChatBackendMissing(error)) set({ status: 'unavailable' });
      failMessage(message, error);
    } finally {
      inFlight.delete(message.id);
    }
  };

  /** Re-sends everything that failed only because there was no connection, oldest first. */
  const flushUnsent = async (token: number) => {
    const pending = Object.values(get().threads)
      .flatMap((thread) => thread.messages)
      .filter((m) => m.delivery === 'failed' && !get().sendErrors[m.id]);
    for (const message of pending) {
      if (!isCurrent(token) || !get().online) return;
      patchMessage(message, { delivery: 'sending' });
      await deliver(token, { ...message, delivery: 'sending' });
    }
  };

  const enqueue = (message: ChatMessage) => {
    const thread = threadOf(message.conversationId);
    patchThread(message.conversationId, { messages: mergeChatMessages(thread.messages, [message]) });
    // Offline: keep it as a visibly-unsent bubble; setOnline(true) / resync flushes it.
    if (get().online) void deliver(generation, message);
  };

  const activeConversation = (): ChatConversationState | undefined => {
    const { activeConversationId, conversations } = get();
    return activeConversationId ? conversations.find((c) => c.conversationId === activeConversationId) : undefined;
  };

  const applyConversationClear = (conversationId: string, clearedAt: string) => {
    const clearedMs = Date.parse(clearedAt);
    patchThread(conversationId, {
      messages: threadOf(conversationId).messages.filter((message) => Date.parse(message.createdAt) > clearedMs),
    });
    setConversations(get().conversations.map((item) => item.conversationId === conversationId
      ? { ...item, unreadCount: 0, lastReadAt: clearedAt, lastMessage: undefined, lastActivityAt: clearedAt }
      : item));
  };

  const releaseSessionMedia = () => {
    pendingImages.forEach((pending) => {
      pending.handle?.cancel();
      releasePreparedChatImage(pending.image);
    });
    pendingImages.clear();
    localPreviews.forEach((image) => releasePreparedChatImage(image));
    localPreviews.clear();
    clearChatAttachmentUrlCache();
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
        await loadList(token);
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
      pendingOpenId = null;
      clearTimers();
      inFlight.clear();
      countedIds.clear();
      hasBeenLive = false;
      const release = unsubscribe;
      unsubscribe = null;
      release?.();
      releaseSessionMedia();
      set({ ...INITIAL });
    },

    refresh: async () => {
      if (!activeSessionKey) return;
      const token = generation;
      if (get().status !== 'ready') set({ status: 'loading', errorMessage: null });
      try {
        await loadList(token);
        const active = get().activeConversationId;
        if (isCurrent(token) && active) await loadThread(token, active).catch(() => undefined);
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

    openConversation: (conversationId) => {
      const conversation = get().conversations.find((c) => c.conversationId === conversationId);
      if (!conversation) return;
      const token = generation;
      set({
        activeConversationId: conversationId,
        unreadDividerFrom: conversation.unreadCount > 0 ? conversation.lastReadAt : null,
      });
      if (threadOf(conversationId).status === 'ready') {
        if (get().screenActive) scheduleMarkRead();
        // Pick up anything that arrived while this thread was not on screen.
        void loadThread(token, conversationId).catch(() => undefined);
      } else {
        void loadThread(token, conversationId).catch(() => undefined);
      }
    },

    requestOpenConversation: (conversationId) => {
      if (get().conversations.some((c) => c.conversationId === conversationId)) {
        get().openConversation(conversationId);
        return;
      }
      pendingOpenId = conversationId;
      if (get().status === 'ready') scheduleListRefresh();
    },

    closeConversation: () => {
      if (get().activeConversationId === null) return;
      set({ activeConversationId: null, unreadDividerFrom: null });
    },

    startDirect: async (otherUserId) => {
      if (get().status !== 'ready' || get().openingDirect) return null;
      const token = generation;
      set({ openingDirect: true });
      try {
        const conversation = await getChatTransport().openDirect(otherUserId);
        if (!isCurrent(token)) return null;
        const others = get().conversations.filter((c) => c.conversationId !== conversation.conversationId);
        setConversations([...others, conversation]);
        set({ openingDirect: false });
        get().openConversation(conversation.conversationId);
        return conversation.conversationId;
      } catch (error) {
        if (!isCurrent(token)) return null;
        set({
          openingDirect: false,
          actionError: friendlyErrorMessage(error, [], 'לא הצלחנו לפתוח את השיחה הפרטית. נסו שוב.'),
        });
        return null;
      }
    },

    loadOlder: async () => {
      const conversationId = get().activeConversationId;
      if (!conversationId) return;
      const thread = threadOf(conversationId);
      if (!thread.hasMore || thread.loadingOlder) return;
      const oldest = thread.messages.find((m) => m.delivery === 'sent');
      if (!oldest) return;
      const token = generation;
      patchThread(conversationId, { loadingOlder: true });
      try {
        const page = await getChatTransport().listMessages(conversationId, {
          before: oldest.createdAt,
          limit: CHAT_PAGE_SIZE,
        });
        if (!isCurrent(token)) return;
        const current = threadOf(conversationId);
        const known = new Set(current.messages.map((m) => m.id));
        const fresh = page.filter((m) => !known.has(m.id));
        fresh.forEach((m) => countedIds.add(m.id));
        patchThread(conversationId, {
          messages: mergeChatMessages(current.messages, fresh),
          // A full page that still produced something new means there may be more.
          hasMore: fresh.length > 0 && page.length >= CHAT_PAGE_SIZE,
          loadingOlder: false,
        });
      } catch (error) {
        if (!isCurrent(token)) return;
        patchThread(conversationId, { loadingOlder: false });
        set({ actionError: friendlyErrorMessage(error, [], 'לא הצלחנו לטעון הודעות קודמות. נסו שוב.') });
      }
    },

    send: (draft) => {
      const conversation = activeConversation();
      if (!conversation || get().status !== 'ready') return { ok: false, reason: 'not_ready' };
      const validation = validateChatBody(draft);
      if (!validation.ok) return { ok: false, reason: validation.reason };

      enqueue({
        id: generateId(),
        conversationId: conversation.conversationId,
        familyId: conversation.familyId,
        senderUserId: conversation.userId,
        body: validation.body,
        createdAt: new Date().toISOString(),
        delivery: get().online ? 'sending' : 'failed',
      });
      return { ok: true };
    },

    sendImage: (image, caption) => {
      const conversation = activeConversation();
      if (!conversation || get().status !== 'ready' || !get().capabilities.images) {
        return { ok: false, reason: 'not_ready' };
      }
      if (checkPreparedChatImage(image)) return { ok: false, reason: 'invalid_image' };
      // A caption is optional, but if present it follows the text rules.
      const trimmed = caption.trim();
      let body = '';
      if (trimmed.length > 0) {
        const validation = validateChatBody(caption);
        if (!validation.ok) return { ok: false, reason: validation.reason };
        body = validation.body;
      }

      const id = generateId();
      const path = chatAttachmentPath(conversation.conversationId, conversation.userId, id, image.mime);
      pendingImages.set(id, { image, path, uploaded: false, handle: null });
      enqueue({
        id,
        conversationId: conversation.conversationId,
        familyId: conversation.familyId,
        senderUserId: conversation.userId,
        body,
        createdAt: new Date().toISOString(),
        attachment: { path, mime: image.mime, width: image.width, height: image.height, size: image.size },
        upload: { localUri: image.uri, progress: 0 },
        delivery: get().online ? 'sending' : 'failed',
      });
      return { ok: true };
    },

    retry: (messageId) => {
      const message = Object.values(get().threads)
        .flatMap((t) => t.messages)
        .find((m) => m.id === messageId);
      if (!message || message.delivery !== 'failed' || inFlight.has(messageId)) return;
      const sendErrors = { ...get().sendErrors };
      delete sendErrors[messageId];
      set({ sendErrors });
      patchMessage(message, { delivery: 'sending' });
      void deliver(generation, { ...message, delivery: 'sending' });
    },

    discard: (messageId) => {
      const message = Object.values(get().threads)
        .flatMap((t) => t.messages)
        .find((m) => m.id === messageId);
      if (!message || message.delivery === 'sent') return;

      const pending = pendingImages.get(messageId);
      // A text message that is mid-request cannot be recalled; an image
      // upload can be stopped.
      if (inFlight.has(messageId) && !pending?.handle) return;

      if (pending) {
        pending.handle?.cancel();
        pendingImages.delete(messageId);
        // Remove whatever reached Storage so a cancelled or abandoned send
        // leaves no orphan file. (The server also sweeps day-old orphans.)
        void getChatTransport().removeAttachment(pending.path);
        releasePreparedChatImage(pending.image);
      }
      const sendErrors = { ...get().sendErrors };
      delete sendErrors[messageId];
      set({ sendErrors });
      patchThread(message.conversationId, {
        messages: threadOf(message.conversationId).messages.filter((m) => m.id !== messageId),
      });
    },

    remove: async (messageId) => {
      const token = generation;
      try {
        const removed = await getChatTransport().remove(messageId);
        if (!isCurrent(token)) return false;
        patchThread(removed.conversationId, {
          messages: mergeChatMessages(threadOf(removed.conversationId).messages, [removed]),
        });
        setConversations(applyMessageToConversations(get().conversations, removed, { isNew: false, isBeingRead: true }));
        return true;
      } catch (error) {
        if (!isCurrent(token)) return false;
        set({ actionError: friendlyErrorMessage(error, [], 'לא הצלחנו למחוק את ההודעה. נסו שוב.') });
        return false;
      }
    },

    removeMany: async (messageIds) => {
      if (messageIds.length === 0) return false;
      const token = generation;
      try {
        const removed = await getChatTransport().removeMany(messageIds);
        if (!isCurrent(token)) return false;
        const byConversation = new Map<string, ChatMessage[]>();
        for (const message of removed) byConversation.set(message.conversationId, [...(byConversation.get(message.conversationId) ?? []), message]);
        byConversation.forEach((items, conversationId) => {
          patchThread(conversationId, { messages: mergeChatMessages(threadOf(conversationId).messages, items) });
          items.forEach((message) => setConversations(applyMessageToConversations(get().conversations, message, { isNew: false, isBeingRead: true })));
        });
        return true;
      } catch (error) {
        if (!isCurrent(token)) return false;
        set({ actionError: friendlyErrorMessage(error, [], 'לא הצלחנו למחוק את ההודעות. נסו שוב.') });
        return false;
      }
    },

    clearForMe: async () => {
      const conversation = activeConversation();
      if (!conversation) return false;
      const token = generation;
      try {
        const clearedAt = await getChatTransport().clearForMe(conversation.conversationId);
        if (!isCurrent(token)) return false;
        applyConversationClear(conversation.conversationId, clearedAt);
        await get().refresh();
        return true;
      } catch (error) {
        if (!isCurrent(token)) return false;
        set({ actionError: friendlyErrorMessage(error, [], 'לא הצלחנו לנקות את השיחה אצלכם. נסו שוב.') });
        return false;
      }
    },

    clearForEveryone: async () => {
      const conversation = activeConversation();
      if (!conversation || !conversation.canModerate || conversation.kind !== 'family') return false;
      const token = generation;
      try {
        await getChatTransport().clearForEveryone(conversation.conversationId);
        if (!isCurrent(token)) return false;
        patchThread(conversation.conversationId, { messages: [] });
        setConversations(get().conversations.map((item) => item.conversationId === conversation.conversationId
          ? { ...item, unreadCount: 0, lastMessage: undefined }
          : item));
        await get().refresh();
        return true;
      } catch (error) {
        if (!isCurrent(token)) return false;
        set({ actionError: friendlyErrorMessage(error, [], 'לא הצלחנו לנקות את השיחה לכל המשפחה. נסו שוב.') });
        return false;
      }
    },

    setMuted: async (muted) => {
      const conversation = activeConversation();
      if (!conversation) return;
      const token = generation;
      const id = conversation.conversationId;
      const before = conversation.notificationsMuted;
      const apply = (value: boolean) =>
        setConversations(get().conversations.map((c) => (c.conversationId === id ? { ...c, notificationsMuted: value } : c)));
      apply(muted);
      try {
        await getChatTransport().setMuted(id, muted);
      } catch (error) {
        if (!isCurrent(token)) return;
        apply(before);
        set({ actionError: friendlyErrorMessage(error, [], 'לא הצלחנו לעדכן את ההתראות. נסו שוב.') });
      }
    },

    setScreenActive: (active) => {
      if (get().screenActive === active) return;
      set({ screenActive: active });
      if (active && get().activeConversationId) scheduleMarkRead();
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
