import { __setChatTransportForTests, ChatUnavailableError, type ChatSubscriptionHandlers, type ChatTransport } from '../../lib/chat';
import { __resetChatStoreForTests, useChatStore } from '../chatStore';
import type { ChatConversationState, ChatMessage } from '../../types';

/**
 * chatStore against an in-memory fake of the transport contract. The fake
 * behaves like the server where it matters for these tests: the sender is
 * whoever the "server" says the caller is, and a message id is idempotent.
 */

function serverMessage(overrides: Partial<ChatMessage> & { id: string }): ChatMessage {
  return {
    conversationId: 'conv-a',
    familyId: 'family-a',
    senderUserId: 'user-other',
    body: 'שלום',
    createdAt: '2026-10-09T10:00:00.000Z',
    delivery: 'sent',
    ...overrides,
  };
}

function createFakeTransport(initial: { conversationId?: string; userId?: string; unreadCount?: number; canModerate?: boolean } = {}) {
  const state = {
    conversation: {
      conversationId: initial.conversationId ?? 'conv-a',
      familyId: 'family-a',
      userId: initial.userId ?? 'user-me',
      lastReadAt: '2026-10-09T09:00:00.000Z',
      notificationsMuted: false,
      unreadCount: initial.unreadCount ?? 0,
      canModerate: initial.canModerate ?? false,
    } as ChatConversationState,
    messages: [] as ChatMessage[],
    sendCalls: [] as Array<{ conversationId: string; clientId: string; body: string }>,
    notifyCalls: [] as string[],
    markReadCalls: [] as string[],
    subscriptions: [] as Array<{ conversationId: string; handlers: ChatSubscriptionHandlers; active: boolean }>,
    failSendWith: null as Error | null,
    failOpenWith: null as Error | null,
    clock: Date.parse('2026-10-09T12:00:00.000Z'),
  };

  const transport: ChatTransport = {
    async open() {
      if (state.failOpenWith) throw state.failOpenWith;
      return { ...state.conversation };
    },
    async listMessages(conversationId, { before, limit }) {
      const own = state.messages
        .filter((m) => m.conversationId === conversationId && (!before || m.createdAt <= before))
        .sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1));
      return own.slice(-limit);
    },
    async send(conversationId, clientId, body) {
      state.sendCalls.push({ conversationId, clientId, body });
      if (state.failSendWith) throw state.failSendWith;
      const existing = state.messages.find((m) => m.id === clientId);
      if (existing) return existing;
      state.clock += 1000;
      const message = serverMessage({
        id: clientId,
        conversationId,
        senderUserId: state.conversation.userId,
        body,
        createdAt: new Date(state.clock).toISOString(),
      });
      state.messages.push(message);
      return message;
    },
    async remove(messageId) {
      const index = state.messages.findIndex((m) => m.id === messageId);
      if (index < 0) throw new Error('chat message not found');
      if (!state.conversation.canModerate) throw new Error('admin permission required');
      state.messages[index] = { ...state.messages[index], body: '', deletedAt: '2026-10-09T13:00:00.000Z', deletedByUserId: state.conversation.userId };
      return state.messages[index];
    },
    async markRead(_conversationId, readAt) {
      state.markReadCalls.push(readAt);
      state.conversation = { ...state.conversation, lastReadAt: readAt, unreadCount: 0 };
      return 0;
    },
    async setMuted(_conversationId, muted) {
      state.conversation = { ...state.conversation, notificationsMuted: muted };
      return muted;
    },
    subscribe(conversationId, handlers) {
      const subscription = { conversationId, handlers, active: true };
      state.subscriptions.push(subscription);
      handlers.onStatus('live');
      return () => {
        subscription.active = false;
      };
    },
    async notify(messageId) {
      state.notifyCalls.push(messageId);
    },
  };

  const activeSubscriptions = () => state.subscriptions.filter((s) => s.active);
  /** Simulates another device's message arriving over Realtime. */
  const push = (message: ChatMessage) => {
    const index = state.messages.findIndex((m) => m.id === message.id);
    if (index >= 0) state.messages[index] = message;
    else state.messages.push(message);
    activeSubscriptions().forEach((s) => s.handlers.onMessage(message));
  };

  return { transport, state, activeSubscriptions, push };
}

const flush = async () => {
  for (let i = 0; i < 25; i += 1) await Promise.resolve();
};

describe('chatStore', () => {
  let fake: ReturnType<typeof createFakeTransport>;

  beforeEach(() => {
    jest.useFakeTimers();
    fake = createFakeTransport();
    __setChatTransportForTests(fake.transport);
    __resetChatStoreForTests();
  });

  afterEach(() => {
    __resetChatStoreForTests();
    __setChatTransportForTests(null);
    jest.useRealTimers();
  });

  describe('loading', () => {
    it('opens the conversation, loads the latest page and subscribes exactly once', async () => {
      fake.state.messages.push(serverMessage({ id: 'm1' }), serverMessage({ id: 'm2', createdAt: '2026-10-09T10:01:00.000Z' }));
      fake.state.conversation.unreadCount = 2;

      await useChatStore.getState().start('family-a:user-me:self');

      const s = useChatStore.getState();
      expect(s.status).toBe('ready');
      expect(s.messages.map((m) => m.id)).toEqual(['m1', 'm2']);
      expect(s.unreadCount).toBe(2);
      expect(s.live).toBe('live');
      expect(fake.activeSubscriptions()).toHaveLength(1);
    });

    it('starting the same session again is a no-op (no second subscription)', async () => {
      await useChatStore.getState().start('family-a:user-me:self');
      await useChatStore.getState().start('family-a:user-me:self');
      expect(fake.state.subscriptions).toHaveLength(1);
    });

    it('reports a missing backend as "unavailable", not as a generic error', async () => {
      fake.state.failOpenWith = new ChatUnavailableError();
      await useChatStore.getState().start('family-a:user-me:self');
      expect(useChatStore.getState().status).toBe('unavailable');
      expect(fake.state.subscriptions).toHaveLength(0);
    });

    it('surfaces a load failure as a retryable error, and refresh() recovers', async () => {
      fake.state.failOpenWith = new Error('Failed to fetch');
      await useChatStore.getState().start('family-a:user-me:self');
      expect(useChatStore.getState().status).toBe('error');
      expect(useChatStore.getState().errorMessage).toBeTruthy();

      fake.state.failOpenWith = null;
      await useChatStore.getState().refresh();
      expect(useChatStore.getState().status).toBe('ready');
    });

    it('pages older messages without duplicating the boundary message', async () => {
      for (let i = 0; i < 55; i += 1) {
        fake.state.messages.push(
          serverMessage({ id: `m${String(i).padStart(2, '0')}`, createdAt: new Date(Date.parse('2026-10-09T08:00:00.000Z') + i * 60000).toISOString() })
        );
      }
      await useChatStore.getState().start('family-a:user-me:self');
      expect(useChatStore.getState().messages).toHaveLength(40);
      expect(useChatStore.getState().hasMore).toBe(true);

      await useChatStore.getState().loadOlder();
      const s = useChatStore.getState();
      expect(s.messages).toHaveLength(55);
      expect(new Set(s.messages.map((m) => m.id)).size).toBe(55);
      expect(s.messages[0].id).toBe('m00');
      expect(s.hasMore).toBe(false);
      expect(s.loadingOlder).toBe(false);
    });
  });

  describe('session isolation and cleanup', () => {
    it('stop() releases the Realtime subscription and clears every message', async () => {
      fake.state.messages.push(serverMessage({ id: 'm1' }));
      await useChatStore.getState().start('family-a:user-me:self');
      useChatStore.getState().stop();

      expect(fake.activeSubscriptions()).toHaveLength(0);
      const s = useChatStore.getState();
      expect(s.status).toBe('idle');
      expect(s.messages).toEqual([]);
      expect(s.conversation).toBeNull();
      expect(s.unreadCount).toBe(0);
    });

    it('switching family tears down the old subscription before subscribing to the new one', async () => {
      await useChatStore.getState().start('family-a:user-me:self');
      const first = fake.state.subscriptions[0];

      fake.state.conversation = { ...fake.state.conversation, conversationId: 'conv-b', familyId: 'family-b' };
      await useChatStore.getState().start('family-b:user-me2:self');

      expect(first.active).toBe(false);
      expect(fake.activeSubscriptions().map((s) => s.conversationId)).toEqual(['conv-b']);
    });

    it('a message that arrives on the OLD family channel after a switch is ignored', async () => {
      await useChatStore.getState().start('family-a:user-me:self');
      const oldHandlers = fake.state.subscriptions[0].handlers;

      fake.state.conversation = { ...fake.state.conversation, conversationId: 'conv-b', familyId: 'family-b' };
      await useChatStore.getState().start('family-b:user-me2:self');

      oldHandlers.onMessage(serverMessage({ id: 'leak', conversationId: 'conv-a', body: 'פרטי למשפחה א' }));
      expect(useChatStore.getState().messages).toEqual([]);
      expect(useChatStore.getState().unreadCount).toBe(0);
    });

    it('a slow response for the previous family is dropped, never written into the new one', async () => {
      let releaseOpen: (value: ChatConversationState) => void = () => undefined;
      const slowOpen = new Promise<ChatConversationState>((resolve) => { releaseOpen = resolve; });
      const originalOpen = fake.transport.open;
      fake.transport.open = () => slowOpen;

      const first = useChatStore.getState().start('family-a:user-me:self');
      // The person switches family while family A is still loading.
      fake.transport.open = originalOpen;
      fake.state.conversation = { ...fake.state.conversation, conversationId: 'conv-b', familyId: 'family-b' };
      await useChatStore.getState().start('family-b:user-me2:self');

      releaseOpen({ ...fake.state.conversation, conversationId: 'conv-a', familyId: 'family-a' });
      await first;

      expect(useChatStore.getState().conversation?.conversationId).toBe('conv-b');
      expect(fake.activeSubscriptions().map((s) => s.conversationId)).toEqual(['conv-b']);
    });

    it('ignores a row for a different conversation even on the live channel', async () => {
      await useChatStore.getState().start('family-a:user-me:self');
      fake.activeSubscriptions()[0].handlers.onMessage(serverMessage({ id: 'x', conversationId: 'conv-other' }));
      expect(useChatStore.getState().messages).toEqual([]);
    });
  });

  describe('sending', () => {
    beforeEach(async () => {
      await useChatStore.getState().start('family-a:user-me:self');
    });

    it('shows the message immediately, then confirms it — as ONE bubble', async () => {
      expect(useChatStore.getState().send('  מי מוציא את טופי?  ')).toEqual({ ok: true });
      let s = useChatStore.getState();
      expect(s.messages).toHaveLength(1);
      expect(s.messages[0]).toMatchObject({ body: 'מי מוציא את טופי?', delivery: 'sending', senderUserId: 'user-me' });

      await flush();
      s = useChatStore.getState();
      expect(s.messages).toHaveLength(1);
      expect(s.messages[0].delivery).toBe('sent');
      expect(fake.state.sendCalls).toHaveLength(1);
    });

    it('never sends a sender id or family id — only the conversation, an idempotency key and the text', async () => {
      useChatStore.getState().send('שלום');
      await flush();
      expect(Object.keys(fake.state.sendCalls[0]).sort()).toEqual(['body', 'clientId', 'conversationId']);
      expect(fake.state.sendCalls[0].clientId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    });

    it('the Realtime echo of my own message does not create a second bubble', async () => {
      useChatStore.getState().send('שלום');
      await flush();
      const confirmed = useChatStore.getState().messages[0];
      fake.push(confirmed);
      fake.push(confirmed);
      expect(useChatStore.getState().messages).toHaveLength(1);
    });

    it('rejects empty and over-long drafts without calling the server', async () => {
      expect(useChatStore.getState().send('   ')).toEqual({ ok: false, reason: 'empty' });
      expect(useChatStore.getState().send('א'.repeat(2001))).toEqual({ ok: false, reason: 'too_long' });
      await flush();
      expect(fake.state.sendCalls).toHaveLength(0);
      expect(useChatStore.getState().messages).toEqual([]);
    });

    it('triggers exactly one push per delivered message', async () => {
      useChatStore.getState().send('שלום');
      await flush();
      const id = useChatStore.getState().messages[0].id;
      expect(fake.state.notifyCalls).toEqual([id]);
    });

    it('a failed send stays visible as unsent, and retry re-uses the SAME id (no duplicate, one push)', async () => {
      fake.state.failSendWith = new Error('Failed to fetch');
      useChatStore.getState().send('הודעה חשובה');
      await flush();
      let s = useChatStore.getState();
      expect(s.messages[0].delivery).toBe('failed');
      expect(fake.state.notifyCalls).toEqual([]);
      const id = s.messages[0].id;

      fake.state.failSendWith = null;
      useChatStore.getState().retry(id);
      await flush();
      s = useChatStore.getState();
      expect(s.messages).toHaveLength(1);
      expect(s.messages[0]).toMatchObject({ id, delivery: 'sent' });
      expect(fake.state.sendCalls.map((c) => c.clientId)).toEqual([id, id]);
      expect(fake.state.messages).toHaveLength(1);
      expect(fake.state.notifyCalls).toEqual([id]);
    });

    it('a second retry while one is in flight is ignored', async () => {
      fake.state.failSendWith = new Error('Failed to fetch');
      useChatStore.getState().send('שלום');
      await flush();
      const id = useChatStore.getState().messages[0].id;
      fake.state.failSendWith = null;
      fake.state.sendCalls.length = 0;

      useChatStore.getState().retry(id);
      useChatStore.getState().retry(id);
      await flush();
      expect(fake.state.sendCalls).toHaveLength(1);
    });

    it('explains a server rejection on the bubble and does not auto-retry it', async () => {
      fake.state.failSendWith = new Error('chat messages are being sent too quickly');
      useChatStore.getState().send('שלום');
      await flush();
      const s = useChatStore.getState();
      const id = s.messages[0].id;
      expect(s.messages[0].delivery).toBe('failed');
      expect(s.sendErrors[id]).toBe('נשלחו הרבה הודעות ברצף. חכו רגע ונסו שוב.');

      fake.state.sendCalls.length = 0;
      await useChatStore.getState().resync();
      expect(fake.state.sendCalls).toHaveLength(0);
    });

    it('a discarded unsent message is removed', async () => {
      fake.state.failSendWith = new Error('Failed to fetch');
      useChatStore.getState().send('שלום');
      await flush();
      const id = useChatStore.getState().messages[0].id;
      useChatStore.getState().discard(id);
      expect(useChatStore.getState().messages).toEqual([]);
    });
  });

  describe('offline', () => {
    beforeEach(async () => {
      await useChatStore.getState().start('family-a:user-me:self');
    });

    it('holds a message written offline and delivers it once when the connection returns', async () => {
      useChatStore.getState().setOnline(false);
      useChatStore.getState().send('נשלח כשיחזור החיבור');
      await flush();
      expect(fake.state.sendCalls).toHaveLength(0);
      expect(useChatStore.getState().messages[0].delivery).toBe('failed');

      useChatStore.getState().setOnline(true);
      await flush();
      await flush();
      const s = useChatStore.getState();
      expect(s.messages).toHaveLength(1);
      expect(s.messages[0].delivery).toBe('sent');
      expect(fake.state.sendCalls).toHaveLength(1);
      expect(fake.state.messages).toHaveLength(1);
    });

    it('re-syncs messages missed while the live stream was down', async () => {
      const handlers = fake.activeSubscriptions()[0].handlers;
      handlers.onStatus('reconnecting');
      expect(useChatStore.getState().live).toBe('reconnecting');

      // Arrived while disconnected: stored on the server, never streamed.
      fake.state.messages.push(serverMessage({ id: 'missed', createdAt: '2026-10-09T11:00:00.000Z' }));
      handlers.onStatus('live');
      await flush();
      await flush();

      expect(useChatStore.getState().live).toBe('live');
      expect(useChatStore.getState().messages.map((m) => m.id)).toEqual(['missed']);
      expect(fake.state.subscriptions).toHaveLength(1);
    });
  });

  describe('unread counter', () => {
    beforeEach(async () => {
      await useChatStore.getState().start('family-a:user-me:self');
    });

    it('counts a new message from someone else while the chat is not on screen', () => {
      fake.push(serverMessage({ id: 'n1', createdAt: '2026-10-09T12:30:00.000Z' }));
      fake.push(serverMessage({ id: 'n2', createdAt: '2026-10-09T12:31:00.000Z' }));
      expect(useChatStore.getState().unreadCount).toBe(2);
    });

    it('does not count the same message twice, nor my own message from another device', () => {
      const incoming = serverMessage({ id: 'n1', createdAt: '2026-10-09T12:30:00.000Z' });
      fake.push(incoming);
      fake.push(incoming);
      fake.push(serverMessage({ id: 'mine', senderUserId: 'user-me', createdAt: '2026-10-09T12:31:00.000Z' }));
      expect(useChatStore.getState().unreadCount).toBe(1);
    });

    it('opening the chat clears the badge and advances the server read marker to the newest message', () => {
      fake.push(serverMessage({ id: 'n1', createdAt: '2026-10-09T12:30:00.000Z' }));
      useChatStore.getState().setScreenActive(true);
      expect(useChatStore.getState().unreadDividerFrom).toBe('2026-10-09T09:00:00.000Z');

      jest.advanceTimersByTime(500);
      expect(useChatStore.getState().unreadCount).toBe(0);
      expect(fake.state.markReadCalls).toEqual(['2026-10-09T12:30:00.000Z']);
    });

    it('a message that arrives while the chat is open is read immediately, not counted', () => {
      useChatStore.getState().setScreenActive(true);
      fake.push(serverMessage({ id: 'n1', createdAt: '2026-10-09T12:30:00.000Z' }));
      fake.push(serverMessage({ id: 'n2', createdAt: '2026-10-09T12:30:05.000Z' }));
      expect(useChatStore.getState().unreadCount).toBe(0);

      jest.advanceTimersByTime(500);
      // A burst is one debounced call, for the newest message.
      expect(fake.state.markReadCalls).toEqual(['2026-10-09T12:30:05.000Z']);
    });

    it('leaving the chat resumes counting', () => {
      useChatStore.getState().setScreenActive(true);
      useChatStore.getState().setScreenActive(false);
      fake.push(serverMessage({ id: 'n1', createdAt: '2026-10-09T12:30:00.000Z' }));
      expect(useChatStore.getState().unreadCount).toBe(1);
    });
  });

  describe('moderation', () => {
    it('a manager removes a message and the text is gone locally too', async () => {
      fake = createFakeTransport({ canModerate: true });
      __setChatTransportForTests(fake.transport);
      fake.state.messages.push(serverMessage({ id: 'bad', body: 'משהו לא מתאים' }));
      await useChatStore.getState().start('family-a:user-admin:self');
      expect(useChatStore.getState().conversation?.canModerate).toBe(true);

      await expect(useChatStore.getState().remove('bad')).resolves.toBe(true);
      expect(useChatStore.getState().messages[0]).toMatchObject({ id: 'bad', body: '', deletedAt: '2026-10-09T13:00:00.000Z' });
    });

    it('a removal made on another device arrives live', async () => {
      fake.state.messages.push(serverMessage({ id: 'bad', body: 'משהו לא מתאים' }));
      await useChatStore.getState().start('family-a:user-me:self');
      fake.push(serverMessage({ id: 'bad', body: '', deletedAt: '2026-10-09T13:00:00.000Z' }));
      expect(useChatStore.getState().messages[0]).toMatchObject({ body: '', deletedAt: '2026-10-09T13:00:00.000Z' });
    });

    it('a server refusal is reported and the message is left untouched', async () => {
      fake.state.messages.push(serverMessage({ id: 'm1', body: 'הודעה רגילה' }));
      await useChatStore.getState().start('family-a:user-me:self');

      await expect(useChatStore.getState().remove('m1')).resolves.toBe(false);
      expect(useChatStore.getState().actionError).toBe('רק מנהל/ת יכולים לבצע פעולה זו.');
      expect(useChatStore.getState().messages[0].body).toBe('הודעה רגילה');
    });
  });

  describe('notification preference', () => {
    it('mutes optimistically and rolls back if the server refuses', async () => {
      await useChatStore.getState().start('family-a:user-me:self');
      await useChatStore.getState().setMuted(true);
      expect(useChatStore.getState().conversation?.notificationsMuted).toBe(true);

      fake.transport.setMuted = async () => { throw new Error('boom'); };
      await useChatStore.getState().setMuted(false);
      expect(useChatStore.getState().conversation?.notificationsMuted).toBe(true);
      expect(useChatStore.getState().actionError).toBeTruthy();
    });
  });
});
