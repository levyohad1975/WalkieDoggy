import AsyncStorage from '@react-native-async-storage/async-storage';
import { DEMO_FAMILY } from '../data/demoData';
import { CHAT_MESSAGE_MAX_LENGTH, chatBodyLength, chatLastMessageOf, compareChatMessages } from '../logic/chat';
import { useAuthStore } from '../store/authStore';
import { useFamilyStore } from '../store/familyStore';
import type { ChatConversationState, ChatMessage } from '../types';
import type { ChatSubscriptionHandlers, ChatTransport } from './chat';
import type { PreparedChatImage } from './chatImages';

/**
 * Local/demo-mode chat (no Supabase configured). Mirrors the server contract
 * of migrations 0108/0109 closely enough that the same store and screens run
 * unchanged: one family conversation, one private conversation per pair of
 * members, the sender is whoever is signed in on this device, the message id
 * is an idempotency key, only an admin removes a family message and only the
 * sender removes a private one. Everything lives on this one device, so
 * "other devices" are simply other profiles signed in here in turn.
 *
 * Images are kept in memory only (they would not fit in device storage as
 * text), so in demo mode a sent image is visible until the app is reloaded.
 */

interface LocalConversation {
  id: string;
  kind: 'family' | 'direct';
  /** Private conversations: the two participants. */
  pair?: [string, string];
  createdBy: string;
  createdAt: string;
}

interface LocalChatData {
  conversations: LocalConversation[];
  messages: ChatMessage[];
  /** Keyed by `${conversationId}|${userId}`. */
  lastReadAt: Record<string, string>;
  muted: Record<string, boolean>;
}

const storageKey = (familyId: string) => `walkie-doggy/chat/v2/${familyId}`;
const familyConversationId = (familyId: string) => `local-family-chat:${familyId}`;
const memberKey = (conversationId: string, userId: string) => `${conversationId}|${userId}`;

const EMPTY: LocalChatData = { conversations: [], messages: [], lastReadAt: {}, muted: {} };

async function read(familyId: string): Promise<LocalChatData> {
  try {
    const raw = await AsyncStorage.getItem(storageKey(familyId));
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<LocalChatData>;
      return {
        conversations: Array.isArray(parsed.conversations) ? parsed.conversations : [],
        messages: Array.isArray(parsed.messages) ? parsed.messages : [],
        lastReadAt: parsed.lastReadAt ?? {},
        muted: parsed.muted ?? {},
      };
    }
  } catch {
    // Unreadable local data is treated as an empty chat.
  }
  return { ...EMPTY, conversations: [], messages: [], lastReadAt: {}, muted: {} };
}

async function write(familyId: string, data: LocalChatData): Promise<void> {
  await AsyncStorage.setItem(storageKey(familyId), JSON.stringify(data));
}

function identity(): { familyId: string; userId: string; isAdmin: boolean } {
  const { familyId, currentUserId, familyRole } = useAuthStore.getState();
  if (!currentUserId) throw new Error('no active profile found for this session');
  return { familyId: familyId ?? DEMO_FAMILY.id, userId: currentUserId, isAdmin: familyRole === 'admin' };
}

function canAccess(conversation: LocalConversation | undefined, userId: string): conversation is LocalConversation {
  if (!conversation) return false;
  return conversation.kind === 'family' || Boolean(conversation.pair?.includes(userId));
}

function stateOf(data: LocalChatData, conversation: LocalConversation, familyId: string, userId: string, isAdmin: boolean): ChatConversationState {
  const lastRead = data.lastReadAt[memberKey(conversation.id, userId)] ?? new Date().toISOString();
  const messages = data.messages.filter((m) => m.conversationId === conversation.id).sort(compareChatMessages);
  const last = messages[messages.length - 1];
  return {
    conversationId: conversation.id,
    kind: conversation.kind,
    familyId,
    userId,
    otherUserId: conversation.pair?.find((id) => id !== userId),
    lastReadAt: lastRead,
    notificationsMuted: data.muted[memberKey(conversation.id, userId)] === true,
    unreadCount: messages.filter((m) => !m.deletedAt && m.senderUserId !== userId && m.createdAt > lastRead).length,
    canModerate: conversation.kind === 'family' && isAdmin,
    lastActivityAt: last?.createdAt ?? conversation.createdAt,
    lastMessage: last ? chatLastMessageOf(last) : undefined,
  };
}

function ensureFamilyConversation(data: LocalChatData, familyId: string, userId: string): LocalConversation {
  const id = familyConversationId(familyId);
  let conversation = data.conversations.find((c) => c.id === id);
  if (!conversation) {
    conversation = { id, kind: 'family', createdBy: userId, createdAt: new Date().toISOString() };
    data.conversations.push(conversation);
  }
  if (!data.lastReadAt[memberKey(id, userId)]) data.lastReadAt[memberKey(id, userId)] = new Date().toISOString();
  return conversation;
}

export function createLocalChatTransport(): ChatTransport {
  const listeners = new Set<ChatSubscriptionHandlers>();
  const files = new Map<string, PreparedChatImage>();
  const emit = (message: ChatMessage) => listeners.forEach((handlers) => handlers.onMessage(message));

  const post = async (
    conversationId: string,
    clientId: string,
    body: string,
    attachment?: { path: string; width: number; height: number }
  ): Promise<ChatMessage> => {
    const { familyId, userId } = identity();
    const text = body.trim();
    if (chatBodyLength(text) === 0 && !attachment) throw new Error('chat message is empty');
    if (chatBodyLength(text) > CHAT_MESSAGE_MAX_LENGTH) throw new Error('chat message is too long');
    const data = await read(familyId);
    const conversation = data.conversations.find((c) => c.id === conversationId);
    if (!canAccess(conversation, userId)) throw new Error('chat conversation not found');
    if (conversation.kind === 'direct') {
      const otherId = conversation.pair?.find((id) => id !== userId);
      const other = useFamilyStore.getState().users.find((u) => u.id === otherId);
      if (other?.removedAt) throw new Error('chat recipient is no longer in the family');
    }
    const existing = data.messages.find((m) => m.id === clientId);
    if (existing) {
      if (existing.senderUserId === userId && existing.conversationId === conversationId) return existing;
      throw new Error('chat message id conflict');
    }
    let stored: PreparedChatImage | undefined;
    if (attachment) {
      stored = files.get(attachment.path);
      if (!stored) throw new Error('chat attachment was not uploaded');
    }
    const message: ChatMessage = {
      id: clientId,
      conversationId,
      familyId,
      senderUserId: userId,
      body: text,
      createdAt: new Date().toISOString(),
      attachment:
        attachment && stored
          ? { path: attachment.path, mime: stored.mime, width: attachment.width, height: attachment.height, size: stored.size }
          : undefined,
      delivery: 'sent',
    };
    data.messages.push(message);
    data.lastReadAt[memberKey(conversationId, userId)] = message.createdAt;
    await write(familyId, data);
    emit(message);
    return message;
  };

  return {
    async listConversations() {
      const { familyId, userId, isAdmin } = identity();
      const data = await read(familyId);
      ensureFamilyConversation(data, familyId, userId);
      await write(familyId, data);
      const visible = data.conversations.filter((c) => {
        if (!canAccess(c, userId)) return false;
        if (c.kind === 'family') return true;
        return c.createdBy === userId || data.messages.some((m) => m.conversationId === c.id);
      });
      return {
        conversations: visible.map((c) => stateOf(data, c, familyId, userId, isAdmin)),
        capabilities: { privateConversations: true, images: true },
      };
    },

    async openDirect(otherUserId) {
      const { familyId, userId, isAdmin } = identity();
      if (!otherUserId || otherUserId === userId) throw new Error('choose another family member');
      const other = useFamilyStore.getState().users.find((u) => u.id === otherUserId);
      if (!other || other.removedAt) throw new Error('chat member not found');
      const [low, high] = [userId, otherUserId].sort();
      const id = `local-direct:${low}:${high}`;
      const data = await read(familyId);
      let conversation = data.conversations.find((c) => c.id === id);
      if (!conversation) {
        const now = new Date().toISOString();
        conversation = { id, kind: 'direct', pair: [low, high], createdBy: userId, createdAt: now };
        data.conversations.push(conversation);
        data.lastReadAt[memberKey(id, low)] = now;
        data.lastReadAt[memberKey(id, high)] = now;
        await write(familyId, data);
      }
      return stateOf(data, conversation, familyId, userId, isAdmin);
    },

    async listMessages(conversationId, { before, limit }) {
      const { familyId, userId } = identity();
      const data = await read(familyId);
      if (!canAccess(data.conversations.find((c) => c.id === conversationId), userId)) return [];
      const sorted = data.messages.filter((m) => m.conversationId === conversationId).sort(compareChatMessages);
      const window = before ? sorted.filter((m) => m.createdAt <= before) : sorted;
      return window.slice(-limit);
    },

    send: (conversationId, clientId, body) => post(conversationId, clientId, body),
    sendImage: (conversationId, clientId, attachment, body) => post(conversationId, clientId, body, attachment),

    async remove(messageId) {
      const { familyId, userId, isAdmin } = identity();
      const data = await read(familyId);
      const index = data.messages.findIndex((m) => m.id === messageId);
      const current = index >= 0 ? data.messages[index] : undefined;
      const conversation = current ? data.conversations.find((c) => c.id === current.conversationId) : undefined;
      if (!current || !canAccess(conversation, userId)) throw new Error('chat message not found');
      if (conversation.kind === 'family') {
        if (!isAdmin) throw new Error('admin permission required');
      } else if (current.senderUserId !== userId) {
        throw new Error('only the sender can remove this message');
      }
      if (current.deletedAt) return current;
      if (current.attachment) files.delete(current.attachment.path);
      const removed: ChatMessage = {
        ...current,
        body: '',
        attachment: undefined,
        deletedAt: new Date().toISOString(),
        deletedByUserId: userId,
      };
      data.messages[index] = removed;
      await write(familyId, data);
      emit(removed);
      return removed;
    },

    async markRead(conversationId, readAt) {
      const { familyId, userId, isAdmin } = identity();
      const data = await read(familyId);
      const conversation = data.conversations.find((c) => c.id === conversationId);
      if (!canAccess(conversation, userId)) throw new Error('chat conversation not found');
      const now = new Date().toISOString();
      const requested = readAt < now ? readAt : now;
      const key = memberKey(conversationId, userId);
      const previous = data.lastReadAt[key] ?? '';
      data.lastReadAt[key] = requested > previous ? requested : previous;
      await write(familyId, data);
      return stateOf(data, conversation, familyId, userId, isAdmin).unreadCount;
    },

    async setMuted(conversationId, muted) {
      const { familyId, userId } = identity();
      const data = await read(familyId);
      if (!canAccess(data.conversations.find((c) => c.id === conversationId), userId)) {
        throw new Error('chat conversation not found');
      }
      data.muted[memberKey(conversationId, userId)] = muted;
      await write(familyId, data);
      return muted;
    },

    subscribe(handlers) {
      // Same-device delivery only. The store drops anything for a
      // conversation the signed-in profile is not part of.
      listeners.add(handlers);
      handlers.onStatus('live');
      return () => {
        listeners.delete(handlers);
      };
    },

    // No push in local/demo mode: there is no other device to notify.
    async notify() {
      return undefined;
    },

    uploadAttachment(path, image, onProgress) {
      let cancelled = false;
      const promise = (async () => {
        onProgress(0.4);
        await Promise.resolve();
        if (cancelled) {
          const { ChatUploadCancelledError } = await import('./chat');
          throw new ChatUploadCancelledError();
        }
        files.set(path, image);
        onProgress(1);
      })();
      return {
        promise,
        cancel: () => {
          cancelled = true;
        },
      };
    },

    async removeAttachment(path) {
      files.delete(path);
    },

    async getAttachmentUrl(path) {
      const stored = files.get(path);
      if (!stored) throw new Error('chat image is not available');
      return stored.uri;
    },
  };
}
