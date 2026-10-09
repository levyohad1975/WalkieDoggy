import AsyncStorage from '@react-native-async-storage/async-storage';
import { DEMO_FAMILY } from '../data/demoData';
import { CHAT_MESSAGE_MAX_LENGTH, chatBodyLength, compareChatMessages } from '../logic/chat';
import { useAuthStore } from '../store/authStore';
import type { ChatConversationState, ChatMessage } from '../types';
import type { ChatSubscriptionHandlers, ChatTransport } from './chat';

/**
 * Local/demo-mode Family Chat (no Supabase configured). Mirrors the server
 * contract of migration 0108 closely enough that the same store and screen
 * run unchanged: one conversation per family, the sender is whoever is
 * signed in on this device, the message id is an idempotency key, and only
 * an admin can remove a message. Everything lives on this one device, so
 * "other devices" are simply other profiles signed in here in turn.
 */

interface LocalChatData {
  messages: ChatMessage[];
  /** Per-profile read marker. */
  lastReadAt: Record<string, string>;
  muted: Record<string, boolean>;
}

const storageKey = (familyId: string) => `walkie-doggy/chat/${familyId}`;
const conversationIdFor = (familyId: string) => `local-family-chat:${familyId}`;

async function read(familyId: string): Promise<LocalChatData> {
  try {
    const raw = await AsyncStorage.getItem(storageKey(familyId));
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<LocalChatData>;
      return {
        messages: Array.isArray(parsed.messages) ? parsed.messages : [],
        lastReadAt: parsed.lastReadAt ?? {},
        muted: parsed.muted ?? {},
      };
    }
  } catch {
    // Unreadable local data is treated as an empty conversation.
  }
  return { messages: [], lastReadAt: {}, muted: {} };
}

async function write(familyId: string, data: LocalChatData): Promise<void> {
  await AsyncStorage.setItem(storageKey(familyId), JSON.stringify(data));
}

function identity(): { familyId: string; userId: string; isAdmin: boolean } {
  const { familyId, currentUserId, familyRole } = useAuthStore.getState();
  if (!currentUserId) throw new Error('no active profile found for this session');
  return { familyId: familyId ?? DEMO_FAMILY.id, userId: currentUserId, isAdmin: familyRole === 'admin' };
}

function unreadFor(data: LocalChatData, userId: string): number {
  const lastRead = data.lastReadAt[userId];
  if (!lastRead) return 0;
  return data.messages.filter((m) => !m.deletedAt && m.senderUserId !== userId && m.createdAt > lastRead).length;
}

export function createLocalChatTransport(): ChatTransport {
  const listeners = new Map<string, Set<ChatSubscriptionHandlers>>();
  const emit = (conversationId: string, message: ChatMessage) => {
    listeners.get(conversationId)?.forEach((handlers) => handlers.onMessage(message));
  };

  return {
    async open(): Promise<ChatConversationState> {
      const { familyId, userId, isAdmin } = identity();
      const data = await read(familyId);
      if (!data.lastReadAt[userId]) {
        data.lastReadAt[userId] = new Date().toISOString();
        await write(familyId, data);
      }
      return {
        conversationId: conversationIdFor(familyId),
        familyId,
        userId,
        lastReadAt: data.lastReadAt[userId],
        notificationsMuted: data.muted[userId] === true,
        unreadCount: unreadFor(data, userId),
        canModerate: isAdmin,
      };
    },

    async listMessages(_conversationId, { before, limit }) {
      const { familyId } = identity();
      const data = await read(familyId);
      const sorted = [...data.messages].sort(compareChatMessages);
      const window = before ? sorted.filter((m) => m.createdAt <= before) : sorted;
      return window.slice(-limit);
    },

    async send(conversationId, clientId, body) {
      const { familyId, userId } = identity();
      const text = body.trim();
      if (chatBodyLength(text) === 0) throw new Error('chat message is empty');
      if (chatBodyLength(text) > CHAT_MESSAGE_MAX_LENGTH) throw new Error('chat message is too long');
      const data = await read(familyId);
      const existing = data.messages.find((m) => m.id === clientId);
      if (existing) {
        if (existing.senderUserId === userId) return existing;
        throw new Error('chat message id conflict');
      }
      const message: ChatMessage = {
        id: clientId,
        conversationId,
        familyId,
        senderUserId: userId,
        body: text,
        createdAt: new Date().toISOString(),
        delivery: 'sent',
      };
      data.messages.push(message);
      data.lastReadAt[userId] = message.createdAt;
      await write(familyId, data);
      emit(conversationId, message);
      return message;
    },

    async remove(messageId) {
      const { familyId, userId, isAdmin } = identity();
      if (!isAdmin) throw new Error('admin permission required');
      const data = await read(familyId);
      const index = data.messages.findIndex((m) => m.id === messageId);
      if (index < 0) throw new Error('chat message not found');
      const current = data.messages[index];
      if (current.deletedAt) return current;
      const removed: ChatMessage = {
        ...current,
        body: '',
        deletedAt: new Date().toISOString(),
        deletedByUserId: userId,
      };
      data.messages[index] = removed;
      await write(familyId, data);
      emit(removed.conversationId, removed);
      return removed;
    },

    async markRead(_conversationId, readAt) {
      const { familyId, userId } = identity();
      const data = await read(familyId);
      const now = new Date().toISOString();
      const requested = readAt < now ? readAt : now;
      const previous = data.lastReadAt[userId] ?? '';
      data.lastReadAt[userId] = requested > previous ? requested : previous;
      await write(familyId, data);
      return unreadFor(data, userId);
    },

    async setMuted(_conversationId, muted) {
      const { familyId, userId } = identity();
      const data = await read(familyId);
      data.muted[userId] = muted;
      await write(familyId, data);
      return muted;
    },

    subscribe(conversationId, handlers) {
      let set = listeners.get(conversationId);
      if (!set) {
        set = new Set();
        listeners.set(conversationId, set);
      }
      set.add(handlers);
      handlers.onStatus('live');
      return () => {
        const current = listeners.get(conversationId);
        if (!current) return;
        current.delete(handlers);
        if (current.size === 0) listeners.delete(conversationId);
      };
    },

    // No push in local/demo mode: there is no other device to notify.
    async notify() {
      return undefined;
    },
  };
}
