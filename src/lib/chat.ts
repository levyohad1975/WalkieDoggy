import type { RealtimeChannel } from '@supabase/supabase-js';
import { isSupabaseConfigured, supabase, SupabaseNotConfiguredError } from './supabase';
import { rawMessageOf } from './errorMessages';
import { createLocalChatTransport } from './chatLocal';
import type { ChatConversationState, ChatMessage } from '../types';

/**
 * Family Chat transport (migration 0108_family_chat.sql).
 *
 * Deliberately Supabase-direct rather than routed through Repository /
 * OfflineFirstRepository / SyncQueue, for the same reason lib/requests.ts
 * is: the server is the only authority on who the sender is and whether a
 * message may be posted, so a message is only ever shown as delivered once
 * the server has actually accepted it. Offline sends are held by chatStore
 * as visibly-unsent bubbles and retried with the SAME message id, which
 * chat_send_message() treats as an idempotency key.
 *
 * Nothing here sends a sender id, a family id or a recipient list: every
 * RPC derives the caller from auth.uid() server-side.
 */

export type ChatLiveStatus = 'live' | 'reconnecting';

export interface ChatSubscriptionHandlers {
  /** A new message, or a changed one (moderation). */
  onMessage: (message: ChatMessage) => void;
  onStatus: (status: ChatLiveStatus) => void;
}

export interface ChatTransport {
  open(): Promise<ChatConversationState>;
  /** Newest `limit` messages at or before `before` (or the newest overall), returned oldest-first. */
  listMessages(conversationId: string, options: { before?: string; limit: number }): Promise<ChatMessage[]>;
  send(conversationId: string, clientId: string, body: string): Promise<ChatMessage>;
  remove(messageId: string): Promise<ChatMessage>;
  /** Returns the remaining unread count. */
  markRead(conversationId: string, readAt: string): Promise<number>;
  setMuted(conversationId: string, muted: boolean): Promise<boolean>;
  /** MUST return an unsubscribe function that releases every resource. */
  subscribe(conversationId: string, handlers: ChatSubscriptionHandlers): () => void;
  /** Best-effort push trigger for a message this device just sent. Never throws. */
  notify(messageId: string): Promise<void>;
}

/** The chat backend is not installed on this environment yet (migration 0108 not applied). */
export class ChatUnavailableError extends Error {
  constructor() {
    super('family chat is not available on this environment yet');
  }
}

/** PostgREST / Postgres codes meaning "this function or table does not exist here". */
const MISSING_BACKEND_CODES = new Set(['PGRST202', 'PGRST205', '42883', '42P01']);

export function isChatBackendMissing(error: unknown): boolean {
  if (error instanceof ChatUnavailableError) return true;
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === 'string' && MISSING_BACKEND_CODES.has(code);
}

/** A failure worth retrying automatically once the connection returns. */
export function isChatNetworkError(error: unknown): boolean {
  if (isChatBackendMissing(error)) return false;
  const raw = rawMessageOf(error).toLowerCase();
  return (
    raw.includes('failed to fetch') ||
    raw.includes('network request failed') ||
    raw.includes('networkerror') ||
    raw.includes('load failed') ||
    raw.includes('timed out') ||
    raw.includes('timeout')
  );
}

interface ChatMessageRow {
  id: string;
  conversation_id: string;
  family_id: string;
  sender_user_id: string | null;
  body: string;
  created_at: string;
  deleted_at: string | null;
  deleted_by_user_id: string | null;
}

const MESSAGE_COLUMNS = 'id, conversation_id, family_id, sender_user_id, body, created_at, deleted_at, deleted_by_user_id';

export function chatMessageFromRow(row: ChatMessageRow): ChatMessage {
  return {
    id: row.id,
    conversationId: row.conversation_id,
    familyId: row.family_id,
    senderUserId: row.sender_user_id ?? undefined,
    // A moderated message never carries text, whatever a stale payload says.
    body: row.deleted_at ? '' : row.body,
    createdAt: new Date(row.created_at).toISOString(),
    deletedAt: row.deleted_at ? new Date(row.deleted_at).toISOString() : undefined,
    deletedByUserId: row.deleted_by_user_id ?? undefined,
    delivery: 'sent',
  };
}

function requireSupabase() {
  if (!supabase) throw new SupabaseNotConfiguredError();
  return supabase;
}

function rethrow(error: unknown): never {
  if (isChatBackendMissing(error)) throw new ChatUnavailableError();
  throw error;
}

function singleRow<T>(data: unknown): T | null {
  const row = Array.isArray(data) ? data[0] : data;
  return (row as T | undefined) ?? null;
}

export const supabaseChatTransport: ChatTransport = {
  async open() {
    const { data, error } = await requireSupabase().rpc('chat_open_family_conversation');
    if (error) rethrow(error);
    const row = data as {
      conversation_id?: string;
      family_id?: string;
      user_id?: string;
      last_read_at?: string;
      notifications_muted?: boolean;
      unread_count?: number;
      can_moderate?: boolean;
    } | null;
    if (!row?.conversation_id || !row.family_id || !row.user_id) {
      throw new Error('chat conversation could not be opened');
    }
    return {
      conversationId: row.conversation_id,
      familyId: row.family_id,
      userId: row.user_id,
      lastReadAt: new Date(row.last_read_at ?? Date.now()).toISOString(),
      notificationsMuted: row.notifications_muted === true,
      unreadCount: Math.max(0, Number(row.unread_count ?? 0)),
      canModerate: row.can_moderate === true,
    };
  },

  async listMessages(conversationId, { before, limit }) {
    let query = requireSupabase()
      .from('chat_messages')
      .select(MESSAGE_COLUMNS)
      .eq('conversation_id', conversationId)
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .limit(limit);
    // `lte`, not `lt`: two messages can share a timestamp, and the store
    // de-duplicates by id, so re-reading the boundary row is harmless while
    // skipping its twin would silently lose a message.
    if (before) query = query.lte('created_at', before);
    const { data, error } = await query;
    if (error) rethrow(error);
    return ((data ?? []) as ChatMessageRow[]).map(chatMessageFromRow).reverse();
  },

  async send(conversationId, clientId, body) {
    const { data, error } = await requireSupabase().rpc('chat_send_message', {
      p_conversation_id: conversationId,
      p_client_id: clientId,
      p_body: body,
    });
    if (error) rethrow(error);
    const row = singleRow<ChatMessageRow>(data);
    if (!row) throw new Error('chat message was not confirmed by the server');
    return chatMessageFromRow(row);
  },

  async remove(messageId) {
    const { data, error } = await requireSupabase().rpc('chat_delete_message', { p_message_id: messageId });
    if (error) rethrow(error);
    const row = singleRow<ChatMessageRow>(data);
    if (!row) throw new Error('chat message not found');
    return chatMessageFromRow(row);
  },

  async markRead(conversationId, readAt) {
    const { data, error } = await requireSupabase().rpc('chat_mark_read', {
      p_conversation_id: conversationId,
      p_read_at: readAt,
    });
    if (error) rethrow(error);
    return Math.max(0, Number(data ?? 0));
  },

  async setMuted(conversationId, muted) {
    const { data, error } = await requireSupabase().rpc('chat_set_notifications_muted', {
      p_conversation_id: conversationId,
      p_muted: muted,
    });
    if (error) rethrow(error);
    return data === true;
  },

  subscribe(conversationId, handlers) {
    const client = supabase;
    if (!client) return () => undefined;

    let closed = false;
    let channel: RealtimeChannel | null = null;
    const deliver = (payload: { new?: unknown }) => {
      if (closed) return;
      const row = payload?.new as ChatMessageRow | undefined;
      // Belt and braces: the server filter + RLS already scope this stream,
      // but never surface a row from any other conversation.
      if (!row?.id || row.conversation_id !== conversationId) return;
      handlers.onMessage(chatMessageFromRow(row));
    };

    try {
      channel = client.channel(`chat-messages:${conversationId}`);
      const filter = { schema: 'public', table: 'chat_messages', filter: `conversation_id=eq.${conversationId}` };
      channel.on('postgres_changes' as any, { event: 'INSERT', ...filter }, deliver);
      channel.on('postgres_changes' as any, { event: 'UPDATE', ...filter }, deliver);
      channel.subscribe((status: string) => {
        if (closed) return;
        handlers.onStatus(status === 'SUBSCRIBED' ? 'live' : 'reconnecting');
      });
    } catch {
      // Realtime unavailable: the screen still works through load/refresh.
      handlers.onStatus('reconnecting');
    }

    return () => {
      if (closed) return;
      closed = true;
      const current = channel;
      channel = null;
      if (current) client.removeChannel(current).catch(() => undefined);
    };
  },

  async notify(messageId) {
    if (!supabase) return;
    try {
      const { data, error } = await supabase.functions.invoke('send-chat-push', { body: { messageId } });
      if (error) {
        console.error('send-chat-push: Edge Function call failed (non-fatal):', error);
      } else if (data && (data as { ok?: boolean }).ok === false) {
        console.error('send-chat-push: Edge Function reported failure (non-fatal):', data);
      }
    } catch (err) {
      console.error('send-chat-push failed (non-fatal):', err);
    }
  },
};

let transportOverride: ChatTransport | null = null;
let localTransport: ChatTransport | null = null;

/** Supabase when configured; an on-device stand-in in local/demo mode. */
export function getChatTransport(): ChatTransport {
  if (transportOverride) return transportOverride;
  if (isSupabaseConfigured) return supabaseChatTransport;
  if (!localTransport) localTransport = createLocalChatTransport();
  return localTransport;
}

/** Test-only hook. Not used by production code paths. */
export function __setChatTransportForTests(transport: ChatTransport | null): void {
  transportOverride = transport;
}
