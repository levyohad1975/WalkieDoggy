import {
  CHAT_MESSAGE_MAX_LENGTH,
  buildChatListItems,
  chatBodyLength,
  chatTextDirection,
  compareChatMessages,
  countUnreadChatMessages,
  formatChatBadge,
  formatChatDay,
  formatChatTime,
  mergeChatMessages,
  validateChatBody,
} from '../chat';
import type { ChatMessage } from '../../types';

function message(overrides: Partial<ChatMessage> & { id: string }): ChatMessage {
  return {
    conversationId: 'conv-1',
    familyId: 'family-1',
    senderUserId: 'user-a',
    body: 'שלום',
    createdAt: '2026-10-09T10:00:00.000Z',
    delivery: 'sent',
    ...overrides,
  };
}

describe('validateChatBody', () => {
  it('trims and accepts a normal message', () => {
    expect(validateChatBody('  מי מוציא את הכלב?  \n')).toEqual({ ok: true, body: 'מי מוציא את הכלב?' });
  });

  it('rejects empty and whitespace-only drafts', () => {
    expect(validateChatBody('')).toMatchObject({ ok: false, reason: 'empty' });
    expect(validateChatBody(' \n\t ')).toMatchObject({ ok: false, reason: 'empty' });
  });

  it('strips control characters but keeps tabs and line breaks', () => {
    expect(validateChatBody('Hello\u0007 family\tOK\r\nline 2')).toEqual({ ok: true, body: 'Hello family\tOK\nline 2' });
    expect(validateChatBody('\u0000\u0001')).toMatchObject({ ok: false, reason: 'empty' });
  });

  it('enforces the same 2000-character limit as the server', () => {
    expect(CHAT_MESSAGE_MAX_LENGTH).toBe(2000);
    expect(validateChatBody('א'.repeat(2000))).toMatchObject({ ok: true });
    expect(validateChatBody('א'.repeat(2001))).toEqual({ ok: false, reason: 'too_long', length: 2001 });
  });

  it('counts an emoji as one character, like Postgres char_length()', () => {
    expect(chatBodyLength('🐶🐶')).toBe(2);
    expect(validateChatBody('🐶'.repeat(2000))).toMatchObject({ ok: true });
    expect(validateChatBody('🐶'.repeat(2001))).toMatchObject({ ok: false, reason: 'too_long' });
  });
});

describe('chatTextDirection', () => {
  it('is RTL for Hebrew and Arabic', () => {
    expect(chatTextDirection('שלום לכולם')).toBe('rtl');
    expect(chatTextDirection('مرحبا')).toBe('rtl');
  });

  it('is LTR for an English message', () => {
    expect(chatTextDirection('Who is walking Toffee tonight?')).toBe('ltr');
  });

  it('follows the FIRST strong character of a mixed message', () => {
    expect(chatTextDirection('OK אני יוצא')).toBe('ltr');
    expect(chatTextDirection('אני ב-Zoom עד 5')).toBe('rtl');
    expect(chatTextDirection('123 walk')).toBe('ltr');
    expect(chatTextDirection('🐶 יצאנו')).toBe('rtl');
  });

  it('defaults to the app direction when there are no letters at all', () => {
    expect(chatTextDirection('👍')).toBe('rtl');
    expect(chatTextDirection('17:30')).toBe('rtl');
    expect(chatTextDirection('')).toBe('rtl');
  });
});

describe('mergeChatMessages', () => {
  it('keeps messages oldest-first with a stable id tie-break', () => {
    const merged = mergeChatMessages(
      [message({ id: 'b', createdAt: '2026-10-09T10:00:00.000Z' })],
      [
        message({ id: 'c', createdAt: '2026-10-09T10:05:00.000Z' }),
        message({ id: 'a', createdAt: '2026-10-09T10:00:00.000Z' }),
      ]
    );
    expect(merged.map((m) => m.id)).toEqual(['a', 'b', 'c']);
  });

  it('collapses an optimistic bubble, the RPC result and the Realtime echo of one message into one row', () => {
    const optimistic = message({ id: 'm1', delivery: 'sending', createdAt: '2026-10-09T10:00:00.000Z' });
    const confirmed = message({ id: 'm1', delivery: 'sent', createdAt: '2026-10-09T10:00:01.000Z' });
    let list = mergeChatMessages([], [optimistic]);
    list = mergeChatMessages(list, [confirmed]);
    list = mergeChatMessages(list, [confirmed]);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ delivery: 'sent', createdAt: '2026-10-09T10:00:01.000Z' });
  });

  it('keeps unsent messages below confirmed history regardless of the device clock', () => {
    const unsent = message({ id: 'local', delivery: 'failed', createdAt: '2020-01-01T00:00:00.000Z' });
    const list = mergeChatMessages([unsent], [message({ id: 'server' })]);
    expect(list.map((m) => m.id)).toEqual(['server', 'local']);
    expect(compareChatMessages(unsent, message({ id: 'server' }))).toBeGreaterThan(0);
  });

  it('applies moderation, and a stale copy can never undo it', () => {
    const live = message({ id: 'm1', body: 'משהו לא יפה' });
    const removed = message({ id: 'm1', body: '', deletedAt: '2026-10-09T11:00:00.000Z' });
    let list = mergeChatMessages([live], [removed]);
    expect(list[0]).toMatchObject({ body: '', deletedAt: '2026-10-09T11:00:00.000Z' });
    list = mergeChatMessages(list, [live]);
    expect(list[0].deletedAt).toBe('2026-10-09T11:00:00.000Z');
    expect(list[0].body).toBe('');
  });

  it('returns the same array when there is nothing to merge', () => {
    const current = [message({ id: 'a' })];
    expect(mergeChatMessages(current, [])).toBe(current);
  });
});

describe('unread counting and badge', () => {
  const messages = [
    message({ id: '1', senderUserId: 'user-b', createdAt: '2026-10-09T09:00:00.000Z' }),
    message({ id: '2', senderUserId: 'user-b', createdAt: '2026-10-09T10:30:00.000Z' }),
    message({ id: '3', senderUserId: 'me', createdAt: '2026-10-09T10:31:00.000Z' }),
    message({ id: '4', senderUserId: 'user-c', createdAt: '2026-10-09T10:32:00.000Z', deletedAt: '2026-10-09T10:33:00.000Z', body: '' }),
    message({ id: '5', senderUserId: 'user-c', createdAt: '2026-10-09T10:34:00.000Z' }),
  ];

  it('counts only live messages from other people after the read marker', () => {
    expect(countUnreadChatMessages(messages, 'me', '2026-10-09T10:00:00.000Z')).toBe(2);
    expect(countUnreadChatMessages(messages, 'me', '2026-10-09T10:34:00.000Z')).toBe(0);
    expect(countUnreadChatMessages(messages, 'me', null)).toBe(0);
  });

  it('formats the badge: hidden at zero, capped at 99+', () => {
    expect(formatChatBadge(0)).toBeNull();
    expect(formatChatBadge(-3)).toBeNull();
    expect(formatChatBadge(Number.NaN)).toBeNull();
    expect(formatChatBadge(1)).toBe('1');
    expect(formatChatBadge(99)).toBe('99');
    expect(formatChatBadge(100)).toBe('99+');
  });
});

describe('time and day labels', () => {
  const at = (h: number, m: number, dayOffset = 0) => new Date(2026, 9, 9 + dayOffset, h, m).toISOString();
  const now = new Date(2026, 9, 9, 20, 0);

  it('formats a 24-hour time', () => {
    expect(formatChatTime(at(7, 5))).toBe('07:05');
    expect(formatChatTime(at(19, 40))).toBe('19:40');
    expect(formatChatTime('not a date')).toBe('');
  });

  it('labels today, yesterday and older days', () => {
    expect(formatChatDay(at(8, 0), now)).toBe('היום');
    expect(formatChatDay(at(23, 0, -1), now)).toBe('אתמול');
    expect(formatChatDay(at(12, 0, -5), now)).toBe('04-10-2026');
  });
});

describe('buildChatListItems', () => {
  const at = (h: number, m: number, dayOffset = 0) => new Date(2026, 9, 9 + dayOffset, h, m).toISOString();
  const now = new Date(2026, 9, 9, 20, 0);

  it('adds day separators and groups consecutive messages from one sender', () => {
    const items = buildChatListItems(
      [
        message({ id: '1', senderUserId: 'user-b', createdAt: at(9, 0, -1) }),
        message({ id: '2', senderUserId: 'user-b', createdAt: at(9, 0) }),
        message({ id: '3', senderUserId: 'user-b', createdAt: at(9, 2) }),
        message({ id: '4', senderUserId: 'me', createdAt: at(9, 3) }),
        message({ id: '5', senderUserId: 'me', createdAt: at(9, 30) }),
      ],
      'me',
      { now }
    );
    expect(items.map((i) => (i.type === 'message' ? `${i.message.id}:${i.startsGroup ? 'start' : 'cont'}:${i.isMine ? 'mine' : 'theirs'}` : `${i.type}:${i.type === 'day' ? i.label : ''}`))).toEqual([
      'day:אתמול',
      '1:start:theirs',
      'day:היום',
      '2:start:theirs',
      '3:cont:theirs',
      '4:start:mine',
      // Same sender, but more than five minutes later: a new visual group.
      '5:start:mine',
    ]);
  });

  it('places exactly one "new messages" divider, before the first unread message from someone else', () => {
    const items = buildChatListItems(
      [
        message({ id: '1', senderUserId: 'user-b', createdAt: at(9, 0) }),
        message({ id: '2', senderUserId: 'me', createdAt: at(9, 10) }),
        message({ id: '3', senderUserId: 'user-b', createdAt: at(9, 20) }),
        message({ id: '4', senderUserId: 'user-b', createdAt: at(9, 21) }),
      ],
      'me',
      { unreadFrom: at(9, 5), now }
    );
    expect(items.map((i) => (i.type === 'message' ? i.message.id : i.type))).toEqual(['day', '1', '2', 'unread', '3', '4']);
    const third = items[4];
    expect(third.type === 'message' && third.startsGroup).toBe(true);
  });

  it('shows no divider without a read marker, and never treats my own message as unread', () => {
    const list = [message({ id: '1', senderUserId: 'me', createdAt: at(9, 0) })];
    expect(buildChatListItems(list, 'me', { now }).some((i) => i.type === 'unread')).toBe(false);
    expect(buildChatListItems(list, 'me', { unreadFrom: at(8, 0), now }).some((i) => i.type === 'unread')).toBe(false);
  });

  it('keys every row uniquely', () => {
    const items = buildChatListItems(
      [message({ id: '1', createdAt: at(9, 0, -1) }), message({ id: '2', createdAt: at(9, 0) })],
      'me',
      { unreadFrom: at(8, 0, -2), now }
    );
    expect(new Set(items.map((i) => i.key)).size).toBe(items.length);
  });
});
