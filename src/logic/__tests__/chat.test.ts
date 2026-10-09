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
  applyMessageToConversations,
  chatLastMessageOf,
  formatChatListTime,
  formatChatPreview,
  sortChatConversations,
  totalUnreadChatMessages,
} from '../chat';
import type { ChatConversationState, ChatMessage } from '../../types';

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

// ---------------------------------------------------------------------------
// Conversations list (private conversations)
// ---------------------------------------------------------------------------

function conv(overrides: Partial<ChatConversationState> = {}): ChatConversationState {
  return {
    conversationId: 'conv-family',
    kind: 'family',
    familyId: 'family-1',
    userId: 'me',
    lastReadAt: '2026-10-09T09:00:00.000Z',
    notificationsMuted: false,
    unreadCount: 0,
    canModerate: false,
    lastActivityAt: '2026-10-09T09:00:00.000Z',
    ...overrides,
  };
}

describe('conversation list', () => {
  const family = conv();
  const direct = conv({ conversationId: 'conv-direct', kind: 'direct', otherUserId: 'user-b', lastActivityAt: '2026-10-09T08:00:00.000Z' });

  it('sorts by recent activity, the family conversation winning a tie', () => {
    expect(sortChatConversations([direct, family]).map((c) => c.conversationId)).toEqual(['conv-family', 'conv-direct']);
    const later = { ...direct, lastActivityAt: '2026-10-09T10:00:00.000Z' };
    expect(sortChatConversations([family, later]).map((c) => c.conversationId)).toEqual(['conv-direct', 'conv-family']);
    const tie = { ...direct, lastActivityAt: family.lastActivityAt };
    expect(sortChatConversations([tie, family]).map((c) => c.conversationId)).toEqual(['conv-family', 'conv-direct']);
  });

  it('totals unread across conversations for the tab badge', () => {
    expect(totalUnreadChatMessages([{ ...family, unreadCount: 2 }, { ...direct, unreadCount: 3 }])).toBe(5);
    expect(totalUnreadChatMessages([])).toBe(0);
  });

  it('builds a one-line preview from a message', () => {
    expect(chatLastMessageOf(message({ id: 'm', body: 'שורה אחת\nשורה שתיים' }))).toMatchObject({ preview: 'שורה אחת שורה שתיים', hasImage: false, deleted: false });
    expect(chatLastMessageOf(message({ id: 'm', body: '', attachment: { path: 'p', mime: 'image/jpeg', width: 1, height: 1, size: 1 } }))).toMatchObject({ preview: '', hasImage: true });
    expect(Array.from(chatLastMessageOf(message({ id: 'm', body: '🐶'.repeat(500) })).preview)).toHaveLength(140);
  });

  it('words the preview: names the sender in the family group, only "you" in a private conversation', () => {
    const last = chatLastMessageOf(message({ id: 'm', senderUserId: 'user-b', body: 'מי בבית?' }));
    expect(formatChatPreview(last, { myUserId: 'me', kind: 'family', senderName: 'אמא' })).toBe('אמא: מי בבית?');
    expect(formatChatPreview(last, { myUserId: 'me', kind: 'direct', senderName: 'אמא' })).toBe('מי בבית?');
    expect(formatChatPreview(last, { myUserId: 'user-b', kind: 'direct' })).toBe('את/ה: מי בבית?');
    expect(formatChatPreview({ ...last, hasImage: true, preview: '' }, { myUserId: 'me', kind: 'direct' })).toBe('📷 תמונה');
    expect(formatChatPreview({ ...last, hasImage: true, preview: 'טופי' }, { myUserId: 'me', kind: 'family', senderName: 'אמא' })).toBe('אמא: 📷 טופי');
    expect(formatChatPreview({ ...last, deleted: true, preview: '' }, { myUserId: 'me', kind: 'family', senderName: 'אמא' })).toBe('אמא: ההודעה הוסרה');
    expect(formatChatPreview(undefined, { myUserId: 'me', kind: 'family' })).toBe('כל המשפחה במקום אחד');
    expect(formatChatPreview(undefined, { myUserId: 'me', kind: 'direct' })).toBe('עדיין אין הודעות');
  });

  it('shows a compact time in the list', () => {
    const now = new Date(2026, 9, 9, 20, 0);
    expect(formatChatListTime(new Date(2026, 9, 9, 8, 5).toISOString(), now)).toBe('08:05');
    expect(formatChatListTime(new Date(2026, 9, 8, 23, 0).toISOString(), now)).toBe('אתמול');
    expect(formatChatListTime(new Date(2026, 9, 4, 12, 0).toISOString(), now)).toBe('04-10');
  });

  describe('applyMessageToConversations', () => {
    const incoming = message({ id: 'n1', conversationId: 'conv-direct', senderUserId: 'user-b', body: 'היי', createdAt: '2026-10-09T12:00:00.000Z' });

    it('updates the preview, bumps unread and moves the conversation to the top', () => {
      const next = applyMessageToConversations([family, direct], incoming, { isNew: true, isBeingRead: false });
      expect(next[0]).toMatchObject({ conversationId: 'conv-direct', unreadCount: 1, lastActivityAt: incoming.createdAt, lastMessage: { preview: 'היי' } });
      expect(next[1]).toBe(family);
    });

    it('does not count a message that is being read, is mine, is not new, or was removed', () => {
      const count = (m: typeof incoming, opts: { isNew: boolean; isBeingRead: boolean }) =>
        applyMessageToConversations([family, direct], m, opts).find((c) => c.conversationId === 'conv-direct')!.unreadCount;
      expect(count(incoming, { isNew: true, isBeingRead: true })).toBe(0);
      expect(count(incoming, { isNew: false, isBeingRead: false })).toBe(0);
      expect(count({ ...incoming, senderUserId: 'me' }, { isNew: true, isBeingRead: false })).toBe(0);
      expect(count({ ...incoming, deletedAt: '2026-10-09T12:01:00.000Z', body: '' }, { isNew: true, isBeingRead: false })).toBe(0);
    });

    it('an older message never replaces a newer preview; a removal of the last message does', () => {
      const withLast = { ...direct, lastMessage: chatLastMessageOf(incoming), lastActivityAt: incoming.createdAt };
      const older = message({ id: 'old', conversationId: 'conv-direct', senderUserId: 'user-b', body: 'ישן', createdAt: '2026-10-09T07:00:00.000Z' });
      expect(applyMessageToConversations([family, withLast], older, { isNew: false, isBeingRead: false })
        .find((c) => c.conversationId === 'conv-direct')!.lastMessage!.preview).toBe('היי');

      const removed = { ...incoming, body: '', deletedAt: '2026-10-09T12:05:00.000Z' };
      expect(applyMessageToConversations([family, withLast], removed, { isNew: false, isBeingRead: false })
        .find((c) => c.conversationId === 'conv-direct')!.lastMessage).toMatchObject({ deleted: true, preview: '' });
    });

    it('returns the same array for a conversation that is not listed, so nothing foreign is ever inserted', () => {
      const list = [family];
      expect(applyMessageToConversations(list, incoming, { isNew: true, isBeingRead: false })).toBe(list);
    });

    it('ignores an unsent local bubble for the preview', () => {
      const list = [family, direct];
      const unsent = { ...incoming, delivery: 'sending' as const };
      expect(applyMessageToConversations(list, unsent, { isNew: false, isBeingRead: true })).toBe(list);
    });
  });
});
