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

const mockPickChatImage = jest.fn();
jest.mock('../../lib/chatImages', () => {
  const actual = jest.requireActual('../../lib/chatImages');
  return { ...actual, pickChatImage: (...args: unknown[]) => mockPickChatImage(...args) };
});

import { ChatScreen } from '../ChatScreen';
import { useAuthStore } from '../../store/authStore';
import { useFamilyStore } from '../../store/familyStore';
import { __resetChatStoreForTests, useChatStore } from '../../store/chatStore';
import { __setChatTransportForTests, ChatUnavailableError } from '../../lib/chat';
import {
  FAKE_IMAGE,
  createFakeChatTransport,
  fakeChatConversation,
  fakeChatMessage,
} from '../../testUtils/fakeChatTransport';
import type { ChatMessage, FamilyUser } from '../../types';

const FAMILY = 'conv-family';
const DIRECT = 'conv-direct-noa';

const member = (id: string, name: string, avatar: string, removedAt?: string): FamilyUser => ({
  id,
  familyId: 'family-main',
  name,
  avatar,
  color: '#5B8DEF',
  remindersEnabled: true,
  gamificationEnabled: true,
  createdAt: '2026-01-01T00:00:00.000Z',
  removedAt,
});
const USERS: FamilyUser[] = [member('user-aba', 'אבא', '👨'), member('user-ima', 'אמא', '👩'), member('user-noa', 'נועה', '👧')];

const msg = (overrides: Partial<ChatMessage> & { id: string }): ChatMessage =>
  fakeChatMessage({ familyId: 'family-main', senderUserId: 'user-ima', createdAt: new Date(2026, 9, 9, 10, 0).toISOString(), ...overrides });

const direct = (overrides = {}) =>
  fakeChatConversation({ conversationId: DIRECT, kind: 'direct', otherUserId: 'user-noa', lastActivityAt: '2026-10-09T08:00:00.000Z', ...overrides });

type Fake = ReturnType<typeof createFakeChatTransport>;

function createFake(options: { messages?: ChatMessage[]; canModerate?: boolean; withDirect?: boolean; capabilities?: { privateConversations: boolean; images: boolean } } = {}): Fake {
  const conversations = [fakeChatConversation({ familyId: 'family-main', canModerate: options.canModerate ?? false })];
  if (options.withDirect) conversations.push(direct({ familyId: 'family-main' }));
  const fake = createFakeChatTransport({ userId: 'user-aba', conversations, capabilities: options.capabilities });
  (options.messages ?? []).forEach((m) => fake.state.messages.push(m));
  return fake;
}

const INSETS = { frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 47, left: 0, right: 0, bottom: 34 } };

function mount() {
  return render(
    <SafeAreaProvider initialMetrics={INSETS}>
      <ChatScreen />
    </SafeAreaProvider>
  );
}

async function renderChats(fake: Fake) {
  __setChatTransportForTests(fake.transport);
  const view = mount();
  await act(async () => {
    await useChatStore.getState().start('family-main:user-aba:self');
  });
  return view;
}

/** Renders the Chats list and opens one conversation, as a tap on its row does. */
async function renderThread(fake: Fake, conversationId = FAMILY) {
  const view = await renderChats(fake);
  await act(async () => {
    useChatStore.getState().openConversation(conversationId);
  });
  await waitFor(() => expect(useChatStore.getState().threads[conversationId]?.status).toBe('ready'));
  return view;
}

const FAMILY_INPUT = 'הודעה חדשה לצ׳אט המשפחתי';

describe('ChatScreen', () => {
  beforeEach(() => {
    __resetChatStoreForTests();
    mockPickChatImage.mockReset();
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
    // Unmount first so resetting the store is not a state update on a mounted tree.
    cleanup();
    __resetChatStoreForTests();
    __setChatTransportForTests(null);
  });

  describe('Chats list', () => {
    it('shows a loading state before the list is ready', () => {
      __setChatTransportForTests(createFake().transport);
      mount();
      expect(screen.getByLabelText('טוען…')).toBeTruthy();
    });

    it('lists the family conversation and private conversations with preview, time and unread badge', async () => {
      const fake = createFake({ withDirect: true });
      fake.state.conversations[0] = {
        ...fake.state.conversations[0],
        unreadCount: 2,
        lastActivityAt: new Date(2026, 9, 9, 17, 5).toISOString(),
        lastMessage: { id: 'm1', senderUserId: 'user-ima', preview: 'מי מוציא את טופי?', hasImage: false, deleted: false, createdAt: new Date().toISOString() },
      };
      fake.state.conversations[1] = {
        ...fake.state.conversations[1],
        lastMessage: { id: 'm2', senderUserId: 'user-aba', preview: '', hasImage: true, deleted: false, createdAt: new Date().toISOString() },
      };
      await renderChats(fake);

      expect(screen.getByText('צ׳אטים')).toBeTruthy();
      expect(screen.getByText('הצ׳אט המשפחתי')).toBeTruthy();
      expect(screen.getByText('אמא: מי מוציא את טופי?')).toBeTruthy();
      expect(screen.getByText('2')).toBeTruthy();
      // The private conversation is named after the other person and marked private.
      expect(screen.getByText('נועה')).toBeTruthy();
      expect(screen.getByText('פרטי')).toBeTruthy();
      expect(screen.getByText('את/ה: 📷 תמונה')).toBeTruthy();
      expect(screen.getByLabelText(/^שיחה פרטית עם נועה/)).toBeTruthy();
      expect(screen.getByLabelText(/^הצ׳אט המשפחתי, כל המשפחה\. 2 הודעות שלא נקראו/)).toBeTruthy();
      // No conversation is open, so there is no composer yet.
      expect(screen.queryByLabelText(FAMILY_INPUT)).toBeNull();
    });

    it('opens a conversation on tap and returns to the list with the back control', async () => {
      await renderChats(createFake({ messages: [msg({ id: 'm1', body: 'בוקר טוב' })] }));

      fireEvent.press(screen.getByLabelText(/^הצ׳אט המשפחתי, כל המשפחה/));
      await waitFor(() => expect(screen.getByText('בוקר טוב')).toBeTruthy());
      expect(screen.getByLabelText(FAMILY_INPUT)).toBeTruthy();

      fireEvent.press(screen.getByLabelText('חזרה לרשימת הצ׳אטים'));
      expect(screen.getByText('צ׳אטים')).toBeTruthy();
      expect(screen.queryByText('בוקר טוב')).toBeNull();
    });

    it('starts a private conversation by choosing another family member — never myself', async () => {
      const fake = createFake();
      await renderChats(fake);

      fireEvent.press(screen.getByLabelText('שיחה פרטית חדשה'));
      expect(screen.getByText('שיחה פרטית עם…')).toBeTruthy();
      expect(screen.queryByText('אבא')).toBeNull();

      await act(async () => {
        fireEvent.press(screen.getByText('נועה'));
      });

      await waitFor(() => expect(fake.state.openDirectCalls).toEqual(['user-noa']));
      await waitFor(() => expect(screen.getByText('שיחה פרטית · רק שניכם רואים אותה')).toBeTruthy());
      expect(screen.getByLabelText('הודעה פרטית חדשה לנועה')).toBeTruthy();
    });

    it('offers neither private chats nor images where the backend only supports the family chat', async () => {
      const fake = createFake({ capabilities: { privateConversations: false, images: false } });
      await renderThread(fake);
      expect(screen.queryByLabelText('צירוף תמונה')).toBeNull();
      fireEvent.press(screen.getByLabelText('חזרה לרשימת הצ׳אטים'));
      expect(screen.queryByLabelText('שיחה פרטית חדשה')).toBeNull();
    });

    it('shows a retryable error state when loading fails', async () => {
      const fake = createFake();
      fake.state.failListWith = new Error('boom');
      await renderChats(fake);
      expect(screen.getByText('לא הצלחנו לטעון את הצ׳אט')).toBeTruthy();
      expect(screen.getByText('נסו שוב')).toBeTruthy();
    });

    it('explains calmly when the chat backend is not enabled on this environment', async () => {
      const fake = createFake();
      fake.state.failListWith = new ChatUnavailableError();
      await renderChats(fake);
      expect(screen.getByText('הצ׳אט המשפחתי עוד לא הופעל כאן')).toBeTruthy();
    });

    it('is closed to the System Admin hidden observer', () => {
      useAuthStore.setState({ systemObserverActive: true });
      __setChatTransportForTests(createFake({ messages: [msg({ id: 'm1', body: 'פרטי' })] }).transport);
      mount();
      expect(screen.getByText('הצ׳אט המשפחתי פרטי')).toBeTruthy();
      expect(screen.queryByText('פרטי')).toBeNull();
    });
  });

  describe('family conversation (unchanged behaviour)', () => {
    it('shows the empty state and a working composer for a brand-new conversation', async () => {
      await renderThread(createFake());
      expect(screen.getByText('עדיין אין הודעות')).toBeTruthy();
      expect(screen.getByLabelText(FAMILY_INPUT)).toBeTruthy();
      expect(screen.getByText('פרטי למשפחה בלבד · 3 בני משפחה')).toBeTruthy();
    });

    it('renders sender name, message text and time for another member, and no name on my own message', async () => {
      await renderThread(
        createFake({
          messages: [
            msg({ id: 'm1', senderUserId: 'user-ima', body: 'מי מוציא את טופי הערב?', createdAt: new Date(2026, 9, 9, 17, 5).toISOString() }),
            msg({ id: 'm2', senderUserId: 'user-aba', body: 'אני', createdAt: new Date(2026, 9, 9, 17, 6).toISOString() }),
          ],
        })
      );
      expect(screen.getByText('אמא')).toBeTruthy();
      expect(screen.getByText('מי מוציא את טופי הערב?')).toBeTruthy();
      expect(screen.getByText('17:05')).toBeTruthy();
      expect(screen.getByText('אני')).toBeTruthy();
      expect(screen.queryByText('אבא')).toBeNull();
      expect(screen.getByLabelText('אמא: מי מוציא את טופי הערב?. 17:05')).toBeTruthy();
    });

    it('lays out a Hebrew message right-to-left and an English message left-to-right', async () => {
      await renderThread(
        createFake({
          messages: [
            msg({ id: 'he', body: 'יצאנו לטיול ארוך' }),
            msg({ id: 'en', senderUserId: 'user-noa', body: 'Back in 20 minutes', createdAt: new Date(2026, 9, 9, 10, 1).toISOString() }),
          ],
        })
      );
      expect(StyleSheet.flatten(screen.getByText('יצאנו לטיול ארוך').props.style)).toMatchObject({ writingDirection: 'rtl', textAlign: 'right' });
      expect(StyleSheet.flatten(screen.getByText('Back in 20 minutes').props.style)).toMatchObject({ writingDirection: 'ltr', textAlign: 'left' });
    });

    it('sends a message once, clears the field, and a second tap sends nothing', async () => {
      const fake = createFake();
      await renderThread(fake);
      fireEvent.changeText(screen.getByLabelText(FAMILY_INPUT), 'חזרתי מהטיול');
      await act(async () => {
        fireEvent.press(screen.getByLabelText('שליחת ההודעה'));
        fireEvent.press(screen.getByLabelText('שליחת ההודעה'));
      });

      await waitFor(() => expect(fake.state.sendCalls).toHaveLength(1));
      expect(fake.state.sendCalls[0]).toMatchObject({ conversationId: FAMILY, body: 'חזרתי מהטיול' });
      expect(screen.getByLabelText(FAMILY_INPUT).props.value).toBe('');
      expect(screen.getAllByText('חזרתי מהטיול')).toHaveLength(1);
    });

    it('disables sending for an empty draft and blocks an over-long one with an explanation', async () => {
      const fake = createFake();
      await renderThread(fake);
      expect(screen.getByLabelText('שליחת ההודעה').props.accessibilityState).toMatchObject({ disabled: true });

      fireEvent.changeText(screen.getByLabelText(FAMILY_INPUT), 'א'.repeat(2001));
      expect(screen.getByText('ההודעה ארוכה מדי: 2,001 מתוך 2,000 תווים')).toBeTruthy();
      await act(async () => { fireEvent.press(screen.getByLabelText('שליחת ההודעה')); });
      expect(fake.state.sendCalls).toHaveLength(0);
    });

    it('a regular member gets no removal controls in the family conversation — not even on their own message', async () => {
      await renderThread(createFake({ messages: [msg({ id: 'm1', body: 'של אמא' }), msg({ id: 'm2', senderUserId: 'user-aba', body: 'שלי', createdAt: new Date(2026, 9, 9, 10, 1).toISOString() })] }));
      expect(screen.queryByAccessibilityHint('הקשה מציגה אפשרויות להודעה')).toBeNull();
      expect(screen.queryByText('מחיקת ההודעה')).toBeNull();
    });

    it('a manager can remove a message after confirming, and it then shows as removed', async () => {
      const fake = createFake({ canModerate: true, messages: [msg({ id: 'bad', body: 'משהו לא מתאים' })] });
      await renderThread(fake);

      fireEvent.press(screen.getByLabelText('אמא: משהו לא מתאים. 10:00'));
      fireEvent.press(screen.getByLabelText('מחיקת ההודעה לכל בני המשפחה'));
      expect(screen.getByText('למחוק את ההודעה?')).toBeTruthy();
      expect(fake.state.messages[0].deletedAt).toBeUndefined();

      await act(async () => { fireEvent.press(screen.getByText('מחיקה')); });

      await waitFor(() => expect(fake.state.messages[0].deletedAt).toBeTruthy());
      expect(screen.queryByText('משהו לא מתאים')).toBeNull();
      expect(screen.getByText('ההודעה הוסרה על ידי מנהל/ת')).toBeTruthy();
    });

    it('shows a message that arrives live from another device', async () => {
      const fake = createFake();
      await renderThread(fake);
      act(() => { fake.push(msg({ id: 'live', senderUserId: 'user-noa', body: 'אני בדרך הביתה' })); });
      expect(screen.getByText('אני בדרך הביתה')).toBeTruthy();
      expect(screen.getByText('נועה')).toBeTruthy();
      expect(screen.queryByText('עדיין אין הודעות')).toBeNull();
    });

    it('shows an offline banner and keeps what was written as an unsent message with retry', async () => {
      const fake = createFake();
      await renderThread(fake);
      act(() => { useChatStore.getState().setOnline(false); });
      expect(screen.getByText('אין חיבור לאינטרנט. הודעות שתכתבו יישלחו כשהחיבור יחזור.')).toBeTruthy();

      fireEvent.changeText(screen.getByLabelText(FAMILY_INPUT), 'אשלח אחר כך');
      await act(async () => { fireEvent.press(screen.getByLabelText('שליחת ההודעה')); });
      expect(fake.state.sendCalls).toHaveLength(0);
      expect(screen.getByText('לא נשלח')).toBeTruthy();
      expect(screen.getByLabelText('שליחה חוזרת של ההודעה')).toBeTruthy();

      await act(async () => { useChatStore.getState().setOnline(true); });
      await waitFor(() => expect(fake.state.sendCalls).toHaveLength(1));
      await waitFor(() => expect(screen.queryByText('לא נשלח')).toBeNull());
    });

    it('shows a reconnecting notice while the live stream is down', async () => {
      const fake = createFake();
      await renderThread(fake);
      expect(screen.queryByText('מתחברים מחדש לעדכונים חיים…')).toBeNull();
      act(() => { fake.activeSubscriptions()[0].handlers.onStatus('reconnecting'); });
      expect(screen.getByText('מתחברים מחדש לעדכונים חיים…')).toBeTruthy();
    });

    it('is read-only while an admin is impersonating another member', async () => {
      useAuthStore.setState({ impersonatingUserId: 'user-noa' });
      await renderThread(createFake({ messages: [msg({ id: 'm1', body: 'הודעה' })] }));
      expect(screen.getByText('בזמן התחזות לבן משפחה אחר הצ׳אט מוצג בשמכם ולקריאה בלבד.')).toBeTruthy();
      expect(screen.queryByLabelText(FAMILY_INPUT)).toBeNull();
      expect(screen.getByText('הודעה')).toBeTruthy();
    });
  });

  describe('private conversation', () => {
    it('is clearly marked private and addressed to the other person', async () => {
      await renderThread(createFake({ withDirect: true }), DIRECT);
      expect(screen.getByText('נועה')).toBeTruthy();
      expect(screen.getByText('שיחה פרטית · רק שניכם רואים אותה')).toBeTruthy();
      expect(screen.getByText('רק את/ה ונועה רואים את ההודעות כאן. גם מנהלי המשפחה לא.')).toBeTruthy();
      expect(screen.queryByText(/בני משפחה$/)).toBeNull();
    });

    it('sends to the private conversation, not to the family', async () => {
      const fake = createFake({ withDirect: true });
      await renderThread(fake, DIRECT);
      fireEvent.changeText(screen.getByLabelText('הודעה פרטית חדשה לנועה'), 'סוד קטן');
      await act(async () => { fireEvent.press(screen.getByLabelText('שליחת ההודעה')); });
      await waitFor(() => expect(fake.state.sendCalls).toEqual([expect.objectContaining({ conversationId: DIRECT, body: 'סוד קטן' })]));
    });

    it('lets me remove my own message but offers nothing on the other person\'s — even to a family admin', async () => {
      useAuthStore.setState({ familyRole: 'admin' });
      const fake = createFake({
        withDirect: true,
        canModerate: true,
        messages: [
          msg({ id: 'theirs', conversationId: DIRECT, senderUserId: 'user-noa', body: 'של נועה' }),
          msg({ id: 'mine', conversationId: DIRECT, senderUserId: 'user-aba', body: 'שלי', createdAt: new Date(2026, 9, 9, 10, 1).toISOString() }),
        ],
      });
      await renderThread(fake, DIRECT);

      expect(screen.getAllByAccessibilityHint('הקשה מציגה אפשרויות להודעה')).toHaveLength(1);
      fireEvent.press(screen.getByLabelText('אני: שלי. 10:01'));
      fireEvent.press(screen.getByLabelText('מחיקת ההודעה אצל שניכם'));
      await act(async () => { fireEvent.press(screen.getByText('מחיקה')); });

      await waitFor(() => expect(screen.getByText('ההודעה נמחקה')).toBeTruthy());
      expect(screen.getByText('של נועה')).toBeTruthy();
    });

    it('becomes read-only when the other person has left the family', async () => {
      useFamilyStore.setState({ users: [USERS[0], USERS[1], member('user-noa', 'נועה', '👧', '2026-10-01T00:00:00.000Z')] });
      await renderThread(createFake({ withDirect: true, messages: [msg({ id: 'd1', conversationId: DIRECT, senderUserId: 'user-noa', body: 'להתראות' })] }), DIRECT);
      expect(screen.getByText('להתראות')).toBeTruthy();
      expect(screen.getByText('נועה כבר לא חלק מהמשפחה. אפשר לקרוא את השיחה, אבל לא לשלוח בה הודעות.')).toBeTruthy();
      expect(screen.queryByLabelText('שליחת ההודעה')).toBeNull();
    });

    it('does not carry a draft from one conversation into another', async () => {
      const fake = createFake({ withDirect: true });
      await renderThread(fake, DIRECT);
      fireEvent.changeText(screen.getByLabelText('הודעה פרטית חדשה לנועה'), 'משהו פרטי שלא נשלח');

      await act(async () => {
        useChatStore.getState().closeConversation();
        useChatStore.getState().openConversation(FAMILY);
      });
      await waitFor(() => expect(screen.getByLabelText(FAMILY_INPUT)).toBeTruthy());
      expect(screen.getByLabelText(FAMILY_INPUT).props.value).toBe('');
    });
  });

  describe('images', () => {
    const imageMessage = (overrides: Partial<ChatMessage> = {}) =>
      msg({
        id: 'img-1',
        body: 'טופי בגינה',
        attachment: { path: `${FAMILY}/user-ima/img-1.jpg`, mime: 'image/jpeg', width: 1200, height: 900, size: 240000 },
        ...overrides,
      });

    it('shows a received image in its bubble through a short-lived signed URL, with its caption', async () => {
      const fake = createFake({ messages: [imageMessage()] });
      await renderThread(fake);

      const image = await screen.findByLabelText('תמונה מאת אמא. הקשה מציגה אותה במסך מלא');
      expect(image).toBeTruthy();
      expect(screen.getByText('טופי בגינה')).toBeTruthy();
      expect(fake.state.signedUrlRequests).toEqual([`${FAMILY}/user-ima/img-1.jpg`]);
    });

    it('opens the image full-screen with a reachable close control and "שמור תמונה"', async () => {
      await renderThread(createFake({ messages: [imageMessage()] }));
      fireEvent.press(await screen.findByLabelText('תמונה מאת אמא. הקשה מציגה אותה במסך מלא'));

      expect(await screen.findByLabelText('שמור תמונה')).toBeTruthy();
      expect(screen.getByLabelText('סגירת התמונה')).toBeTruthy();
      // Before saving, the person is told what the device will ask of them —
      // and the app never claims the image "was saved".
      expect(screen.queryByText(/נשמרה בהצלחה/)).toBeNull();

      fireEvent.press(screen.getByLabelText('סגירת התמונה'));
      expect(screen.queryByLabelText('שמור תמונה')).toBeNull();
    });

    it('closes the viewer if the image\'s message is removed while it is open', async () => {
      const fake = createFake({ messages: [imageMessage()] });
      await renderThread(fake);
      fireEvent.press(await screen.findByLabelText('תמונה מאת אמא. הקשה מציגה אותה במסך מלא'));
      expect(await screen.findByLabelText('שמור תמונה')).toBeTruthy();

      act(() => { fake.push(imageMessage({ body: '', attachment: undefined, deletedAt: '2026-10-09T13:00:00.000Z' })); });

      await waitFor(() => expect(screen.queryByLabelText('שמור תמונה')).toBeNull());
      expect(screen.getByText('ההודעה הוסרה על ידי מנהל/ת')).toBeTruthy();
    });

    it('shows "unavailable" with a retry instead of a broken image when access is refused', async () => {
      const fake = createFake({ messages: [imageMessage()] });
      fake.transport.getAttachmentUrl = async () => { throw new Error('chat image is not available'); };
      await renderThread(fake);
      expect(await screen.findByText('התמונה אינה זמינה')).toBeTruthy();
      expect(screen.getByLabelText('התמונה אינה זמינה. הקשה לניסיון נוסף')).toBeTruthy();
    });

    it('camera or gallery → preview → send: nothing is uploaded until the person confirms', async () => {
      const fake = createFake();
      mockPickChatImage.mockResolvedValue({ ok: true, image: FAKE_IMAGE });
      await renderThread(fake);

      fireEvent.press(screen.getByLabelText('צירוף תמונה'));
      expect(screen.getByText('צילום תמונה')).toBeTruthy();
      await act(async () => { fireEvent.press(screen.getByText('בחירה מהגלריה')); });
      expect(mockPickChatImage).toHaveBeenCalledWith('library');

      expect(await screen.findByText('תצוגה מקדימה')).toBeTruthy();
      expect(screen.getByText('תישלח לכל המשפחה')).toBeTruthy();
      expect(fake.state.uploadCalls).toEqual([]);

      fireEvent.changeText(screen.getByLabelText('כיתוב לתמונה'), 'הנה טופי');
      await act(async () => { fireEvent.press(screen.getByText('שליחה')); });

      await waitFor(() => expect(fake.state.sendImageCalls).toHaveLength(1));
      expect(fake.state.sendImageCalls[0]).toMatchObject({ conversationId: FAMILY, body: 'הנה טופי', width: 1200, height: 900 });
      expect(screen.queryByText('תצוגה מקדימה')).toBeNull();
      expect(screen.getByText('הנה טופי')).toBeTruthy();
    });

    it('takes a photo with the camera option', async () => {
      mockPickChatImage.mockResolvedValue({ ok: false, reason: 'cancelled' });
      await renderThread(createFake());
      fireEvent.press(screen.getByLabelText('צירוף תמונה'));
      await act(async () => { fireEvent.press(screen.getByText('צילום תמונה')); });
      expect(mockPickChatImage).toHaveBeenCalledWith('camera');
      // Cancelling the picker is not an error.
      expect(screen.queryByText('תצוגה מקדימה')).toBeNull();
      expect(screen.queryByRole('alert')).toBeNull();
    });

    it('cancelling the preview uploads and sends nothing', async () => {
      const fake = createFake();
      mockPickChatImage.mockResolvedValue({ ok: true, image: FAKE_IMAGE });
      await renderThread(fake);
      fireEvent.press(screen.getByLabelText('צירוף תמונה'));
      await act(async () => { fireEvent.press(screen.getByText('בחירה מהגלריה')); });
      const preview = await screen.findByText('תצוגה מקדימה');
      expect(preview).toBeTruthy();

      fireEvent.press(screen.getByText('ביטול'));

      expect(screen.queryByText('תצוגה מקדימה')).toBeNull();
      expect(fake.state.uploadCalls).toEqual([]);
      expect(fake.state.sendImageCalls).toEqual([]);
    });

    it('explains a rejected file and a denied permission in Hebrew', async () => {
      mockPickChatImage.mockResolvedValueOnce({ ok: false, reason: 'unsupported_type' });
      await renderThread(createFake());
      fireEvent.press(screen.getByLabelText('צירוף תמונה'));
      await act(async () => { fireEvent.press(screen.getByText('בחירה מהגלריה')); });
      expect(await screen.findByText('סוג התמונה הזה אינו נתמך. נסו תמונת JPEG, PNG או WebP.')).toBeTruthy();

      mockPickChatImage.mockResolvedValueOnce({ ok: false, reason: 'permission_denied' });
      fireEvent.press(screen.getByLabelText('צירוף תמונה'));
      await act(async () => { fireEvent.press(screen.getByText('צילום תמונה')); });
      expect(await screen.findByText('אין הרשאה למצלמה. אפשרו גישה למצלמה בהגדרות המכשיר ונסו שוב.')).toBeTruthy();
    });

    it('shows upload progress with a cancel control, and cancelling removes the bubble', async () => {
      const fake = createFakeChatTransport({ userId: 'user-aba', conversations: [fakeChatConversation({ familyId: 'family-main' })], manualUploads: true });
      mockPickChatImage.mockResolvedValue({ ok: true, image: FAKE_IMAGE });
      await renderThread(fake);
      fireEvent.press(screen.getByLabelText('צירוף תמונה'));
      await act(async () => { fireEvent.press(screen.getByText('בחירה מהגלריה')); });
      await screen.findByText('תצוגה מקדימה');
      await act(async () => { fireEvent.press(screen.getByText('שליחה')); });

      expect(await screen.findByText('מעלה… 0%')).toBeTruthy();
      act(() => { fake.state.uploads[0].progress(0.42); });
      expect(screen.getByText('מעלה… 42%')).toBeTruthy();

      await act(async () => { fireEvent.press(screen.getByLabelText('ביטול העלאת התמונה')); });
      expect(screen.queryByText(/מעלה…/)).toBeNull();
      expect(fake.state.sendImageCalls).toEqual([]);
      expect(fake.state.removedAttachments).toHaveLength(1);
    });

    it('a failed image upload offers retry on the bubble', async () => {
      const fake = createFake();
      fake.state.failUploadWith = new Error('Network request failed');
      mockPickChatImage.mockResolvedValue({ ok: true, image: FAKE_IMAGE });
      await renderThread(fake);
      fireEvent.press(screen.getByLabelText('צירוף תמונה'));
      await act(async () => { fireEvent.press(screen.getByText('בחירה מהגלריה')); });
      await screen.findByText('תצוגה מקדימה');
      await act(async () => { fireEvent.press(screen.getByText('שליחה')); });

      expect(await screen.findByText('לא נשלח')).toBeTruthy();
      fake.state.failUploadWith = null;
      await act(async () => { fireEvent.press(screen.getByLabelText('שליחה חוזרת של ההודעה')); });
      await waitFor(() => expect(fake.state.sendImageCalls).toHaveLength(1));
      await waitFor(() => expect(screen.queryByText('לא נשלח')).toBeNull());
    });

    it('in a private conversation the preview says exactly who will receive the image', async () => {
      const fake = createFake({ withDirect: true });
      mockPickChatImage.mockResolvedValue({ ok: true, image: FAKE_IMAGE });
      await renderThread(fake, DIRECT);
      fireEvent.press(screen.getByLabelText('צירוף תמונה'));
      await act(async () => { fireEvent.press(screen.getByText('בחירה מהגלריה')); });
      expect(await screen.findByText('תישלח לנועה, בשיחה פרטית')).toBeTruthy();

      await act(async () => { fireEvent.press(screen.getByText('שליחה')); });
      await waitFor(() => expect(fake.state.sendImageCalls).toEqual([expect.objectContaining({ conversationId: DIRECT })]));
      expect(fake.state.uploadCalls[0].startsWith(`${DIRECT}/user-aba/`)).toBe(true);
    });
  });
});
