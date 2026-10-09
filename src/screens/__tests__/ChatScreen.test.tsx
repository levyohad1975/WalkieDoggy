import React from 'react';
import { StyleSheet } from 'react-native';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

// The screen is rendered on its own here; the two navigation hooks it uses
// are replaced by minimal equivalents (focus == mounted).
jest.mock('@react-navigation/native', () => {
  const ReactActual = require('react');
  return { useFocusEffect: (effect: () => void | (() => void)) => ReactActual.useEffect(effect, [effect]) };
});
jest.mock('@react-navigation/bottom-tabs', () => ({ useBottomTabBarHeight: () => 56 }));

import { ChatScreen } from '../ChatScreen';
import { useAuthStore } from '../../store/authStore';
import { useFamilyStore } from '../../store/familyStore';
import { __resetChatStoreForTests, useChatStore } from '../../store/chatStore';
import { __setChatTransportForTests, ChatUnavailableError, type ChatSubscriptionHandlers, type ChatTransport } from '../../lib/chat';
import type { ChatMessage, FamilyUser } from '../../types';

const USERS: FamilyUser[] = [
  { id: 'user-aba', familyId: 'family-main', name: 'אבא', avatar: '👨', color: '#5B8DEF', remindersEnabled: true, gamificationEnabled: true, createdAt: '2026-01-01T00:00:00.000Z' },
  { id: 'user-ima', familyId: 'family-main', name: 'אמא', avatar: '👩', color: '#F2994A', remindersEnabled: true, gamificationEnabled: true, createdAt: '2026-01-01T00:00:00.000Z' },
  { id: 'user-noa', familyId: 'family-main', name: 'נועה', avatar: '👧', color: '#BB6BD9', remindersEnabled: true, gamificationEnabled: true, createdAt: '2026-01-01T00:00:00.000Z' },
];

function msg(overrides: Partial<ChatMessage> & { id: string }): ChatMessage {
  return {
    conversationId: 'conv-1',
    familyId: 'family-main',
    senderUserId: 'user-ima',
    body: 'שלום',
    createdAt: new Date(2026, 9, 9, 10, 0).toISOString(),
    delivery: 'sent',
    ...overrides,
  };
}

function createTransport(options: { messages?: ChatMessage[]; canModerate?: boolean; openError?: Error } = {}) {
  const stored = [...(options.messages ?? [])];
  const handlers: ChatSubscriptionHandlers[] = [];
  const calls = { send: [] as Array<{ clientId: string; body: string }>, remove: [] as string[], muted: [] as boolean[] };
  let clock = Date.parse('2026-10-09T18:00:00.000Z');
  const transport: ChatTransport = {
    open: async () => {
      if (options.openError) throw options.openError;
      return {
        conversationId: 'conv-1',
        familyId: 'family-main',
        userId: 'user-aba',
        lastReadAt: '2026-10-09T05:00:00.000Z',
        notificationsMuted: false,
        unreadCount: 0,
        canModerate: options.canModerate ?? false,
      };
    },
    listMessages: async () => [...stored],
    send: async (conversationId, clientId, body) => {
      calls.send.push({ clientId, body });
      clock += 1000;
      const confirmed = msg({ id: clientId, conversationId, senderUserId: 'user-aba', body, createdAt: new Date(clock).toISOString() });
      stored.push(confirmed);
      return confirmed;
    },
    remove: async (messageId) => {
      calls.remove.push(messageId);
      const index = stored.findIndex((m) => m.id === messageId);
      stored[index] = { ...stored[index], body: '', deletedAt: '2026-10-09T19:00:00.000Z', deletedByUserId: 'user-aba' };
      return stored[index];
    },
    markRead: async () => 0,
    setMuted: async (_id, muted) => { calls.muted.push(muted); return muted; },
    subscribe: (_id, h) => { handlers.push(h); h.onStatus('live'); return () => undefined; },
    notify: async () => undefined,
  };
  return { transport, calls, handlers };
}

async function renderChat(transport: ChatTransport) {
  __setChatTransportForTests(transport);
  const view = render(
    <SafeAreaProvider initialMetrics={{ frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 47, left: 0, right: 0, bottom: 34 } }}>
      <ChatScreen />
    </SafeAreaProvider>
  );
  await act(async () => {
    await useChatStore.getState().start('family-main:user-aba:self');
  });
  return view;
}

describe('ChatScreen', () => {
  beforeEach(() => {
    __resetChatStoreForTests();
    useAuthStore.setState({
      currentUserId: 'user-aba',
      familyId: 'family-main',
      familyRole: 'member',
      impersonatingUserId: null,
      testModeUserId: null,
      systemObserverActive: false,
    });
    useFamilyStore.setState({ users: USERS });
  });

  afterEach(() => {
    // Unmount first so resetting the store is not a state update on a
    // mounted tree.
    cleanup();
    __resetChatStoreForTests();
    __setChatTransportForTests(null);
  });

  it('shows a loading state before the conversation is ready', () => {
    __setChatTransportForTests(createTransport().transport);
    render(
      <SafeAreaProvider initialMetrics={{ frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 47, left: 0, right: 0, bottom: 34 } }}>
        <ChatScreen />
      </SafeAreaProvider>
    );
    expect(screen.getByLabelText('טוען…')).toBeTruthy();
    expect(screen.queryByLabelText('הודעה חדשה לצ׳אט המשפחתי')).toBeNull();
  });

  it('shows the empty state and a working composer for a brand-new conversation', async () => {
    await renderChat(createTransport().transport);
    expect(screen.getByText('עדיין אין הודעות')).toBeTruthy();
    expect(screen.getByLabelText('הודעה חדשה לצ׳אט המשפחתי')).toBeTruthy();
    expect(screen.getByText('פרטי למשפחה בלבד · 3 בני משפחה')).toBeTruthy();
  });

  it('renders sender name, message text and time for another member, and no name on my own message', async () => {
    await renderChat(
      createTransport({
        messages: [
          msg({ id: 'm1', senderUserId: 'user-ima', body: 'מי מוציא את טופי הערב?', createdAt: new Date(2026, 9, 9, 17, 5).toISOString() }),
          msg({ id: 'm2', senderUserId: 'user-aba', body: 'אני', createdAt: new Date(2026, 9, 9, 17, 6).toISOString() }),
        ],
      }).transport
    );
    expect(screen.getByText('אמא')).toBeTruthy();
    expect(screen.getByText('מי מוציא את טופי הערב?')).toBeTruthy();
    expect(screen.getByText('17:05')).toBeTruthy();
    expect(screen.getByText('אני')).toBeTruthy();
    expect(screen.queryByText('אבא')).toBeNull();
    expect(screen.getByLabelText('אמא: מי מוציא את טופי הערב?. 17:05')).toBeTruthy();
  });

  it('lays out a Hebrew message right-to-left and an English message left-to-right', async () => {
    await renderChat(
      createTransport({
        messages: [
          msg({ id: 'he', body: 'יצאנו לטיול ארוך' }),
          msg({ id: 'en', senderUserId: 'user-noa', body: 'Back in 20 minutes', createdAt: new Date(2026, 9, 9, 10, 1).toISOString() }),
        ],
      }).transport
    );
    const hebrew = StyleSheet.flatten(screen.getByText('יצאנו לטיול ארוך').props.style);
    const english = StyleSheet.flatten(screen.getByText('Back in 20 minutes').props.style);
    expect(hebrew).toMatchObject({ writingDirection: 'rtl', textAlign: 'right' });
    expect(english).toMatchObject({ writingDirection: 'ltr', textAlign: 'left' });
  });

  it('sends a message once, clears the field, and a second tap sends nothing', async () => {
    const fake = createTransport();
    await renderChat(fake.transport);
    const input = screen.getByLabelText('הודעה חדשה לצ׳אט המשפחתי');
    const sendButton = screen.getByLabelText('שליחת ההודעה');

    fireEvent.changeText(input, 'חזרתי מהטיול');
    await act(async () => {
      fireEvent.press(sendButton);
      fireEvent.press(sendButton);
    });

    await waitFor(() => expect(fake.calls.send).toHaveLength(1));
    expect(fake.calls.send[0].body).toBe('חזרתי מהטיול');
    expect(screen.getByLabelText('הודעה חדשה לצ׳אט המשפחתי').props.value).toBe('');
    expect(screen.getAllByText('חזרתי מהטיול')).toHaveLength(1);
  });

  it('disables sending for an empty or whitespace-only draft', async () => {
    const fake = createTransport();
    await renderChat(fake.transport);
    const sendButton = screen.getByLabelText('שליחת ההודעה');
    expect(sendButton.props.accessibilityState).toMatchObject({ disabled: true });

    fireEvent.changeText(screen.getByLabelText('הודעה חדשה לצ׳אט המשפחתי'), '    ');
    await act(async () => { fireEvent.press(screen.getByLabelText('שליחת ההודעה')); });
    expect(fake.calls.send).toHaveLength(0);
  });

  it('explains the length limit and blocks an over-long message', async () => {
    const fake = createTransport();
    await renderChat(fake.transport);
    fireEvent.changeText(screen.getByLabelText('הודעה חדשה לצ׳אט המשפחתי'), 'א'.repeat(2001));

    expect(screen.getByText('ההודעה ארוכה מדי: 2,001 מתוך 2,000 תווים')).toBeTruthy();
    await act(async () => { fireEvent.press(screen.getByLabelText('שליחת ההודעה')); });
    expect(fake.calls.send).toHaveLength(0);
  });

  it('a regular member gets no moderation controls', async () => {
    await renderChat(createTransport({ messages: [msg({ id: 'm1', body: 'הודעה רגילה' })] }).transport);
    expect(screen.queryByAccessibilityHint('הקשה מציגה אפשרויות ניהול להודעה')).toBeNull();
    expect(screen.queryByText('מחיקת ההודעה')).toBeNull();
  });

  it('a manager can remove a message after confirming, and everyone then sees it as removed', async () => {
    const fake = createTransport({ canModerate: true, messages: [msg({ id: 'bad', body: 'משהו לא מתאים' })] });
    await renderChat(fake.transport);

    fireEvent.press(screen.getByLabelText('אמא: משהו לא מתאים. 10:00'));
    fireEvent.press(screen.getByLabelText('מחיקת ההודעה לכל בני המשפחה'));
    // Nothing is deleted until the confirmation.
    expect(fake.calls.remove).toEqual([]);
    expect(screen.getByText('למחוק את ההודעה?')).toBeTruthy();

    await act(async () => { fireEvent.press(screen.getByText('מחיקה')); });

    await waitFor(() => expect(fake.calls.remove).toEqual(['bad']));
    expect(screen.queryByText('משהו לא מתאים')).toBeNull();
    expect(screen.getByText('ההודעה הוסרה על ידי מנהל/ת')).toBeTruthy();
  });

  it('shows a message that arrives live from another device', async () => {
    const fake = createTransport();
    await renderChat(fake.transport);
    act(() => {
      fake.handlers[0].onMessage(msg({ id: 'live', senderUserId: 'user-noa', body: 'אני בדרך הביתה' }));
    });
    expect(screen.getByText('אני בדרך הביתה')).toBeTruthy();
    expect(screen.getByText('נועה')).toBeTruthy();
    expect(screen.queryByText('עדיין אין הודעות')).toBeNull();
  });

  it('shows an offline banner and keeps what was written as an unsent message with retry', async () => {
    const fake = createTransport();
    await renderChat(fake.transport);
    act(() => { useChatStore.getState().setOnline(false); });
    expect(screen.getByText('אין חיבור לאינטרנט. הודעות שתכתבו יישלחו כשהחיבור יחזור.')).toBeTruthy();

    fireEvent.changeText(screen.getByLabelText('הודעה חדשה לצ׳אט המשפחתי'), 'אשלח אחר כך');
    await act(async () => { fireEvent.press(screen.getByLabelText('שליחת ההודעה')); });

    expect(fake.calls.send).toHaveLength(0);
    expect(screen.getByText('אשלח אחר כך')).toBeTruthy();
    expect(screen.getByText('לא נשלח')).toBeTruthy();
    expect(screen.getByLabelText('שליחה חוזרת של ההודעה')).toBeTruthy();

    await act(async () => { useChatStore.getState().setOnline(true); });
    await waitFor(() => expect(fake.calls.send).toHaveLength(1));
    await waitFor(() => expect(screen.queryByText('לא נשלח')).toBeNull());
  });

  it('shows a reconnecting notice while the live stream is down', async () => {
    const fake = createTransport();
    await renderChat(fake.transport);
    expect(screen.queryByText('מתחברים מחדש לעדכונים חיים…')).toBeNull();
    act(() => { fake.handlers[0].onStatus('reconnecting'); });
    expect(screen.getByText('מתחברים מחדש לעדכונים חיים…')).toBeTruthy();
  });

  it('shows a retryable error state when loading fails', async () => {
    await renderChat(createTransport({ openError: new Error('boom') }).transport);
    expect(screen.getByText('לא הצלחנו לטעון את הצ׳אט')).toBeTruthy();
    expect(screen.getByText('נסו שוב')).toBeTruthy();
    expect(screen.queryByLabelText('הודעה חדשה לצ׳אט המשפחתי')).toBeNull();
  });

  it('explains calmly when the chat backend is not enabled on this environment', async () => {
    await renderChat(createTransport({ openError: new ChatUnavailableError() }).transport);
    expect(screen.getByText('הצ׳אט המשפחתי עוד לא הופעל כאן')).toBeTruthy();
    expect(screen.queryByLabelText('הודעה חדשה לצ׳אט המשפחתי')).toBeNull();
  });

  it('is read-only while an admin is impersonating another member', async () => {
    useAuthStore.setState({ impersonatingUserId: 'user-noa' });
    await renderChat(createTransport({ messages: [msg({ id: 'm1', body: 'הודעה' })] }).transport);
    expect(screen.getByText('בזמן התחזות לבן משפחה אחר הצ׳אט מוצג בשמכם ולקריאה בלבד.')).toBeTruthy();
    expect(screen.queryByLabelText('הודעה חדשה לצ׳אט המשפחתי')).toBeNull();
    expect(screen.getByText('הודעה')).toBeTruthy();
  });

  it('is closed to the System Admin hidden observer', () => {
    useAuthStore.setState({ systemObserverActive: true });
    __setChatTransportForTests(createTransport({ messages: [msg({ id: 'm1', body: 'פרטי' })] }).transport);
    render(
      <SafeAreaProvider initialMetrics={{ frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 47, left: 0, right: 0, bottom: 34 } }}>
        <ChatScreen />
      </SafeAreaProvider>
    );
    expect(screen.getByText('הצ׳אט המשפחתי פרטי')).toBeTruthy();
    expect(screen.queryByText('פרטי')).toBeNull();
    expect(screen.queryByLabelText('הודעה חדשה לצ׳אט המשפחתי')).toBeNull();
  });
});
