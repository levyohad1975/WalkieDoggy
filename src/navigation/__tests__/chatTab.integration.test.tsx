import React from 'react';
import fs from 'fs';
import path from 'path';
import { act, render, screen, fireEvent, waitFor } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

const initialSafeAreaMetrics = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 47, left: 0, right: 0, bottom: 34 },
};

/**
 * Family Chat navigation entry — real RootNavigator, real fixed tab bar,
 * real presses (same approach as tabNavigation.integration.test.tsx). Only
 * the leaf screens are mocked; the chat session/store are real and run
 * against a fake transport.
 */
jest.mock('../../screens/HomeScreen', () => {
  const { Text } = require('react-native');
  return { HomeScreen: () => <Text>HOME_SCREEN</Text> };
});
jest.mock('../../screens/ScheduleScreen', () => {
  const { Text } = require('react-native');
  return { ScheduleScreen: () => <Text>SCHEDULE_SCREEN</Text> };
});
jest.mock('../../screens/FamilyScreen', () => {
  const { Text } = require('react-native');
  return { FamilyScreen: () => <Text>FAMILY_SCREEN</Text> };
});
jest.mock('../../screens/HistoryScreen', () => {
  const { Text } = require('react-native');
  return { HistoryScreen: () => <Text>HISTORY_SCREEN</Text> };
});
jest.mock('../../screens/StatisticsScreen', () => {
  const { Text } = require('react-native');
  return { StatisticsScreen: () => <Text>STATISTICS_SCREEN</Text> };
});
jest.mock('../../screens/SettingsScreen', () => {
  const { Text } = require('react-native');
  return { SettingsScreen: () => <Text>SETTINGS_SCREEN</Text> };
});
jest.mock('../../screens/ChatScreen', () => {
  const { Text } = require('react-native');
  return { ChatScreen: () => <Text>CHAT_SCREEN</Text> };
});
jest.mock('../../lib/realtime', () => ({ subscribeToFamilyChanges: () => () => undefined }));

import { RootNavigator } from '../RootNavigator';
import { useAuthStore } from '../../store/authStore';
import { useFamilyStore } from '../../store/familyStore';
import { __resetChatStoreForTests, useChatStore } from '../../store/chatStore';
import { __setChatTransportForTests, type ChatSubscriptionHandlers, type ChatTransport } from '../../lib/chat';
import { __resetChatEntryForTests, publishChatOpen } from '../../notifications/chatEntry';
import { __resetNotificationOpenDedupForTests } from '../../notifications/notificationOpenDedup';

function createTransport() {
  const subscriptions: Array<{ conversationId: string; handlers: ChatSubscriptionHandlers; active: boolean }> = [];
  let familyId = 'family-main';
  const transport: ChatTransport = {
    open: async () => ({
      conversationId: `conv-${familyId}`,
      familyId,
      userId: useAuthStore.getState().currentUserId ?? 'nobody',
      lastReadAt: '2026-10-09T09:00:00.000Z',
      notificationsMuted: false,
      unreadCount: 0,
      canModerate: false,
    }),
    listMessages: async () => [],
    send: async () => { throw new Error('not used'); },
    remove: async () => { throw new Error('not used'); },
    markRead: async () => 0,
    setMuted: async (_id, muted) => muted,
    subscribe: (conversationId, handlers) => {
      const subscription = { conversationId, handlers, active: true };
      subscriptions.push(subscription);
      handlers.onStatus('live');
      return () => { subscription.active = false; };
    },
    notify: async () => undefined,
  };
  return { transport, subscriptions, setFamily: (id: string) => { familyId = id; } };
}

function renderApp() {
  return render(
    <SafeAreaProvider initialMetrics={initialSafeAreaMetrics}>
      <RootNavigator />
    </SafeAreaProvider>
  );
}

describe('Family Chat — navigation entry, badge and session lifecycle', () => {
  let fake: ReturnType<typeof createTransport>;

  beforeEach(() => {
    fake = createTransport();
    __setChatTransportForTests(fake.transport);
    __resetChatStoreForTests();
    __resetChatEntryForTests();
    __resetNotificationOpenDedupForTests();
    useAuthStore.setState({
      currentUserId: 'user-aba',
      familyId: 'family-main',
      familyRole: 'member',
      impersonatingUserId: null,
      testModeUserId: null,
      systemObserverActive: false,
    });
    useFamilyStore.setState({ permissionOverrides: [], permissionOverridesStatus: 'loaded' });
  });

  afterEach(() => {
    __resetChatStoreForTests();
    __setChatTransportForTests(null);
  });

  it('shows a Chat entry to a regular member and opens the chat screen on tap', async () => {
    renderApp();
    await waitFor(() => expect(screen.getByText('HOME_SCREEN')).toBeTruthy());

    fireEvent.press(screen.getByLabelText('צ׳אט'));

    await waitFor(() => expect(screen.getByText('CHAT_SCREEN')).toBeTruthy());
    expect(screen.queryByText('HOME_SCREEN')).toBeNull();
  });

  it('keeps the Chat entry even when every permission-gated tab is hidden (a child with no extra permissions)', async () => {
    useFamilyStore.setState({
      permissionOverridesStatus: 'loaded',
      permissionOverrides: [
        { userId: 'user-aba', permissionKey: 'view_history', allowed: false },
        { userId: 'user-aba', permissionKey: 'view_statistics', allowed: false },
      ] as never,
    });
    renderApp();
    await waitFor(() => expect(screen.getByText('HOME_SCREEN')).toBeTruthy());

    expect(screen.queryByLabelText('היסטוריה')).toBeNull();
    expect(screen.queryByLabelText('נתונים')).toBeNull();
    expect(screen.getByLabelText('צ׳אט')).toBeTruthy();
  });

  it('shows the unread count on the Chat icon and in its accessibility label, and hides it at zero', async () => {
    renderApp();
    await waitFor(() => expect(useChatStore.getState().status).toBe('ready'));
    expect(screen.queryByText('3')).toBeNull();

    act(() => { useChatStore.setState({ unreadCount: 3 }); });
    expect(screen.getByText('3')).toBeTruthy();
    expect(screen.getByLabelText('צ׳אט, 3 הודעות שלא נקראו')).toBeTruthy();

    act(() => { useChatStore.setState({ unreadCount: 250 }); });
    expect(screen.getByText('99+')).toBeTruthy();

    act(() => { useChatStore.setState({ unreadCount: 0 }); });
    expect(screen.queryByText('99+')).toBeNull();
    expect(screen.getByLabelText('צ׳אט')).toBeTruthy();
  });

  it('a live message from another family member raises the badge on any tab', async () => {
    renderApp();
    await waitFor(() => expect(fake.subscriptions.filter((s) => s.active)).toHaveLength(1));

    act(() => {
      fake.subscriptions[0].handlers.onMessage({
        id: 'm1',
        conversationId: 'conv-family-main',
        familyId: 'family-main',
        senderUserId: 'user-ima',
        body: 'מי מוציא את טופי?',
        createdAt: '2026-10-09T12:00:00.000Z',
        delivery: 'sent',
      });
    });

    expect(screen.getByLabelText('צ׳אט, 1 הודעות שלא נקראו')).toBeTruthy();
  });

  it('a tapped chat notification switches to the Chat tab', async () => {
    renderApp();
    await waitFor(() => expect(screen.getByText('HOME_SCREEN')).toBeTruthy());

    act(() => { publishChatOpen({ conversationId: 'conv-family-main', messageId: 'm1' }); });

    await waitFor(() => expect(screen.getByText('CHAT_SCREEN')).toBeTruthy());
  });

  it('switching family releases the old Realtime subscription and opens the new family\'s conversation', async () => {
    renderApp();
    await waitFor(() => expect(fake.subscriptions.filter((s) => s.active)).toHaveLength(1));
    expect(fake.subscriptions[0].conversationId).toBe('conv-family-main');

    fake.setFamily('family-other');
    act(() => { useAuthStore.setState({ familyId: 'family-other', currentUserId: 'user-other' }); });

    await waitFor(() => expect(fake.subscriptions.filter((s) => s.active).map((s) => s.conversationId)).toEqual(['conv-family-other']));
    expect(fake.subscriptions[0].active).toBe(false);
  });

  it('unmounting the navigator (sign-out) leaves no live subscription behind', async () => {
    const view = renderApp();
    await waitFor(() => expect(fake.subscriptions.filter((s) => s.active)).toHaveLength(1));

    view.unmount();

    expect(fake.subscriptions.filter((s) => s.active)).toHaveLength(0);
    expect(useChatStore.getState().status).toBe('idle');
  });

  it('never opens a chat session for the System Admin hidden observer', async () => {
    useAuthStore.setState({ currentUserId: null, systemObserverActive: true });
    renderApp();
    await waitFor(() => expect(screen.getByText('HOME_SCREEN')).toBeTruthy());

    expect(fake.subscriptions).toHaveLength(0);
    expect(useChatStore.getState().status).toBe('idle');
  });
});

describe('Family Chat — tab bar contract (source)', () => {
  const source = fs.readFileSync(path.resolve(__dirname, '../RootNavigator.tsx'), 'utf8');

  it('balances the bar: three destinations on each side of the centred Home button', () => {
    const order = source.match(/const PHYSICAL_TAB_ORDER: \(keyof RootTabParamList\)\[\] = \[([\s\S]*?)\];/);
    expect(order).not.toBeNull();
    const names = [...order![1].matchAll(/'(\w+)'/g)].map((m) => m[1]);
    expect(names).toEqual(['Settings', 'Statistics', 'Family', 'Home', 'Chat', 'Schedule', 'History']);
  });

  it('never permission-gates the Chat route', () => {
    expect(source).toContain('<Tab.Screen name="Chat" component={ChatScreen} />');
    expect(source).not.toMatch(/\?\s*<Tab\.Screen name="Chat"/);
  });

  it('keeps tab labels on one line and the bar inside the iPhone safe area', () => {
    expect(source).toContain("Chat: 'צ׳אט',");
    expect(source).toMatch(/<RtlText allowFontScaling=\{false\} numberOfLines=\{1\} adjustsFontSizeToFit/);
    expect(source).toContain('height: layout.rowHeight + insets.bottom, paddingBottom: Math.max(spacing.sm, insets.bottom)');
  });

  it('anchors the badge physically so it cannot flip sides, and reads the count without re-rendering the navigator', () => {
    expect(source).toContain('const chatBadge = formatChatBadge(useChatStore((s) => s.unreadCount));');
    expect(source).toMatch(/position: 'absolute', top: -5, left: layout\.iconSize - 9/);
  });
});
