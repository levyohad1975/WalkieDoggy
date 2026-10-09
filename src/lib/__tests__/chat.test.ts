import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  ChatUnavailableError,
  ChatUploadCancelledError,
  chatConversationFromRow,
  chatMessageFromRow,
  isChatBackendMissing,
  isChatNetworkError,
} from '../chat';
import { createLocalChatTransport } from '../chatLocal';
import { useAuthStore } from '../../store/authStore';
import { useFamilyStore } from '../../store/familyStore';

describe('lib/chat — row mapping and error classification', () => {
  const row = {
    id: 'm1',
    conversation_id: 'c1',
    family_id: 'f1',
    sender_user_id: 'u1',
    body: 'שלום',
    created_at: '2026-10-09T10:00:00+03:00',
    deleted_at: null,
    deleted_by_user_id: null,
  };

  it('maps a server row and normalises the timestamp to UTC ISO (so string ordering is chronological)', () => {
    expect(chatMessageFromRow(row)).toEqual({
      id: 'm1',
      conversationId: 'c1',
      familyId: 'f1',
      senderUserId: 'u1',
      body: 'שלום',
      createdAt: '2026-10-09T07:00:00.000Z',
      deletedAt: undefined,
      deletedByUserId: undefined,
      attachment: undefined,
      delivery: 'sent',
    });
  });

  it('maps an image attachment, and drops it for a removed message', () => {
    const withImage = { ...row, body: '', attachment_path: 'c1/u1/m1.jpg', attachment_mime: 'image/jpeg', attachment_width: 1200, attachment_height: 900, attachment_size: 240000 };
    expect(chatMessageFromRow(withImage).attachment).toEqual({ path: 'c1/u1/m1.jpg', mime: 'image/jpeg', width: 1200, height: 900, size: 240000 });
    expect(chatMessageFromRow({ ...withImage, deleted_at: '2026-10-09T11:00:00Z' }).attachment).toBeUndefined();
  });

  it('maps a conversation row, including a private one and its last-message preview', () => {
    const mapped = chatConversationFromRow({
      conversation_id: 'c2',
      kind: 'direct',
      family_id: 'f1',
      user_id: 'u1',
      other_user_id: 'u2',
      last_read_at: '2026-10-09T10:00:00+03:00',
      notifications_muted: true,
      unread_count: 3,
      can_moderate: false,
      last_activity_at: '2026-10-09T12:00:00+03:00',
      last_message: { id: 'm9', sender_user_id: 'u2', preview: 'היי', has_image: true, deleted: false, created_at: '2026-10-09T12:00:00+03:00' },
    });
    expect(mapped).toMatchObject({
      conversationId: 'c2',
      kind: 'direct',
      otherUserId: 'u2',
      unreadCount: 3,
      notificationsMuted: true,
      canModerate: false,
      lastActivityAt: '2026-10-09T09:00:00.000Z',
      lastMessage: { id: 'm9', senderUserId: 'u2', preview: 'היי', hasImage: true, deleted: false },
    });
  });

  it('treats the Phase 1 open() result (no kind) as the family conversation', () => {
    const mapped = chatConversationFromRow({ conversation_id: 'c1', family_id: 'f1', user_id: 'u1', last_read_at: '2026-10-09T10:00:00Z', unread_count: 0, can_moderate: true });
    expect(mapped).toMatchObject({ kind: 'family', canModerate: true, otherUserId: undefined, lastMessage: undefined });
    expect(() => chatConversationFromRow(null)).toThrow('chat conversation could not be opened');
  });

  it('never shows a preview or an image flag for a removed last message', () => {
    const mapped = chatConversationFromRow({
      conversation_id: 'c1', family_id: 'f1', user_id: 'u1',
      last_message: { id: 'm1', sender_user_id: 'u2', preview: 'left over', has_image: true, deleted: true, created_at: '2026-10-09T12:00:00Z' },
    });
    expect(mapped.lastMessage).toMatchObject({ preview: '', hasImage: false, deleted: true });
  });

  it('never exposes text for a moderated message, even if a stale payload still carries it', () => {
    const mapped = chatMessageFromRow({ ...row, body: 'left over', deleted_at: '2026-10-09T11:00:00Z', deleted_by_user_id: 'admin' });
    expect(mapped.body).toBe('');
    expect(mapped.deletedAt).toBe('2026-10-09T11:00:00.000Z');
    expect(mapped.deletedByUserId).toBe('admin');
  });

  it('tolerates a sender whose profile no longer exists', () => {
    expect(chatMessageFromRow({ ...row, sender_user_id: null }).senderUserId).toBeUndefined();
  });

  it('recognises "migration not applied here" from PostgREST/Postgres codes', () => {
    expect(isChatBackendMissing({ code: 'PGRST202', message: 'Could not find the function' })).toBe(true);
    expect(isChatBackendMissing({ code: 'PGRST205' })).toBe(true);
    expect(isChatBackendMissing({ code: '42P01' })).toBe(true);
    expect(isChatBackendMissing({ code: '42883' })).toBe(true);
    expect(isChatBackendMissing(new ChatUnavailableError())).toBe(true);
    expect(isChatBackendMissing({ code: 'P0001', message: 'chat message is empty' })).toBe(false);
    expect(isChatBackendMissing(null)).toBe(false);
  });

  it('separates retryable network failures from server rejections', () => {
    expect(isChatNetworkError(new TypeError('Failed to fetch'))).toBe(true);
    expect(isChatNetworkError(new Error('Network request failed'))).toBe(true);
    expect(isChatNetworkError(new Error('Load failed'))).toBe(true);
    expect(isChatNetworkError({ message: 'chat messages are being sent too quickly' })).toBe(false);
    expect(isChatNetworkError(new ChatUnavailableError())).toBe(false);
    // A cancelled upload is a choice, not a failure to retry.
    expect(isChatNetworkError(new ChatUploadCancelledError())).toBe(false);
  });
});

describe('lib/chatLocal — demo-mode transport mirrors the server contract', () => {
  const signInAs = (userId: string, role: 'admin' | 'member' = 'member') =>
    useAuthStore.setState({ currentUserId: userId, familyId: 'family-main', familyRole: role });
  const member = (id: string, removedAt?: string) =>
    ({ id, familyId: 'family-main', name: id, avatar: '🙂', color: '#000000', remindersEnabled: true, gamificationEnabled: true, createdAt: '2026-01-01T00:00:00.000Z', removedAt });
  const image = { uri: 'blob:x', mime: 'image/jpeg', width: 800, height: 600, size: 1000 };

  beforeEach(async () => {
    await AsyncStorage.clear();
    useFamilyStore.setState({ users: [member('user-aba'), member('user-ima'), member('user-noa'), member('user-gone', '2026-09-01T00:00:00.000Z')] });
    signInAs('user-aba', 'admin');
  });

  const familyOf = async (chat: ReturnType<typeof createLocalChatTransport>) =>
    (await chat.listConversations()).conversations.find((c) => c.kind === 'family')!;

  it('has one family conversation and starts empty', async () => {
    const chat = createLocalChatTransport();
    const listing = await chat.listConversations();
    expect(listing.capabilities).toEqual({ privateConversations: true, images: true });
    expect(listing.conversations).toHaveLength(1);
    expect(listing.conversations[0]).toMatchObject({ kind: 'family', familyId: 'family-main', userId: 'user-aba', unreadCount: 0, canModerate: true });
    expect((await familyOf(chat)).conversationId).toBe(listing.conversations[0].conversationId);
    expect(await chat.listMessages(listing.conversations[0].conversationId, { limit: 40 })).toEqual([]);
  });

  it('stamps the signed-in profile as sender and treats the message id as idempotent', async () => {
    const chat = createLocalChatTransport();
    const { conversationId } = await familyOf(chat);
    const first = await chat.send(conversationId, 'id-1', 'שלום');
    const again = await chat.send(conversationId, 'id-1', 'something else');
    expect(first.senderUserId).toBe('user-aba');
    expect(again).toEqual(first);
    expect(await chat.listMessages(conversationId, { limit: 40 })).toHaveLength(1);
  });

  it('refuses to reuse another profile\'s message id, and validates content', async () => {
    const chat = createLocalChatTransport();
    const { conversationId } = await familyOf(chat);
    await chat.send(conversationId, 'id-1', 'שלום');
    await expect(chat.send(conversationId, 'e', '   ')).rejects.toThrow('chat message is empty');
    await expect(chat.send(conversationId, 'l', 'א'.repeat(2001))).rejects.toThrow('chat message is too long');
    signInAs('user-ima');
    await expect(chat.send(conversationId, 'id-1', 'אחר')).rejects.toThrow('chat message id conflict');
  });

  it('tracks unread per profile and clears it on markRead', async () => {
    const chat = createLocalChatTransport();
    signInAs('user-ima');
    const { conversationId } = await familyOf(chat);
    await new Promise((resolve) => setTimeout(resolve, 5));

    signInAs('user-aba', 'admin');
    const sent = await chat.send(conversationId, 'id-1', 'מי בבית?');

    signInAs('user-ima');
    expect((await familyOf(chat)).unreadCount).toBe(1);
    expect(await chat.markRead(conversationId, sent.createdAt)).toBe(0);
    expect((await familyOf(chat)).unreadCount).toBe(0);
  });

  it('only an admin can remove a family message, and removal erases the text', async () => {
    const chat = createLocalChatTransport();
    const { conversationId } = await familyOf(chat);
    await chat.send(conversationId, 'id-1', 'הודעה');

    signInAs('user-ima', 'member');
    await expect(chat.remove('id-1')).rejects.toThrow('admin permission required');

    signInAs('user-aba', 'admin');
    const removed = await chat.remove('id-1');
    expect(removed).toMatchObject({ body: '', deletedByUserId: 'user-aba' });
    expect(removed.deletedAt).toBeTruthy();
  });

  it('delivers to subscribers and stops after unsubscribe', async () => {
    const chat = createLocalChatTransport();
    const { conversationId } = await familyOf(chat);
    const onMessage = jest.fn();
    const onStatus = jest.fn();
    const unsubscribe = chat.subscribe({ onMessage, onStatus });
    expect(onStatus).toHaveBeenCalledWith('live');

    await chat.send(conversationId, 'id-1', 'אחת');
    unsubscribe();
    await chat.send(conversationId, 'id-2', 'שתיים');
    expect(onMessage).toHaveBeenCalledTimes(1);
  });

  describe('private conversations', () => {
    it('one conversation per pair, whichever side opens it', async () => {
      const chat = createLocalChatTransport();
      signInAs('user-ima');
      const fromIma = await chat.openDirect('user-noa');
      signInAs('user-noa');
      const fromNoa = await chat.openDirect('user-ima');
      expect(fromNoa.conversationId).toBe(fromIma.conversationId);
      expect(fromIma).toMatchObject({ kind: 'direct', otherUserId: 'user-noa', canModerate: false });
      expect(fromNoa.otherUserId).toBe('user-ima');
    });

    it('cannot be opened with myself, a removed member or someone outside the family', async () => {
      const chat = createLocalChatTransport();
      await expect(chat.openDirect('user-aba')).rejects.toThrow('choose another family member');
      await expect(chat.openDirect('user-gone')).rejects.toThrow('chat member not found');
      await expect(chat.openDirect('user-of-another-family')).rejects.toThrow('chat member not found');
    });

    it('is invisible and closed to everyone else — including the family admin', async () => {
      const chat = createLocalChatTransport();
      signInAs('user-ima');
      const { conversationId } = await chat.openDirect('user-noa');
      await chat.send(conversationId, 'p-1', 'רק בינינו');

      signInAs('user-aba', 'admin');
      expect((await chat.listConversations()).conversations.map((c) => c.kind)).toEqual(['family']);
      expect(await chat.listMessages(conversationId, { limit: 40 })).toEqual([]);
      await expect(chat.send(conversationId, 'p-2', 'מנהל')).rejects.toThrow('chat conversation not found');
      await expect(chat.remove('p-1')).rejects.toThrow('chat message not found');
      await expect(chat.markRead(conversationId, new Date().toISOString())).rejects.toThrow('chat conversation not found');
    });

    it('is listed for the recipient only once it has a message; only the sender can remove a message', async () => {
      const chat = createLocalChatTransport();
      signInAs('user-ima');
      const { conversationId } = await chat.openDirect('user-noa');

      signInAs('user-noa');
      expect((await chat.listConversations()).conversations).toHaveLength(1);

      signInAs('user-ima');
      await new Promise((resolve) => setTimeout(resolve, 5));
      await chat.send(conversationId, 'p-1', 'היי');

      signInAs('user-noa');
      const listed = (await chat.listConversations()).conversations.find((c) => c.kind === 'direct');
      expect(listed).toMatchObject({ conversationId, unreadCount: 1, lastMessage: { preview: 'היי' } });
      await expect(chat.remove('p-1')).rejects.toThrow('only the sender can remove this message');

      signInAs('user-ima');
      expect((await chat.remove('p-1')).deletedAt).toBeTruthy();
    });
  });

  describe('images', () => {
    it('an image must be uploaded before it can be attached, and removal forgets the file', async () => {
      const chat = createLocalChatTransport();
      const { conversationId } = await familyOf(chat);
      const path = `${conversationId}/user-aba/img-1.jpg`;
      await expect(chat.sendImage(conversationId, 'img-1', { path, width: 800, height: 600 }, '')).rejects.toThrow('chat attachment was not uploaded');

      const progress = jest.fn();
      await chat.uploadAttachment(path, image, progress).promise;
      expect(progress).toHaveBeenLastCalledWith(1);

      const sent = await chat.sendImage(conversationId, 'img-1', { path, width: 800, height: 600 }, '');
      expect(sent).toMatchObject({ body: '', attachment: { path, mime: 'image/jpeg', width: 800, height: 600 } });
      await expect(chat.getAttachmentUrl(path)).resolves.toBe('blob:x');

      await chat.remove('img-1');
      await expect(chat.getAttachmentUrl(path)).rejects.toThrow('chat image is not available');
    });

    it('a cancelled upload stores nothing', async () => {
      const chat = createLocalChatTransport();
      const { conversationId } = await familyOf(chat);
      const path = `${conversationId}/user-aba/img-2.jpg`;
      const handle = chat.uploadAttachment(path, image, () => undefined);
      handle.cancel();
      await expect(handle.promise).rejects.toBeInstanceOf(ChatUploadCancelledError);
      await expect(chat.getAttachmentUrl(path)).rejects.toThrow('chat image is not available');
    });
  });
});
