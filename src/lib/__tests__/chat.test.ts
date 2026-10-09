import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  ChatUnavailableError,
  chatMessageFromRow,
  isChatBackendMissing,
  isChatNetworkError,
} from '../chat';
import { createLocalChatTransport } from '../chatLocal';
import { useAuthStore } from '../../store/authStore';

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
      delivery: 'sent',
    });
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
  });
});

describe('lib/chatLocal — demo-mode transport mirrors the server contract', () => {
  const signInAs = (userId: string, role: 'admin' | 'member' = 'member') =>
    useAuthStore.setState({ currentUserId: userId, familyId: 'family-main', familyRole: role });

  beforeEach(async () => {
    await AsyncStorage.clear();
    signInAs('user-aba', 'admin');
  });

  it('has one conversation per family and starts empty', async () => {
    const chat = createLocalChatTransport();
    const conversation = await chat.open();
    expect(conversation).toMatchObject({ familyId: 'family-main', userId: 'user-aba', unreadCount: 0, canModerate: true });
    expect((await chat.open()).conversationId).toBe(conversation.conversationId);
    expect(await chat.listMessages(conversation.conversationId, { limit: 40 })).toEqual([]);
  });

  it('stamps the signed-in profile as sender and treats the message id as idempotent', async () => {
    const chat = createLocalChatTransport();
    const { conversationId } = await chat.open();
    const first = await chat.send(conversationId, 'id-1', 'שלום');
    const again = await chat.send(conversationId, 'id-1', 'something else');
    expect(first.senderUserId).toBe('user-aba');
    expect(again).toEqual(first);
    expect(await chat.listMessages(conversationId, { limit: 40 })).toHaveLength(1);
  });

  it('refuses to reuse another profile\'s message id', async () => {
    const chat = createLocalChatTransport();
    const { conversationId } = await chat.open();
    await chat.send(conversationId, 'id-1', 'שלום');
    signInAs('user-ima');
    await expect(chat.send(conversationId, 'id-1', 'אחר')).rejects.toThrow('chat message id conflict');
  });

  it('validates content', async () => {
    const chat = createLocalChatTransport();
    const { conversationId } = await chat.open();
    await expect(chat.send(conversationId, 'e', '   ')).rejects.toThrow('chat message is empty');
    await expect(chat.send(conversationId, 'l', 'א'.repeat(2001))).rejects.toThrow('chat message is too long');
  });

  it('tracks unread per profile and clears it on markRead', async () => {
    const chat = createLocalChatTransport();
    signInAs('user-ima');
    const { conversationId } = await chat.open();
    await new Promise((resolve) => setTimeout(resolve, 5));

    signInAs('user-aba', 'admin');
    const sent = await chat.send(conversationId, 'id-1', 'מי בבית?');

    signInAs('user-ima');
    expect((await chat.open()).unreadCount).toBe(1);
    expect(await chat.markRead(conversationId, sent.createdAt)).toBe(0);
    expect((await chat.open()).unreadCount).toBe(0);
  });

  it('only an admin can remove a message, and removal erases the text', async () => {
    const chat = createLocalChatTransport();
    const { conversationId } = await chat.open();
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
    const { conversationId } = await chat.open();
    const onMessage = jest.fn();
    const onStatus = jest.fn();
    const unsubscribe = chat.subscribe(conversationId, { onMessage, onStatus });
    expect(onStatus).toHaveBeenCalledWith('live');

    await chat.send(conversationId, 'id-1', 'אחת');
    unsubscribe();
    await chat.send(conversationId, 'id-2', 'שתיים');
    expect(onMessage).toHaveBeenCalledTimes(1);
  });
});
