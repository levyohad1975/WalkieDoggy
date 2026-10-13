import type { ChatConversationState, ChatLastMessage, ChatMessage } from '../types';

/**
 * Pure Family Chat rules — no React, no Supabase, no storage. The server
 * (migration 0108's chat_send_message()) is the authority for every rule
 * here; these exist so the UI can explain a rejection before a round trip
 * and so the behaviour is unit-testable.
 */

export const CHAT_MESSAGE_MAX_LENGTH = 2000;
export const CHAT_PAGE_SIZE = 40;
/** Messages from the same sender within this window are visually grouped. */
const GROUP_WINDOW_MS = 5 * 60 * 1000;

// Control characters other than tab/newline. Mirrors the server's own strip.
const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;

export type ChatBodyValidation =
  | { ok: true; body: string }
  | { ok: false; reason: 'empty' | 'too_long'; length: number };

/** Normalises a draft exactly the way the server will, then validates it. */
export function validateChatBody(draft: string): ChatBodyValidation {
  const body = draft.replace(CONTROL_CHARS, '').replace(/\r\n/g, '\n').trim();
  const length = chatBodyLength(body);
  if (length === 0) return { ok: false, reason: 'empty', length };
  if (length > CHAT_MESSAGE_MAX_LENGTH) return { ok: false, reason: 'too_long', length };
  return { ok: true, body };
}

/** Length in Unicode code points — what Postgres' char_length() counts — so an emoji is one character on both sides. */
export function chatBodyLength(text: string): number {
  return Array.from(text).length;
}

const RTL_STRONG = /[֐-ࣿיִ-﷿ﹰ-ﻼ]/;
const LTR_STRONG = /[A-Za-zÀ-ɏͰ-ϿЀ-ӿ]/;

/**
 * Base direction of one message, from its first strongly-directional
 * character (the Unicode "first strong" heuristic browsers use for
 * dir="auto"). A message with no letters at all — digits, emoji — follows
 * the app's Hebrew default.
 */
export function chatTextDirection(text: string): 'rtl' | 'ltr' {
  for (const char of text) {
    if (RTL_STRONG.test(char)) return 'rtl';
    if (LTR_STRONG.test(char)) return 'ltr';
  }
  return 'rtl';
}

/**
 * Confirmed messages oldest first (id as a stable tie-break so two devices
 * always agree on order), then anything this device has not delivered yet.
 * Unsent messages carry the DEVICE's clock, which may disagree with the
 * server's, so they are kept below the confirmed history instead of being
 * interleaved into it by a timestamp nobody else shares.
 */
export function compareChatMessages(a: ChatMessage, b: ChatMessage): number {
  const aPending = a.delivery === 'sent' ? 0 : 1;
  const bPending = b.delivery === 'sent' ? 0 : 1;
  if (aPending !== bPending) return aPending - bPending;
  if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? -1 : 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/**
 * Merges server rows into the list by id. A server copy always replaces a
 * local optimistic copy of the same id (that is what makes a retried send,
 * its RPC result and its own Realtime echo collapse into ONE bubble), and a
 * newer server copy replaces an older one (moderation). A local message that
 * is still sending/failed is never dropped by a merge.
 */
export function mergeChatMessages(current: ChatMessage[], incoming: ChatMessage[]): ChatMessage[] {
  if (incoming.length === 0) return current;
  const byId = new Map<string, ChatMessage>();
  for (const message of current) byId.set(message.id, message);
  for (const message of incoming) {
    const existing = byId.get(message.id);
    // Never let a stale copy undo a moderation that already arrived.
    if (existing?.deletedAt && !message.deletedAt && message.delivery === 'sent') continue;
    byId.set(message.id, message);
  }
  return [...byId.values()].sort(compareChatMessages);
}

/** Unread = live messages from someone else that arrived after the read marker. */
export function countUnreadChatMessages(messages: ChatMessage[], myUserId: string | null, lastReadAt: string | null): number {
  if (!lastReadAt) return 0;
  return messages.filter(
    (m) => m.delivery === 'sent' && !m.deletedAt && m.senderUserId !== myUserId && m.createdAt > lastReadAt
  ).length;
}

/** Badge text: nothing for zero, capped so it can never widen the tab bar. */
export function formatChatBadge(count: number): string | null {
  if (!Number.isFinite(count) || count <= 0) return null;
  return count > 99 ? '99+' : String(Math.floor(count));
}

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

function dayKey(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** "14:05" in the device's own time zone. */
export function formatChatTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** Day separator label: היום / אתמול / dd-mm-yyyy (the app's existing date order). */
export function formatChatDay(iso: string, now: Date = new Date()): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const key = dayKey(date);
  if (key === dayKey(now)) return 'היום';
  const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
  if (key === dayKey(yesterday)) return 'אתמול';
  return `${pad(date.getDate())}-${pad(date.getMonth() + 1)}-${date.getFullYear()}`;
}

export type ChatListItem =
  | { type: 'day'; key: string; label: string }
  | { type: 'unread'; key: string }
  | {
      type: 'message';
      key: string;
      message: ChatMessage;
      isMine: boolean;
      /** First bubble of a run from one sender: shows the name and avatar. */
      startsGroup: boolean;
    };

/**
 * Turns the flat message list into what the screen renders: day separators,
 * one "new messages" divider at the first unread message, and per-bubble
 * grouping flags.
 */
export function buildChatListItems(
  messages: ChatMessage[],
  myUserId: string | null,
  options: { unreadFrom?: string | null; now?: Date } = {}
): ChatListItem[] {
  const items: ChatListItem[] = [];
  const now = options.now ?? new Date();
  let previous: ChatMessage | null = null;
  let previousDay = '';
  let unreadPlaced = false;

  for (const message of messages) {
    const day = dayKey(new Date(message.createdAt));
    const newDay = day !== previousDay;
    if (newDay) {
      items.push({ type: 'day', key: `day-${day}`, label: formatChatDay(message.createdAt, now) });
      previousDay = day;
    }

    const isMine = Boolean(myUserId) && message.senderUserId === myUserId;
    let unreadHere = false;
    if (
      !unreadPlaced &&
      options.unreadFrom &&
      !isMine &&
      !message.deletedAt &&
      message.delivery === 'sent' &&
      message.createdAt > options.unreadFrom
    ) {
      items.push({ type: 'unread', key: 'unread-divider' });
      unreadPlaced = true;
      unreadHere = true;
    }

    const startsGroup =
      newDay ||
      unreadHere ||
      !previous ||
      previous.senderUserId !== message.senderUserId ||
      new Date(message.createdAt).getTime() - new Date(previous.createdAt).getTime() > GROUP_WINDOW_MS;

    items.push({ type: 'message', key: message.id, message, isMine, startsGroup });
    previous = message;
  }
  return items;
}

// ---------------------------------------------------------------------------
// Conversations list (Phase 2: family conversation + private conversations)
// ---------------------------------------------------------------------------


/** Most recently active first; the family conversation wins a tie so the list is stable. */
export function sortChatConversations(conversations: ChatConversationState[]): ChatConversationState[] {
  return [...conversations].sort((a, b) => {
    if (a.lastActivityAt !== b.lastActivityAt) return a.lastActivityAt > b.lastActivityAt ? -1 : 1;
    if (a.kind !== b.kind) return a.kind === 'family' ? -1 : 1;
    return a.conversationId < b.conversationId ? -1 : 1;
  });
}

export function totalUnreadChatMessages(conversations: ChatConversationState[]): number {
  return conversations.reduce((sum, c) => sum + Math.max(0, c.unreadCount), 0);
}

const PREVIEW_MAX = 140;

export function chatLastMessageOf(message: ChatMessage): ChatLastMessage {
  const oneLine = message.body.replace(/\s+/g, ' ').trim();
  const chars = Array.from(oneLine);
  return {
    id: message.id,
    senderUserId: message.senderUserId,
    preview: chars.length > PREVIEW_MAX ? chars.slice(0, PREVIEW_MAX).join('') : oneLine,
    hasImage: Boolean(message.attachment),
    deleted: Boolean(message.deletedAt),
    createdAt: message.createdAt,
  };
}

/**
 * The one-line preview under a conversation in the Chats list. In the family
 * group the sender is named; in a private conversation only "you" needs
 * saying, because the other side is the conversation's own title.
 */
export function formatChatPreview(
  last: ChatLastMessage | undefined,
  options: { myUserId: string | null; kind: 'family' | 'direct' | 'group'; senderName?: string }
): string {
  if (!last) return options.kind === 'family' ? 'כל המשפחה במקום אחד' : 'עדיין אין הודעות';
  const mine = Boolean(options.myUserId) && last.senderUserId === options.myUserId;
  const who = mine ? 'את/ה' : options.kind === 'family' ? options.senderName ?? '' : '';
  const prefix = who ? `${who}: ` : '';
  if (last.deleted) return `${prefix}ההודעה הוסרה`;
  if (last.hasImage) return `${prefix}📷 ${last.preview || 'תמונה'}`;
  return `${prefix}${last.preview}`;
}

/** Compact time for the Chats list: time today, "אתמול", otherwise the date. */
export function formatChatListTime(iso: string, now: Date = new Date()): string {
  const label = formatChatDay(iso, now);
  if (label === 'היום') return formatChatTime(iso);
  if (label === 'אתמול') return label;
  // dd-mm-yyyy -> dd-mm (the year adds nothing in a narrow list column)
  return label.slice(0, 5);
}

/**
 * Applies one arriving/changed message to the conversation it belongs to:
 * updates the preview, the activity time and — when it is someone else's new
 * live message that is not being read right now — the unread counter.
 * Returns the same array when the conversation is not in the list (the caller
 * then refreshes the list from the server).
 */
export function applyMessageToConversations(
  conversations: ChatConversationState[],
  message: ChatMessage,
  options: { isNew: boolean; isBeingRead: boolean }
): ChatConversationState[] {
  const index = conversations.findIndex((c) => c.conversationId === message.conversationId);
  if (index < 0) return conversations;
  const current = conversations[index];
  const isNewer = !current.lastMessage || message.createdAt >= current.lastMessage.createdAt;
  const isSameAsLast = current.lastMessage?.id === message.id;
  const fromSomeoneElse = message.senderUserId !== current.userId;

  let next = current;
  if (message.delivery === 'sent' && (isNewer || isSameAsLast)) {
    next = {
      ...next,
      lastMessage: chatLastMessageOf(message),
      lastActivityAt: message.createdAt > next.lastActivityAt ? message.createdAt : next.lastActivityAt,
    };
  }
  if (options.isNew && fromSomeoneElse && !message.deletedAt && message.delivery === 'sent' && !options.isBeingRead) {
    next = { ...next, unreadCount: next.unreadCount + 1 };
  }
  if (next === current) return conversations;
  const copy = [...conversations];
  copy[index] = next;
  return sortChatConversations(copy);
}
