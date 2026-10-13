import {
  ChatUploadCancelledError,
  type ChatCapabilities,
  type ChatSubscriptionHandlers,
  type ChatTransport,
} from '../lib/chat';
import type { PreparedChatImage } from '../lib/chatImages';
import { chatLastMessageOf } from '../logic/chat';
import type { ChatConversationState, ChatMessage } from '../types';

/**
 * Test double for the chat transport. NOT used by the app.
 *
 * It behaves like the server where the tests depend on it: the sender is
 * whoever the "server" says the caller is, a message id is idempotent, a
 * conversation the caller is not part of is never listed, and an image must
 * be uploaded before it can be attached.
 */
export function fakeChatMessage(overrides: Partial<ChatMessage> & { id: string }): ChatMessage {
  return {
    conversationId: 'conv-family',
    familyId: 'family-a',
    senderUserId: 'user-other',
    body: 'שלום',
    createdAt: '2026-10-09T10:00:00.000Z',
    delivery: 'sent',
    ...overrides,
  };
}

export function fakeChatConversation(overrides: Partial<ChatConversationState> = {}): ChatConversationState {
  return {
    conversationId: 'conv-family',
    kind: 'family',
    familyId: 'family-a',
    userId: 'user-me',
    lastReadAt: '2026-10-09T09:00:00.000Z',
    notificationsMuted: false,
    unreadCount: 0,
    canModerate: false,
    lastActivityAt: '2026-10-09T09:00:00.000Z',
    ...overrides,
  };
}

export const FAKE_IMAGE: PreparedChatImage = {
  uri: 'blob:local-preview',
  mime: 'image/jpeg',
  width: 1200,
  height: 900,
  size: 240_000,
};

interface UploadControl {
  path: string;
  progress: (fraction: number) => void;
  finish: () => void;
  fail: (error: Error) => void;
  cancelled: boolean;
}

export function createFakeChatTransport(
  options: {
    userId?: string;
    conversations?: ChatConversationState[];
    capabilities?: ChatCapabilities;
    /** When true, uploads stay pending until the test calls finish()/fail(). */
    manualUploads?: boolean;
  } = {}
) {
  const userId = options.userId ?? 'user-me';
  const state = {
    userId,
    conversations: (options.conversations ?? [fakeChatConversation({ userId })]).map((c) => ({ ...c, userId })),
    capabilities: options.capabilities ?? { privateConversations: true, images: true },
    messages: [] as ChatMessage[],
    clearedAt: new Map<string, string>(),
    uploaded: new Set<string>(),
    sendCalls: [] as Array<{ conversationId: string; clientId: string; body: string }>,
    sendImageCalls: [] as Array<{ conversationId: string; clientId: string; path: string; width: number; height: number; body: string }>,
    uploadCalls: [] as string[],
    removedAttachments: [] as string[],
    signedUrlRequests: [] as string[],
    notifyCalls: [] as string[],
    markReadCalls: [] as Array<{ conversationId: string; readAt: string }>,
    openDirectCalls: [] as string[],
    listCalls: 0,
    subscriptions: [] as Array<{ handlers: ChatSubscriptionHandlers; active: boolean }>,
    uploads: [] as UploadControl[],
    failSendWith: null as Error | null,
    failListWith: null as Error | null,
    failUploadWith: null as Error | null,
    clock: Date.parse('2026-10-09T12:00:00.000Z'),
  };

  const stamp = () => {
    state.clock += 1000;
    return new Date(state.clock).toISOString();
  };

  const record = (message: ChatMessage) => {
    const index = state.messages.findIndex((m) => m.id === message.id);
    if (index >= 0) state.messages[index] = message;
    else state.messages.push(message);
    state.conversations = state.conversations.map((c) =>
      c.conversationId === message.conversationId
        ? { ...c, lastMessage: chatLastMessageOf(message), lastActivityAt: message.createdAt }
        : c
    );
  };

  const post = (conversationId: string, clientId: string, body: string, attachment?: { path: string; width: number; height: number }) => {
    if (state.failSendWith) throw state.failSendWith;
    if (!state.conversations.some((c) => c.conversationId === conversationId)) throw new Error('chat conversation not found');
    const existing = state.messages.find((m) => m.id === clientId);
    if (existing) return existing;
    if (attachment && !state.uploaded.has(attachment.path)) throw new Error('chat attachment was not uploaded');
    const message = fakeChatMessage({
      id: clientId,
      conversationId,
      senderUserId: state.userId,
      body,
      createdAt: stamp(),
      attachment: attachment
        ? { path: attachment.path, mime: 'image/jpeg', width: attachment.width, height: attachment.height, size: 240_000 }
        : undefined,
    });
    record(message);
    return message;
  };

  const transport: ChatTransport = {
    async listConversations() {
      state.listCalls += 1;
      if (state.failListWith) throw state.failListWith;
      return { conversations: state.conversations.map((c) => ({ ...c })), capabilities: state.capabilities };
    },
    async openDirect(otherUserId) {
      state.openDirectCalls.push(otherUserId);
      const id = `conv-direct-${[state.userId, otherUserId].sort().join('-')}`;
      let conversation = state.conversations.find((c) => c.conversationId === id);
      if (!conversation) {
        conversation = fakeChatConversation({
          conversationId: id,
          kind: 'direct',
          userId: state.userId,
          otherUserId,
          lastActivityAt: stamp(),
        });
        state.conversations.push(conversation);
      }
      return { ...conversation };
    },
    async listMessages(conversationId, { before, limit }) {
      return state.messages
        .filter((m) => m.conversationId === conversationId && m.createdAt > (state.clearedAt.get(`${conversationId}|${userId}`) ?? '') && (!before || m.createdAt <= before))
        .sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1))
        .slice(-limit);
    },
    async send(conversationId, clientId, body) {
      state.sendCalls.push({ conversationId, clientId, body });
      return post(conversationId, clientId, body);
    },
    async sendImage(conversationId, clientId, attachment, body) {
      state.sendImageCalls.push({ conversationId, clientId, ...attachment, body });
      return post(conversationId, clientId, body, attachment);
    },
    async remove(messageId) {
      const current = state.messages.find((m) => m.id === messageId);
      if (!current) throw new Error('chat message not found');
      const conversation = state.conversations.find((c) => c.conversationId === current.conversationId);
      if (!conversation) throw new Error('chat message not found');
      if (conversation.kind === 'family') {
        if (!conversation.canModerate && current.senderUserId !== userId) throw new Error('only the sender can remove this message');
      } else if (current.senderUserId !== state.userId) {
        throw new Error('only the sender can remove this message');
      }
      const removed: ChatMessage = { ...current, body: '', attachment: undefined, deletedAt: '2026-10-09T13:00:00.000Z', deletedByUserId: state.userId };
      record(removed);
      return removed;
    },
    async removeMany(messageIds) {
      const ids = [...new Set(messageIds)];
      for (const id of ids) {
        const message = state.messages.find((m) => m.id === id);
        if (!message) throw new Error('chat message not found');
        const conversation = state.conversations.find((c) => c.conversationId === message.conversationId);
        if (!conversation) throw new Error('chat message not found');
        if ((conversation.kind === 'family' && !conversation.canModerate && message.senderUserId !== userId) ||
            (conversation.kind !== 'family' && message.senderUserId !== userId)) throw new Error('only the sender can remove this message');
      }
      const removed: ChatMessage[] = [];
      for (const id of ids) removed.push(await transport.remove(id));
      return removed;
    },
    async clearForMe(conversationId) {
      if (!state.conversations.some((c) => c.conversationId === conversationId)) throw new Error('chat conversation not found');
      const clearedAt = new Date().toISOString();
      state.clearedAt.set(`${conversationId}|${userId}`, clearedAt);
      activeSubscriptions().forEach((s) => s.handlers.onConversationCleared(conversationId, clearedAt));
      return clearedAt;
    },
    async clearForEveryone(conversationId) {
      const conversation = state.conversations.find((c) => c.conversationId === conversationId);
      if (!conversation || conversation.kind !== 'family') throw new Error('chat conversation not found');
      if (!conversation.canModerate) throw new Error('admin permission required');
      const clearedAt = new Date().toISOString();
      let count = 0;
      for (const message of state.messages.filter((m) => m.conversationId === conversationId && !m.deletedAt)) {
        count += 1;
        record({ ...message, body: '', attachment: undefined, deletedAt: clearedAt, deletedByUserId: userId });
      }
      state.clearedAt.set(`${conversationId}|${userId}`, clearedAt);
      activeSubscriptions().forEach((s) => s.handlers.onConversationCleared(conversationId, clearedAt));
      return count;
    },
    async markRead(conversationId, readAt) {
      state.markReadCalls.push({ conversationId, readAt });
      state.conversations = state.conversations.map((c) =>
        c.conversationId === conversationId ? { ...c, lastReadAt: readAt, unreadCount: 0 } : c
      );
      return 0;
    },
    async setMuted(conversationId, muted) {
      state.conversations = state.conversations.map((c) =>
        c.conversationId === conversationId ? { ...c, notificationsMuted: muted } : c
      );
      return muted;
    },
    subscribe(handlers) {
      const subscription = { handlers, active: true };
      state.subscriptions.push(subscription);
      handlers.onStatus('live');
      return () => {
        subscription.active = false;
      };
    },
    async notify(messageId) {
      state.notifyCalls.push(messageId);
    },
    uploadAttachment(path, _image, onProgress) {
      state.uploadCalls.push(path);
      let rejectUpload: (error: Error) => void = () => undefined;
      const control: UploadControl = {
        path,
        progress: onProgress,
        finish: () => undefined,
        fail: () => undefined,
        cancelled: false,
      };
      const promise = new Promise<void>((resolve, reject) => {
        rejectUpload = reject;
        control.finish = () => {
          state.uploaded.add(path);
          onProgress(1);
          resolve();
        };
        control.fail = reject;
        if (state.failUploadWith) reject(state.failUploadWith);
        else if (!options.manualUploads) control.finish();
      });
      state.uploads.push(control);
      return {
        promise,
        cancel: () => {
          control.cancelled = true;
          rejectUpload(new ChatUploadCancelledError());
        },
      };
    },
    async removeAttachment(path) {
      state.removedAttachments.push(path);
      state.uploaded.delete(path);
    },
    async getAttachmentUrl(path) {
      state.signedUrlRequests.push(path);
      const allowed = state.messages.some(
        (m) => m.attachment?.path === path && state.conversations.some((c) => c.conversationId === m.conversationId)
      );
      if (!allowed) throw new Error('chat image is not available');
      return `https://signed.example/${encodeURIComponent(path)}?token=short-lived`;
    },
  };

  const activeSubscriptions = () => state.subscriptions.filter((s) => s.active);
  /** Simulates a message arriving over Realtime from another device. */
  const push = (message: ChatMessage) => {
    record(message);
    activeSubscriptions().forEach((s) => s.handlers.onMessage(message));
  };

  return { transport, state, activeSubscriptions, push };
}
