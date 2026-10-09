import { __setChatTransportForTests, ChatUnavailableError } from '../../lib/chat';
import { __resetChatStoreForTests, getLocalChatImagePreview, useChatStore } from '../chatStore';
import {
  FAKE_IMAGE,
  createFakeChatTransport,
  fakeChatConversation,
  fakeChatMessage,
} from '../../testUtils/fakeChatTransport';
import type { ChatConversationState } from '../../types';

/**
 * chatStore against an in-memory fake of the transport contract (see
 * testUtils/fakeChatTransport.ts for what the fake enforces).
 */

const FAMILY = 'conv-family';
const DIRECT = 'conv-direct-noa';

const flush = async () => {
  for (let i = 0; i < 30; i += 1) await Promise.resolve();
};

const store = () => useChatStore.getState();
const thread = (id: string) => store().threads[id];
const conversation = (id: string) => store().conversations.find((c) => c.conversationId === id);

describe('chatStore', () => {
  let fake: ReturnType<typeof createFakeChatTransport>;

  const withDirect = () =>
    createFakeChatTransport({
      conversations: [
        fakeChatConversation(),
        fakeChatConversation({ conversationId: DIRECT, kind: 'direct', otherUserId: 'user-noa', lastActivityAt: '2026-10-09T08:00:00.000Z' }),
      ],
    });

  const use = (next: ReturnType<typeof createFakeChatTransport>) => {
    fake = next;
    __setChatTransportForTests(fake.transport);
  };

  beforeEach(() => {
    jest.useFakeTimers();
    use(createFakeChatTransport());
    __resetChatStoreForTests();
  });

  afterEach(() => {
    __resetChatStoreForTests();
    __setChatTransportForTests(null);
    jest.useRealTimers();
  });

  describe('loading the conversation list', () => {
    it('lists the family conversation and private conversations, most recently active first, and subscribes once', async () => {
      use(withDirect());
      fake.state.conversations[1].lastActivityAt = '2026-10-09T11:00:00.000Z';
      fake.state.conversations[1].unreadCount = 2;
      fake.state.conversations[0].unreadCount = 1;

      await store().start('family-a:user-me:self');

      expect(store().status).toBe('ready');
      expect(store().conversations.map((c) => c.conversationId)).toEqual([DIRECT, FAMILY]);
      // The tab badge is the total across conversations.
      expect(store().unreadCount).toBe(3);
      expect(store().live).toBe('live');
      expect(fake.activeSubscriptions()).toHaveLength(1);
      // No message is fetched until a conversation is opened.
      expect(store().threads).toEqual({});
    });

    it('starting the same session again is a no-op (no second subscription)', async () => {
      await store().start('family-a:user-me:self');
      await store().start('family-a:user-me:self');
      expect(fake.state.subscriptions).toHaveLength(1);
    });

    it('reports a missing backend as "unavailable", not as a generic error', async () => {
      fake.state.failListWith = new ChatUnavailableError();
      await store().start('family-a:user-me:self');
      expect(store().status).toBe('unavailable');
      expect(fake.state.subscriptions).toHaveLength(0);
    });

    it('surfaces a load failure as a retryable error, and refresh() recovers', async () => {
      fake.state.failListWith = new Error('Failed to fetch');
      await store().start('family-a:user-me:self');
      expect(store().status).toBe('error');
      expect(store().errorMessage).toBeTruthy();

      fake.state.failListWith = null;
      await store().refresh();
      expect(store().status).toBe('ready');
    });

    it('hides private chats and images where the backend only has Phase 1', async () => {
      use(createFakeChatTransport({ capabilities: { privateConversations: false, images: false } }));
      await store().start('family-a:user-me:self');
      store().openConversation(FAMILY);
      await flush();
      expect(store().capabilities).toEqual({ privateConversations: false, images: false });
      expect(store().sendImage(FAKE_IMAGE, '')).toEqual({ ok: false, reason: 'not_ready' });
      expect(fake.state.uploadCalls).toEqual([]);
    });
  });

  describe('opening a conversation', () => {
    it('loads the latest page lazily and keeps threads separate', async () => {
      use(withDirect());
      fake.state.messages.push(
        fakeChatMessage({ id: 'f1' }),
        fakeChatMessage({ id: 'd1', conversationId: DIRECT, senderUserId: 'user-noa', body: 'רק בינינו' })
      );
      await store().start('family-a:user-me:self');

      store().openConversation(DIRECT);
      expect(thread(DIRECT).status).toBe('loading');
      await flush();

      expect(store().activeConversationId).toBe(DIRECT);
      expect(thread(DIRECT).messages.map((m) => m.id)).toEqual(['d1']);
      expect(thread(FAMILY)).toBeUndefined();

      store().closeConversation();
      store().openConversation(FAMILY);
      await flush();
      expect(thread(FAMILY).messages.map((m) => m.id)).toEqual(['f1']);
      expect(thread(DIRECT).messages.map((m) => m.id)).toEqual(['d1']);
    });

    it('ignores a request to open a conversation that is not in the list', async () => {
      await store().start('family-a:user-me:self');
      store().openConversation('conv-someone-elses');
      expect(store().activeConversationId).toBeNull();
    });

    it('pages older messages without duplicating the boundary message', async () => {
      for (let i = 0; i < 55; i += 1) {
        fake.state.messages.push(
          fakeChatMessage({ id: `m${String(i).padStart(2, '0')}`, createdAt: new Date(Date.parse('2026-10-09T08:00:00.000Z') + i * 60000).toISOString() })
        );
      }
      await store().start('family-a:user-me:self');
      store().openConversation(FAMILY);
      await flush();
      expect(thread(FAMILY).messages).toHaveLength(40);
      expect(thread(FAMILY).hasMore).toBe(true);

      await store().loadOlder();
      expect(thread(FAMILY).messages).toHaveLength(55);
      expect(new Set(thread(FAMILY).messages.map((m) => m.id)).size).toBe(55);
      expect(thread(FAMILY).messages[0].id).toBe('m00');
      expect(thread(FAMILY).hasMore).toBe(false);
    });

    it('a tapped notification opens its conversation, waiting for the list if needed', async () => {
      use(withDirect());
      const starting = store().start('family-a:user-me:self');
      store().requestOpenConversation(DIRECT);
      expect(store().activeConversationId).toBeNull();
      await starting;
      await flush();
      expect(store().activeConversationId).toBe(DIRECT);
    });

    it('a notification for a conversation this profile cannot see opens nothing', async () => {
      await store().start('family-a:user-me:self');
      store().requestOpenConversation('conv-not-mine');
      jest.advanceTimersByTime(700);
      await flush();
      expect(store().activeConversationId).toBeNull();
    });
  });

  describe('private conversations', () => {
    it('starts one with another family member and opens it', async () => {
      await store().start('family-a:user-me:self');
      const id = await store().startDirect('user-noa');
      await flush();

      expect(fake.state.openDirectCalls).toEqual(['user-noa']);
      expect(store().activeConversationId).toBe(id);
      expect(conversation(id!)).toMatchObject({ kind: 'direct', otherUserId: 'user-noa' });
      expect(store().conversations).toHaveLength(2);
    });

    it('starting it again reuses the same conversation — never a duplicate', async () => {
      await store().start('family-a:user-me:self');
      const first = await store().startDirect('user-noa');
      store().closeConversation();
      const second = await store().startDirect('user-noa');
      expect(second).toBe(first);
      expect(store().conversations.filter((c) => c.kind === 'direct')).toHaveLength(1);
    });

    it('a private message is sent to its own conversation only', async () => {
      use(withDirect());
      await store().start('family-a:user-me:self');
      store().openConversation(DIRECT);
      await flush();

      store().send('סוד');
      await flush();

      expect(fake.state.sendCalls).toEqual([expect.objectContaining({ conversationId: DIRECT, body: 'סוד' })]);
      expect(thread(DIRECT).messages).toHaveLength(1);
      expect(thread(FAMILY)).toBeUndefined();
      expect(conversation(DIRECT)?.lastMessage?.preview).toBe('סוד');
      expect(conversation(FAMILY)?.lastMessage).toBeUndefined();
    });

    it('a message for a conversation this session does not know is never stored — the server is asked instead', async () => {
      await store().start('family-a:user-me:self');
      store().openConversation(FAMILY);
      await flush();
      const listCallsBefore = fake.state.listCalls;

      // E.g. someone just started a private conversation with this profile…
      // or the row belongs to a conversation this profile is not part of.
      fake.activeSubscriptions()[0].handlers.onMessage(
        fakeChatMessage({ id: 'x1', conversationId: 'conv-unknown', body: 'פרטי של מישהו אחר' })
      );

      expect(JSON.stringify(store().threads)).not.toContain('פרטי של מישהו אחר');
      expect(JSON.stringify(store().conversations)).not.toContain('פרטי של מישהו אחר');
      expect(store().unreadCount).toBe(0);

      jest.advanceTimersByTime(700);
      await flush();
      expect(fake.state.listCalls).toBe(listCallsBefore + 1);
    });

    it('a new private conversation started by someone else appears after the list refresh, with its unread count', async () => {
      await store().start('family-a:user-me:self');
      const incoming = fakeChatMessage({ id: 'd1', conversationId: DIRECT, senderUserId: 'user-noa', body: 'היי', createdAt: '2026-10-09T12:30:00.000Z' });
      fake.state.conversations.push(
        fakeChatConversation({ conversationId: DIRECT, kind: 'direct', otherUserId: 'user-noa', unreadCount: 1, lastActivityAt: incoming.createdAt })
      );
      fake.push(incoming);

      jest.advanceTimersByTime(700);
      await flush();

      expect(conversation(DIRECT)).toMatchObject({ kind: 'direct', unreadCount: 1 });
      expect(store().unreadCount).toBe(1);
    });

    it('only the sender can remove a private message; the refusal is reported', async () => {
      use(withDirect());
      fake.state.messages.push(fakeChatMessage({ id: 'theirs', conversationId: DIRECT, senderUserId: 'user-noa', body: 'שלה' }));
      await store().start('family-a:user-me:self');
      store().openConversation(DIRECT);
      await flush();

      await expect(store().remove('theirs')).resolves.toBe(false);
      expect(store().actionError).toBe('רק מי ששלח/ה את ההודעה יכול/ה למחוק אותה.');
      expect(thread(DIRECT).messages[0].body).toBe('שלה');

      store().send('שלי');
      await flush();
      const mine = thread(DIRECT).messages.find((m) => m.body === 'שלי')!;
      await expect(store().remove(mine.id)).resolves.toBe(true);
      expect(thread(DIRECT).messages.find((m) => m.id === mine.id)).toMatchObject({ body: '', deletedAt: expect.any(String) });
    });
  });

  describe('session isolation and cleanup', () => {
    it('stop() releases the subscription and forgets every conversation, message and preview', async () => {
      use(withDirect());
      fake.state.messages.push(fakeChatMessage({ id: 'd1', conversationId: DIRECT, body: 'פרטי' }));
      await store().start('family-a:user-me:self');
      store().openConversation(DIRECT);
      await flush();
      store().sendImage(FAKE_IMAGE, '');
      await flush();
      const path = thread(DIRECT).messages.find((m) => m.attachment)!.attachment!.path;
      expect(getLocalChatImagePreview(path)).toBe(FAKE_IMAGE.uri);

      store().stop();

      expect(fake.activeSubscriptions()).toHaveLength(0);
      expect(store().status).toBe('idle');
      expect(store().conversations).toEqual([]);
      expect(store().threads).toEqual({});
      expect(store().activeConversationId).toBeNull();
      expect(store().unreadCount).toBe(0);
      expect(getLocalChatImagePreview(path)).toBeUndefined();
    });

    it('switching profile tears down the old session before the new one starts', async () => {
      use(withDirect());
      fake.state.messages.push(fakeChatMessage({ id: 'd1', conversationId: DIRECT, body: 'פרטי של הפרופיל הקודם' }));
      await store().start('family-a:user-me:self');
      store().openConversation(DIRECT);
      await flush();
      const first = fake.state.subscriptions[0];

      // The next profile on this device is not a participant of that conversation.
      const next = createFakeChatTransport({ userId: 'user-other-profile' });
      __setChatTransportForTests(next.transport);
      await store().start('family-a:user-other-profile:self');

      expect(first.active).toBe(false);
      expect(JSON.stringify(useChatStore.getState())).not.toContain('פרטי של הפרופיל הקודם');
      expect(store().conversations.map((c) => c.conversationId)).toEqual([FAMILY]);
      expect(store().activeConversationId).toBeNull();
    });

    it('a message arriving on the OLD session channel after a switch is ignored', async () => {
      await store().start('family-a:user-me:self');
      const oldHandlers = fake.state.subscriptions[0].handlers;

      const next = createFakeChatTransport({ conversations: [fakeChatConversation({ conversationId: 'conv-b', familyId: 'family-b' })] });
      __setChatTransportForTests(next.transport);
      await store().start('family-b:user-me2:self');

      oldHandlers.onMessage(fakeChatMessage({ id: 'leak', body: 'פרטי למשפחה א' }));
      expect(JSON.stringify(store().threads)).not.toContain('פרטי למשפחה א');
      expect(store().unreadCount).toBe(0);
    });

    it('a slow response for the previous session is dropped, never written into the new one', async () => {
      let release: (value: { conversations: ChatConversationState[]; capabilities: { privateConversations: boolean; images: boolean } }) => void = () => undefined;
      const slow = new Promise<{ conversations: ChatConversationState[]; capabilities: { privateConversations: boolean; images: boolean } }>((resolve) => { release = resolve; });
      const original = fake.transport.listConversations;
      fake.transport.listConversations = () => slow;

      const first = store().start('family-a:user-me:self');
      fake.transport.listConversations = original;
      fake.state.conversations = [fakeChatConversation({ conversationId: 'conv-b', familyId: 'family-b' })];
      await store().start('family-b:user-me2:self');

      release({ conversations: [fakeChatConversation({ conversationId: 'conv-a-old' })], capabilities: { privateConversations: true, images: true } });
      await first;

      expect(store().conversations.map((c) => c.conversationId)).toEqual(['conv-b']);
      expect(fake.activeSubscriptions()).toHaveLength(1);
    });
  });

  describe('sending text', () => {
    beforeEach(async () => {
      await store().start('family-a:user-me:self');
      store().openConversation(FAMILY);
      await flush();
    });

    it('shows the message immediately, then confirms it — as ONE bubble', async () => {
      expect(store().send('  מי מוציא את טופי?  ')).toEqual({ ok: true });
      expect(thread(FAMILY).messages).toHaveLength(1);
      expect(thread(FAMILY).messages[0]).toMatchObject({ body: 'מי מוציא את טופי?', delivery: 'sending', senderUserId: 'user-me' });

      await flush();
      expect(thread(FAMILY).messages).toHaveLength(1);
      expect(thread(FAMILY).messages[0].delivery).toBe('sent');
      expect(fake.state.sendCalls).toHaveLength(1);
      expect(conversation(FAMILY)?.lastMessage?.preview).toBe('מי מוציא את טופי?');
    });

    it('never sends a sender id or family id — only the conversation, an idempotency key and the text', async () => {
      store().send('שלום');
      await flush();
      expect(Object.keys(fake.state.sendCalls[0]).sort()).toEqual(['body', 'clientId', 'conversationId']);
      expect(fake.state.sendCalls[0].clientId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    });

    it('the Realtime echo of my own message does not create a second bubble or count as unread', async () => {
      store().send('שלום');
      await flush();
      const confirmed = thread(FAMILY).messages[0];
      fake.push(confirmed);
      fake.push(confirmed);
      expect(thread(FAMILY).messages).toHaveLength(1);
      expect(store().unreadCount).toBe(0);
    });

    it('rejects empty and over-long drafts without calling the server', async () => {
      expect(store().send('   ')).toEqual({ ok: false, reason: 'empty' });
      expect(store().send('א'.repeat(2001))).toEqual({ ok: false, reason: 'too_long' });
      await flush();
      expect(fake.state.sendCalls).toHaveLength(0);
      expect(thread(FAMILY).messages).toEqual([]);
    });

    it('refuses to send with no conversation open', () => {
      store().closeConversation();
      expect(store().send('שלום')).toEqual({ ok: false, reason: 'not_ready' });
    });

    it('triggers exactly one push per delivered message', async () => {
      store().send('שלום');
      await flush();
      expect(fake.state.notifyCalls).toEqual([thread(FAMILY).messages[0].id]);
    });

    it('a failed send stays visible as unsent, and retry re-uses the SAME id (no duplicate, one push)', async () => {
      fake.state.failSendWith = new Error('Failed to fetch');
      store().send('הודעה חשובה');
      await flush();
      expect(thread(FAMILY).messages[0].delivery).toBe('failed');
      expect(fake.state.notifyCalls).toEqual([]);
      const id = thread(FAMILY).messages[0].id;

      fake.state.failSendWith = null;
      store().retry(id);
      await flush();
      expect(thread(FAMILY).messages).toHaveLength(1);
      expect(thread(FAMILY).messages[0]).toMatchObject({ id, delivery: 'sent' });
      expect(fake.state.sendCalls.map((c) => c.clientId)).toEqual([id, id]);
      expect(fake.state.messages).toHaveLength(1);
      expect(fake.state.notifyCalls).toEqual([id]);
    });

    it('a second retry while one is in flight is ignored', async () => {
      fake.state.failSendWith = new Error('Failed to fetch');
      store().send('שלום');
      await flush();
      const id = thread(FAMILY).messages[0].id;
      fake.state.failSendWith = null;
      fake.state.sendCalls.length = 0;

      store().retry(id);
      store().retry(id);
      await flush();
      expect(fake.state.sendCalls).toHaveLength(1);
    });

    it('explains a server rejection on the bubble and does not auto-retry it', async () => {
      fake.state.failSendWith = new Error('chat messages are being sent too quickly');
      store().send('שלום');
      await flush();
      const id = thread(FAMILY).messages[0].id;
      expect(thread(FAMILY).messages[0].delivery).toBe('failed');
      expect(store().sendErrors[id]).toBe('נשלחו הרבה הודעות ברצף. חכו רגע ונסו שוב.');

      fake.state.sendCalls.length = 0;
      await store().resync();
      expect(fake.state.sendCalls).toHaveLength(0);
    });

    it('a discarded unsent message is removed', async () => {
      fake.state.failSendWith = new Error('Failed to fetch');
      store().send('שלום');
      await flush();
      store().discard(thread(FAMILY).messages[0].id);
      expect(thread(FAMILY).messages).toEqual([]);
    });
  });

  describe('sending images', () => {
    const start = async (options: Parameters<typeof createFakeChatTransport>[0] = {}) => {
      use(createFakeChatTransport(options));
      await store().start('family-a:user-me:self');
      store().openConversation(FAMILY);
      await flush();
    };

    it('uploads first, then attaches — one upload, one message, one push', async () => {
      await start();
      expect(store().sendImage(FAKE_IMAGE, '  טופי בגינה ')).toEqual({ ok: true });
      await flush();

      const message = thread(FAMILY).messages[0];
      const expectedPath = `${FAMILY}/user-me/${message.id}.jpg`;
      expect(fake.state.uploadCalls).toEqual([expectedPath]);
      expect(fake.state.sendImageCalls).toEqual([
        { conversationId: FAMILY, clientId: message.id, path: expectedPath, width: 1200, height: 900, body: 'טופי בגינה' },
      ]);
      expect(message).toMatchObject({ delivery: 'sent', body: 'טופי בגינה', attachment: { path: expectedPath, width: 1200, height: 900 } });
      expect(fake.state.notifyCalls).toEqual([message.id]);
      // The sender keeps seeing their own picture without downloading it again.
      expect(getLocalChatImagePreview(expectedPath)).toBe(FAKE_IMAGE.uri);
      expect(conversation(FAMILY)?.lastMessage).toMatchObject({ hasImage: true, preview: 'טופי בגינה' });
    });

    it('the file is named after the message, inside the sender\'s own folder of that conversation', async () => {
      await start();
      store().sendImage(FAKE_IMAGE, '');
      await flush();
      const { id, attachment } = thread(FAMILY).messages[0];
      expect(attachment!.path).toMatch(new RegExp(`^${FAMILY}/user-me/${id}\\.jpg$`));
    });

    it('an image needs no caption, but an over-long caption is refused before uploading', async () => {
      await start();
      expect(store().sendImage(FAKE_IMAGE, '')).toEqual({ ok: true });
      expect(store().sendImage(FAKE_IMAGE, 'א'.repeat(2001))).toEqual({ ok: false, reason: 'too_long' });
      await flush();
      expect(fake.state.uploadCalls).toHaveLength(1);
    });

    it('refuses a file that breaks the size, type or dimension limits without uploading it', async () => {
      await start();
      expect(store().sendImage({ ...FAKE_IMAGE, size: 6 * 1024 * 1024 }, '')).toEqual({ ok: false, reason: 'invalid_image' });
      expect(store().sendImage({ ...FAKE_IMAGE, mime: 'image/gif' }, '')).toEqual({ ok: false, reason: 'invalid_image' });
      expect(store().sendImage({ ...FAKE_IMAGE, width: 5000 }, '')).toEqual({ ok: false, reason: 'invalid_image' });
      await flush();
      expect(fake.state.uploadCalls).toEqual([]);
      expect(thread(FAMILY).messages).toEqual([]);
    });

    it('reports upload progress on the bubble', async () => {
      await start({ manualUploads: true });
      store().sendImage(FAKE_IMAGE, '');
      await flush();
      expect(thread(FAMILY).messages[0]).toMatchObject({ delivery: 'sending', upload: { localUri: FAKE_IMAGE.uri, progress: 0 } });

      fake.state.uploads[0].progress(0.5);
      expect(thread(FAMILY).messages[0].upload?.progress).toBe(0.5);

      fake.state.uploads[0].finish();
      await flush();
      expect(thread(FAMILY).messages[0].delivery).toBe('sent');
      expect(thread(FAMILY).messages[0].upload).toBeUndefined();
    });

    it('cancelling an upload removes the bubble, sends no message and cleans up the file', async () => {
      await start({ manualUploads: true });
      store().sendImage(FAKE_IMAGE, '');
      await flush();
      const { id, attachment } = thread(FAMILY).messages[0];

      store().discard(id);
      await flush();

      expect(fake.state.uploads[0].cancelled).toBe(true);
      expect(thread(FAMILY).messages).toEqual([]);
      expect(fake.state.sendImageCalls).toEqual([]);
      expect(fake.state.notifyCalls).toEqual([]);
      expect(fake.state.removedAttachments).toEqual([attachment!.path]);
      expect(store().sendErrors).toEqual({});
    });

    it('a failed upload stays as an unsent bubble; retry uploads to the SAME path and sends once', async () => {
      await start();
      fake.state.failUploadWith = new Error('Network request failed');
      store().sendImage(FAKE_IMAGE, '');
      await flush();
      const { id, attachment } = thread(FAMILY).messages[0];
      expect(thread(FAMILY).messages[0].delivery).toBe('failed');
      expect(fake.state.sendImageCalls).toEqual([]);

      fake.state.failUploadWith = null;
      store().retry(id);
      await flush();

      expect(fake.state.uploadCalls).toEqual([attachment!.path, attachment!.path]);
      expect(fake.state.sendImageCalls).toHaveLength(1);
      expect(thread(FAMILY).messages).toHaveLength(1);
      expect(thread(FAMILY).messages[0].delivery).toBe('sent');
    });

    it('if the upload succeeded but attaching failed, retry does not upload again', async () => {
      await start();
      fake.state.failSendWith = new Error('Failed to fetch');
      store().sendImage(FAKE_IMAGE, '');
      await flush();
      const { id } = thread(FAMILY).messages[0];
      expect(fake.state.uploadCalls).toHaveLength(1);

      fake.state.failSendWith = null;
      store().retry(id);
      await flush();
      expect(fake.state.uploadCalls).toHaveLength(1);
      expect(fake.state.sendImageCalls).toHaveLength(2);
      expect(fake.state.messages).toHaveLength(1);
    });

    it('discarding a failed image removes its uploaded file so nothing is orphaned', async () => {
      await start();
      fake.state.failSendWith = new Error('chat attachment is not valid');
      store().sendImage(FAKE_IMAGE, '');
      await flush();
      const { id, attachment } = thread(FAMILY).messages[0];
      expect(store().sendErrors[id]).toBe('לא ניתן לצרף את התמונה הזו. נסו לבחור אותה מחדש.');

      store().discard(id);
      expect(fake.state.removedAttachments).toEqual([attachment!.path]);
      expect(thread(FAMILY).messages).toEqual([]);
    });

    it('holds an image chosen offline and sends it when the connection returns', async () => {
      await start();
      store().setOnline(false);
      store().sendImage(FAKE_IMAGE, '');
      await flush();
      expect(fake.state.uploadCalls).toEqual([]);
      expect(thread(FAMILY).messages[0].delivery).toBe('failed');

      store().setOnline(true);
      await flush();
      await flush();
      expect(fake.state.uploadCalls).toHaveLength(1);
      expect(thread(FAMILY).messages[0].delivery).toBe('sent');
    });

    it('removing an image message drops the attachment locally', async () => {
      await start({ conversations: [fakeChatConversation({ canModerate: true })] });
      store().sendImage(FAKE_IMAGE, 'כיתוב');
      await flush();
      const { id } = thread(FAMILY).messages[0];

      await expect(store().remove(id)).resolves.toBe(true);
      expect(thread(FAMILY).messages[0]).toMatchObject({ body: '', deletedAt: expect.any(String) });
      expect(thread(FAMILY).messages[0].attachment).toBeUndefined();
      expect(conversation(FAMILY)?.lastMessage).toMatchObject({ deleted: true, hasImage: false });
    });
  });

  describe('offline and reconnect', () => {
    beforeEach(async () => {
      await store().start('family-a:user-me:self');
      store().openConversation(FAMILY);
      await flush();
    });

    it('holds a message written offline and delivers it once when the connection returns', async () => {
      store().setOnline(false);
      store().send('נשלח כשיחזור החיבור');
      await flush();
      expect(fake.state.sendCalls).toHaveLength(0);
      expect(thread(FAMILY).messages[0].delivery).toBe('failed');

      store().setOnline(true);
      await flush();
      await flush();
      expect(thread(FAMILY).messages).toHaveLength(1);
      expect(thread(FAMILY).messages[0].delivery).toBe('sent');
      expect(fake.state.sendCalls).toHaveLength(1);
      expect(fake.state.messages).toHaveLength(1);
    });

    it('re-syncs messages missed while the live stream was down, without resubscribing', async () => {
      const handlers = fake.activeSubscriptions()[0].handlers;
      handlers.onStatus('reconnecting');
      expect(store().live).toBe('reconnecting');

      fake.state.messages.push(fakeChatMessage({ id: 'missed', createdAt: '2026-10-09T11:00:00.000Z' }));
      handlers.onStatus('live');
      await flush();
      await flush();

      expect(store().live).toBe('live');
      expect(thread(FAMILY).messages.map((m) => m.id)).toEqual(['missed']);
      expect(fake.state.subscriptions).toHaveLength(1);
    });
  });

  describe('unread counters', () => {
    beforeEach(async () => {
      use(withDirect());
      await store().start('family-a:user-me:self');
    });

    it('counts per conversation and in total while nothing is open', () => {
      fake.push(fakeChatMessage({ id: 'f1', createdAt: '2026-10-09T12:30:00.000Z' }));
      fake.push(fakeChatMessage({ id: 'd1', conversationId: DIRECT, senderUserId: 'user-noa', createdAt: '2026-10-09T12:31:00.000Z' }));
      fake.push(fakeChatMessage({ id: 'd2', conversationId: DIRECT, senderUserId: 'user-noa', createdAt: '2026-10-09T12:32:00.000Z' }));

      expect(conversation(FAMILY)?.unreadCount).toBe(1);
      expect(conversation(DIRECT)?.unreadCount).toBe(2);
      expect(store().unreadCount).toBe(3);
      // The most recently active conversation moves to the top.
      expect(store().conversations[0].conversationId).toBe(DIRECT);
    });

    it('does not count the same message twice, nor my own message from another device', () => {
      const incoming = fakeChatMessage({ id: 'n1', createdAt: '2026-10-09T12:30:00.000Z' });
      fake.push(incoming);
      fake.push(incoming);
      fake.push(fakeChatMessage({ id: 'mine', senderUserId: 'user-me', createdAt: '2026-10-09T12:31:00.000Z' }));
      expect(store().unreadCount).toBe(1);
    });

    it('opening a conversation clears ITS badge only and advances its server read marker', async () => {
      fake.push(fakeChatMessage({ id: 'f1', createdAt: '2026-10-09T12:30:00.000Z' }));
      fake.push(fakeChatMessage({ id: 'd1', conversationId: DIRECT, senderUserId: 'user-noa', createdAt: '2026-10-09T12:31:00.000Z' }));
      store().setScreenActive(true);

      store().openConversation(DIRECT);
      expect(store().unreadDividerFrom).toBe('2026-10-09T09:00:00.000Z');
      await flush();
      jest.advanceTimersByTime(500);

      expect(conversation(DIRECT)?.unreadCount).toBe(0);
      expect(conversation(FAMILY)?.unreadCount).toBe(1);
      expect(store().unreadCount).toBe(1);
      expect(fake.state.markReadCalls).toEqual([{ conversationId: DIRECT, readAt: '2026-10-09T12:31:00.000Z' }]);
    });

    it('a message arriving in the open conversation is read; one arriving elsewhere is counted', async () => {
      store().setScreenActive(true);
      store().openConversation(FAMILY);
      await flush();

      fake.push(fakeChatMessage({ id: 'f1', createdAt: '2026-10-09T12:30:00.000Z' }));
      fake.push(fakeChatMessage({ id: 'd1', conversationId: DIRECT, senderUserId: 'user-noa', createdAt: '2026-10-09T12:31:00.000Z' }));

      expect(conversation(FAMILY)?.unreadCount).toBe(0);
      expect(conversation(DIRECT)?.unreadCount).toBe(1);
      jest.advanceTimersByTime(500);
      expect(fake.state.markReadCalls).toEqual([{ conversationId: FAMILY, readAt: '2026-10-09T12:30:00.000Z' }]);
    });

    it('with the app in the background, even the open conversation counts', async () => {
      store().setScreenActive(true);
      store().openConversation(FAMILY);
      await flush();
      store().setScreenActive(false);

      fake.push(fakeChatMessage({ id: 'f1', createdAt: '2026-10-09T12:30:00.000Z' }));
      expect(conversation(FAMILY)?.unreadCount).toBe(1);
    });
  });

  describe('family moderation and mute', () => {
    it('a manager removes a family message and the text is gone locally too', async () => {
      use(createFakeChatTransport({ conversations: [fakeChatConversation({ canModerate: true })] }));
      fake.state.messages.push(fakeChatMessage({ id: 'bad', body: 'משהו לא מתאים' }));
      await store().start('family-a:user-admin:self');
      store().openConversation(FAMILY);
      await flush();

      await expect(store().remove('bad')).resolves.toBe(true);
      expect(thread(FAMILY).messages[0]).toMatchObject({ id: 'bad', body: '', deletedAt: '2026-10-09T13:00:00.000Z' });
    });

    it('a removal made on another device arrives live', async () => {
      fake.state.messages.push(fakeChatMessage({ id: 'bad', body: 'משהו לא מתאים' }));
      await store().start('family-a:user-me:self');
      store().openConversation(FAMILY);
      await flush();
      fake.push(fakeChatMessage({ id: 'bad', body: '', deletedAt: '2026-10-09T13:00:00.000Z' }));
      expect(thread(FAMILY).messages[0]).toMatchObject({ body: '', deletedAt: '2026-10-09T13:00:00.000Z' });
    });

    it('a regular member is refused, and the message is left untouched', async () => {
      fake.state.messages.push(fakeChatMessage({ id: 'm1', body: 'הודעה רגילה' }));
      await store().start('family-a:user-me:self');
      store().openConversation(FAMILY);
      await flush();

      await expect(store().remove('m1')).resolves.toBe(false);
      expect(store().actionError).toBe('רק מנהל/ת יכולים לבצע פעולה זו.');
      expect(thread(FAMILY).messages[0].body).toBe('הודעה רגילה');
    });

    it('mutes the open conversation optimistically and rolls back if the server refuses', async () => {
      await store().start('family-a:user-me:self');
      store().openConversation(FAMILY);
      await flush();
      await store().setMuted(true);
      expect(conversation(FAMILY)?.notificationsMuted).toBe(true);

      fake.transport.setMuted = async () => { throw new Error('boom'); };
      await store().setMuted(false);
      expect(conversation(FAMILY)?.notificationsMuted).toBe(true);
      expect(store().actionError).toBeTruthy();
    });
  });
});
