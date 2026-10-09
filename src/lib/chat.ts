import type { RealtimeChannel } from '@supabase/supabase-js';
import {
  isSupabaseConfigured,
  supabase,
  supabaseClientKey,
  supabaseProjectUrl,
  SupabaseNotConfiguredError,
} from './supabase';
import { rawMessageOf } from './errorMessages';
import { createLocalChatTransport } from './chatLocal';
import { CHAT_ATTACHMENT_BUCKET, ChatUploadCancelledError } from '../logic/chatImages';
import { chatImageUploadBody, type PreparedChatImage } from './chatImages';
import type { ChatAttachment, ChatConversationState, ChatLastMessage, ChatMessage } from '../types';

/**
 * Chat transport (migrations 0108_family_chat.sql and
 * 0109_private_chat_and_images.sql).
 *
 * Deliberately Supabase-direct rather than routed through Repository /
 * OfflineFirstRepository / SyncQueue, for the same reason lib/requests.ts
 * is: the server is the only authority on who the sender is and whether a
 * message may be posted, so a message is only ever shown as delivered once
 * the server has actually accepted it. Offline sends are held by chatStore
 * as visibly-unsent bubbles and retried with the SAME message id, which the
 * server treats as an idempotency key.
 *
 * Nothing here sends a sender id, a family id or a recipient list: every
 * RPC derives the caller from auth.uid() server-side. Images are never
 * addressed by URL — only by a private Storage path, for which the server
 * issues a short-lived signed URL if (and only if) the caller may read it.
 */

export type ChatLiveStatus = 'live' | 'reconnecting';

export interface ChatSubscriptionHandlers {
  /** A new message, or a changed one (removal), in ANY conversation the caller can read. */
  onMessage: (message: ChatMessage) => void;
  onStatus: (status: ChatLiveStatus) => void;
}

/** What this environment's backend supports (0109 may not be applied where 0108 is). */
export interface ChatCapabilities {
  privateConversations: boolean;
  images: boolean;
}

export interface ChatConversationListing {
  conversations: ChatConversationState[];
  capabilities: ChatCapabilities;
}

export interface ChatUploadHandle {
  promise: Promise<void>;
  /** Stops the transfer. The promise then rejects with a ChatUploadCancelledError. */
  cancel: () => void;
}

export interface ChatTransport {
  /** The caller's conversations (the family conversation is created on first use). */
  listConversations(): Promise<ChatConversationListing>;
  /** Opens — creating if needed — the private conversation with another member of the caller's family. */
  openDirect(otherUserId: string): Promise<ChatConversationState>;
  /** Newest `limit` messages at or before `before` (or the newest overall), returned oldest-first. */
  listMessages(conversationId: string, options: { before?: string; limit: number }): Promise<ChatMessage[]>;
  send(conversationId: string, clientId: string, body: string): Promise<ChatMessage>;
  sendImage(
    conversationId: string,
    clientId: string,
    attachment: { path: string; width: number; height: number },
    body: string
  ): Promise<ChatMessage>;
  remove(messageId: string): Promise<ChatMessage>;
  /** Returns the remaining unread count. */
  markRead(conversationId: string, readAt: string): Promise<number>;
  setMuted(conversationId: string, muted: boolean): Promise<boolean>;
  /** MUST return an unsubscribe function that releases every resource. */
  subscribe(handlers: ChatSubscriptionHandlers): () => void;
  /** Best-effort push trigger for a message this device just sent. Never throws. */
  notify(messageId: string): Promise<void>;

  /** Uploads the image to `path`. Resolves as soon as the file exists there (including when it already did). */
  uploadAttachment(path: string, image: PreparedChatImage, onProgress: (fraction: number) => void): ChatUploadHandle;
  /** Best-effort removal of an upload that never became a message. Never throws. */
  removeAttachment(path: string): Promise<void>;
  /** A short-lived URL for an image the caller is allowed to see. Rejects otherwise. */
  getAttachmentUrl(path: string): Promise<string>;
}

/** The chat backend is not installed on this environment yet (migration 0108 not applied). */
export class ChatUnavailableError extends Error {
  constructor() {
    super('family chat is not available on this environment yet');
  }
}

export { ChatUploadCancelledError };

/** PostgREST / Postgres codes meaning "this function or table does not exist here". */
const MISSING_BACKEND_CODES = new Set(['PGRST202', 'PGRST205', '42883', '42P01']);

export function isChatBackendMissing(error: unknown): boolean {
  if (error instanceof ChatUnavailableError) return true;
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === 'string' && MISSING_BACKEND_CODES.has(code);
}

/** A failure worth retrying automatically once the connection returns. */
export function isChatNetworkError(error: unknown): boolean {
  if (isChatBackendMissing(error) || error instanceof ChatUploadCancelledError) return false;
  const raw = rawMessageOf(error).toLowerCase();
  return (
    raw.includes('failed to fetch') ||
    raw.includes('network request failed') ||
    raw.includes('networkerror') ||
    raw.includes('network error') ||
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
  attachment_path?: string | null;
  attachment_mime?: string | null;
  attachment_width?: number | null;
  attachment_height?: number | null;
  attachment_size?: number | null;
}

const BASE_MESSAGE_COLUMNS = 'id, conversation_id, family_id, sender_user_id, body, created_at, deleted_at, deleted_by_user_id';
const ATTACHMENT_COLUMNS = 'attachment_path, attachment_mime, attachment_width, attachment_height, attachment_size';

function attachmentFromRow(row: ChatMessageRow): ChatAttachment | undefined {
  if (row.deleted_at || !row.attachment_path) return undefined;
  return {
    path: row.attachment_path,
    mime: row.attachment_mime ?? 'image/jpeg',
    width: Math.max(1, Number(row.attachment_width ?? 1)),
    height: Math.max(1, Number(row.attachment_height ?? 1)),
    size: Math.max(0, Number(row.attachment_size ?? 0)),
  };
}

export function chatMessageFromRow(row: ChatMessageRow): ChatMessage {
  return {
    id: row.id,
    conversationId: row.conversation_id,
    familyId: row.family_id,
    senderUserId: row.sender_user_id ?? undefined,
    // A removed message never carries text or an image, whatever a stale payload says.
    body: row.deleted_at ? '' : row.body,
    createdAt: new Date(row.created_at).toISOString(),
    deletedAt: row.deleted_at ? new Date(row.deleted_at).toISOString() : undefined,
    deletedByUserId: row.deleted_by_user_id ?? undefined,
    attachment: attachmentFromRow(row),
    delivery: 'sent',
  };
}

interface ConversationStateRow {
  conversation_id?: string;
  kind?: string;
  family_id?: string;
  user_id?: string;
  other_user_id?: string | null;
  last_read_at?: string;
  notifications_muted?: boolean;
  unread_count?: number;
  can_moderate?: boolean;
  last_activity_at?: string;
  last_message?: {
    id: string;
    sender_user_id: string | null;
    preview: string;
    has_image: boolean;
    deleted: boolean;
    created_at: string;
  } | null;
}

export function chatConversationFromRow(row: ConversationStateRow | null | undefined): ChatConversationState {
  if (!row?.conversation_id || !row.family_id || !row.user_id) {
    throw new Error('chat conversation could not be opened');
  }
  const lastReadAt = new Date(row.last_read_at ?? Date.now()).toISOString();
  const last: ChatLastMessage | undefined = row.last_message
    ? {
        id: row.last_message.id,
        senderUserId: row.last_message.sender_user_id ?? undefined,
        preview: row.last_message.deleted ? '' : row.last_message.preview ?? '',
        hasImage: row.last_message.has_image === true && !row.last_message.deleted,
        deleted: row.last_message.deleted === true,
        createdAt: new Date(row.last_message.created_at).toISOString(),
      }
    : undefined;
  return {
    conversationId: row.conversation_id,
    // 0108's chat_open_family_conversation() predates `kind`: it only ever
    // returns the family conversation.
    kind: row.kind === 'direct' ? 'direct' : 'family',
    familyId: row.family_id,
    userId: row.user_id,
    otherUserId: row.other_user_id ?? undefined,
    lastReadAt,
    notificationsMuted: row.notifications_muted === true,
    unreadCount: Math.max(0, Number(row.unread_count ?? 0)),
    canModerate: row.can_moderate === true,
    lastActivityAt: new Date(row.last_activity_at ?? last?.createdAt ?? lastReadAt).toISOString(),
    lastMessage: last,
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

// Whether this backend has migration 0109 (attachment columns). Learned from
// listConversations(); until then, assume the Phase 1 shape.
let attachmentColumnsAvailable = false;

// Signed URLs are cached in memory only, and only until shortly before they
// expire. They are never persisted and never logged.
const SIGNED_URL_TTL_SECONDS = 600;
const signedUrlCache = new Map<string, { url: string; expiresAt: number }>();

export function clearChatAttachmentUrlCache(): void {
  signedUrlCache.clear();
}

async function accessToken(): Promise<string> {
  const { data } = await requireSupabase().auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error('must be authenticated');
  return token;
}

export const supabaseChatTransport: ChatTransport = {
  async listConversations() {
    const client = requireSupabase();
    const { data, error } = await client.rpc('chat_list_conversations');
    if (!error) {
      attachmentColumnsAvailable = true;
      const rows = Array.isArray(data) ? (data as ConversationStateRow[]) : [];
      return {
        conversations: rows.map(chatConversationFromRow),
        capabilities: { privateConversations: true, images: true },
      };
    }
    if (!isChatBackendMissing(error)) throw error;

    // 0109 is not applied here. Fall back to Phase 1: the family
    // conversation only, text only. (If 0108 is missing too, this throws
    // ChatUnavailableError.)
    attachmentColumnsAvailable = false;
    const legacy = await client.rpc('chat_open_family_conversation');
    if (legacy.error) rethrow(legacy.error);
    return {
      conversations: [chatConversationFromRow(legacy.data as ConversationStateRow)],
      capabilities: { privateConversations: false, images: false },
    };
  },

  async openDirect(otherUserId) {
    const { data, error } = await requireSupabase().rpc('chat_open_direct_conversation', {
      p_other_user_id: otherUserId,
    });
    if (error) rethrow(error);
    return chatConversationFromRow(data as ConversationStateRow);
  },

  async listMessages(conversationId, { before, limit }) {
    const columns = attachmentColumnsAvailable ? `${BASE_MESSAGE_COLUMNS}, ${ATTACHMENT_COLUMNS}` : BASE_MESSAGE_COLUMNS;
    let query = requireSupabase()
      .from('chat_messages')
      .select(columns)
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
    return ((data ?? []) as unknown as ChatMessageRow[]).map(chatMessageFromRow).reverse();
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

  async sendImage(conversationId, clientId, attachment, body) {
    const { data, error } = await requireSupabase().rpc('chat_send_image_message', {
      p_conversation_id: conversationId,
      p_client_id: clientId,
      p_attachment_path: attachment.path,
      p_width: attachment.width,
      p_height: attachment.height,
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
    // Ask the server to physically remove any file whose message is gone.
    // Fire-and-forget: access to the file was already revoked by the delete.
    void requireSupabase()
      .functions.invoke('chat-attachment-cleanup', { body: {} })
      .catch(() => undefined);
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

  subscribe(handlers) {
    const client = supabase;
    if (!client) return () => undefined;

    let closed = false;
    let channel: RealtimeChannel | null = null;
    const deliver = (payload: { new?: unknown }) => {
      if (closed) return;
      const row = payload?.new as ChatMessageRow | undefined;
      if (!row?.id || !row.conversation_id) return;
      handlers.onMessage(chatMessageFromRow(row));
    };

    try {
      // One stream for every conversation the caller can read. There is no
      // client-side filter to get wrong: Realtime evaluates chat_messages'
      // SELECT policy for this session and delivers only rows that pass it.
      // The topic is unique per subscription so a stale channel can never be
      // reused across a profile or family switch.
      channel = client.channel(`chat-messages:${Date.now()}:${Math.random().toString(36).slice(2)}`);
      const target = { schema: 'public', table: 'chat_messages' };
      channel.on('postgres_changes' as any, { event: 'INSERT', ...target }, deliver);
      channel.on('postgres_changes' as any, { event: 'UPDATE', ...target }, deliver);
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

  uploadAttachment(path, image, onProgress) {
    // XMLHttpRequest rather than supabase-js: it is the only way to report
    // upload progress and to cancel mid-transfer. The request is the same
    // authenticated Storage call supabase-js would make, so the bucket's
    // INSERT policy (0109) decides whether it is allowed.
    const xhr = new XMLHttpRequest();
    let cancelled = false;

    const promise = (async () => {
      const [token, body] = await Promise.all([accessToken(), chatImageUploadBody(image)]);
      if (cancelled) throw new ChatUploadCancelledError();
      await new Promise<void>((resolve, reject) => {
        const encodedPath = path.split('/').map(encodeURIComponent).join('/');
        xhr.open('POST', `${supabaseProjectUrl}/storage/v1/object/${CHAT_ATTACHMENT_BUCKET}/${encodedPath}`);
        xhr.setRequestHeader('Authorization', `Bearer ${token}`);
        xhr.setRequestHeader('apikey', supabaseClientKey);
        xhr.setRequestHeader('Content-Type', image.mime);
        xhr.setRequestHeader('x-upsert', 'false');
        xhr.setRequestHeader('cache-control', 'max-age=31536000');
        xhr.upload.onprogress = (event) => {
          if (event.lengthComputable && event.total > 0) onProgress(Math.min(1, event.loaded / event.total));
        };
        xhr.onload = () => {
          if (xhr.status >= 200 && xhr.status < 300) {
            onProgress(1);
            resolve();
            return;
          }
          // A retry after a half-finished attempt: the file is already there.
          // (Storage reports a duplicate as HTTP 400 or 409 with "Duplicate".)
          const text = String(xhr.responseText ?? '');
          if (xhr.status === 409 || /duplicate|already exists/i.test(text)) {
            onProgress(1);
            resolve();
            return;
          }
          // Never include the response body or the path in a thrown message.
          reject(new Error(xhr.status === 413 ? 'chat attachment is too large' : `chat image upload failed (${xhr.status})`));
        };
        xhr.onerror = () => reject(new Error('Network request failed'));
        xhr.ontimeout = () => reject(new Error('Network request failed (timeout)'));
        xhr.onabort = () => reject(new ChatUploadCancelledError());
        xhr.timeout = 120_000;
        xhr.send(body);
      });
    })();

    return {
      promise,
      cancel: () => {
        cancelled = true;
        try {
          xhr.abort();
        } catch {
          // Not started yet: the `cancelled` flag covers it.
        }
      },
    };
  },

  async removeAttachment(path) {
    if (!supabase) return;
    try {
      await supabase.storage.from(CHAT_ATTACHMENT_BUCKET).remove([path]);
    } catch {
      // Best-effort: the server-side cleanup removes day-old orphans anyway.
    }
  },

  async getAttachmentUrl(path) {
    const cached = signedUrlCache.get(path);
    if (cached && cached.expiresAt > Date.now()) return cached.url;
    const { data, error } = await requireSupabase()
      .storage.from(CHAT_ATTACHMENT_BUCKET)
      .createSignedUrl(path, SIGNED_URL_TTL_SECONDS);
    if (error || !data?.signedUrl) throw new Error('chat image is not available');
    // Stop using a URL a minute before the server stops honouring it.
    signedUrlCache.set(path, { url: data.signedUrl, expiresAt: Date.now() + (SIGNED_URL_TTL_SECONDS - 60) * 1000 });
    return data.signedUrl;
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
