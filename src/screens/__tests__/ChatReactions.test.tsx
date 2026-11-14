/**
 * Chat reactions (owner request 2026-11-12, "like WhatsApp"): long-press a
 * message, pick one of six; tap the same again to remove; chips show counts
 * and who reacted. Server side: migration 20261112150100.
 */
import React from 'react';
import fs from 'fs';
import path from 'path';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

jest.mock('@react-navigation/native', () => {
  const ReactActual = require('react');
  return { useFocusEffect: (effect: () => void | (() => void)) => ReactActual.useEffect(effect, [effect]) };
});
jest.mock('@react-navigation/bottom-tabs', () => ({ useBottomTabBarHeight: () => 56 }));

import { ChatScreen } from '../ChatScreen';
import { useAuthStore } from '../../store/authStore';
import { useFamilyStore } from '../../store/familyStore';
import { __resetChatStoreForTests, useChatStore } from '../../store/chatStore';
import { __setChatTransportForTests } from '../../lib/chat';
import { createFakeChatTransport, fakeChatConversation, fakeChatMessage } from '../../testUtils/fakeChatTransport';
import { applyChatReactions, nextChatReaction, summarizeChatReactions } from '../../logic/chat';
import type { ChatReaction, FamilyUser } from '../../types';

const FAMILY = 'conv-family';
const member = (id: string, name: string): FamilyUser => ({
  id, familyId: 'family-main', name, avatar: '🙂', color: '#5B8DEF',
  remindersEnabled: true, gamificationEnabled: true, chatNotificationsEnabled: true, createdAt: '2026-01-01T00:00:00.000Z',
});
const USERS = [member('user-aba', 'אבא'), member('user-ima', 'אמא'), member('user-noa', 'נועה')];
const INSETS = { frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 47, left: 0, right: 0, bottom: 34 } };

function setup(initial: ChatReaction[] = []) {
  const fake = createFakeChatTransport({ userId: 'user-aba', conversations: [fakeChatConversation({ familyId: 'family-main' })] });
  fake.state.messages.push(fakeChatMessage({
    id: 'm1', familyId: 'family-main', senderUserId: 'user-ima', body: 'יצאנו לטיול',
    createdAt: new Date(2026, 9, 9, 10, 0).toISOString(),
  }));
  const rows = [...initial];
  const setReaction = jest.fn(async (messageId: string, emoji: string | null): Promise<ChatReaction> => {
    const row = { messageId, conversationId: FAMILY, userId: 'user-aba', emoji, updatedAt: new Date().toISOString() };
    const i = rows.findIndex((r) => r.messageId === messageId && r.userId === 'user-aba');
    if (i >= 0) rows[i] = row; else rows.push(row);
    return row;
  });
  const transport = {
    ...fake.transport,
    listReactions: jest.fn(async (_c: string, ids: string[]) => rows.filter((r) => ids.includes(r.messageId) && r.emoji)),
    setReaction,
  };
  return { transport, setReaction };
}

async function open(transport: any) {
  __setChatTransportForTests(transport);
  render(<SafeAreaProvider initialMetrics={INSETS}><ChatScreen /></SafeAreaProvider>);
  await act(async () => { await useChatStore.getState().start('family-main:user-aba:self'); });
  await act(async () => { useChatStore.getState().openConversation(FAMILY); });
  await waitFor(() => expect(useChatStore.getState().threads[FAMILY]?.status).toBe('ready'));
}

describe('chat reactions', () => {
  beforeEach(() => {
    __resetChatStoreForTests();
    useAuthStore.setState({ currentUserId: 'user-aba', familyId: 'family-main', familyRole: 'member', impersonatingUserId: null, testModeUserId: null, systemObserverActive: false });
    useFamilyStore.setState({ users: USERS });
  });
  afterEach(() => {
    cleanup();
    __resetChatStoreForTests();
    __setChatTransportForTests(null);
  });

  it('long-press opens six reactions; picking one shows a chip; picking it again removes it', async () => {
    const { transport, setReaction } = setup();
    await open(transport);
    fireEvent(screen.getByLabelText('אמא: יצאנו לטיול. 10:00'), 'longPress');
    expect(screen.getByLabelText('תגובה ❤️')).toBeTruthy();
    expect(screen.getByLabelText('תגובה 🙏')).toBeTruthy();

    await act(async () => { fireEvent.press(screen.getByLabelText('תגובה ❤️')); });
    expect(setReaction).toHaveBeenLastCalledWith('m1', '❤️');
    expect(screen.queryByLabelText('תגובה 👍')).toBeNull(); // picker closed
    expect(screen.getByLabelText('❤️ 1: אבא')).toBeTruthy();

    fireEvent(screen.getByLabelText('אמא: יצאנו לטיול. 10:00'), 'longPress');
    await act(async () => { fireEvent.press(screen.getByLabelText('הסרת התגובה ❤️')); });
    expect(setReaction).toHaveBeenLastCalledWith('m1', null);
    expect(screen.queryByLabelText('❤️ 1: אבא')).toBeNull();
  });

  it("shows others' reactions with counts, and who reacted on tap", async () => {
    const { transport } = setup([
      { messageId: 'm1', conversationId: FAMILY, userId: 'user-ima', emoji: '😂', updatedAt: '2026-10-09T08:00:00.000Z' },
      { messageId: 'm1', conversationId: FAMILY, userId: 'user-noa', emoji: '😂', updatedAt: '2026-10-09T08:01:00.000Z' },
    ]);
    await open(transport);
    await waitFor(() => expect(screen.getByLabelText('😂 2: אמא, נועה')).toBeTruthy());
    fireEvent.press(screen.getByLabelText('😂 2: אמא, נועה'));
    expect(screen.getByText('😂 אמא, נועה')).toBeTruthy();
  });

  it('a failed save puts the previous reaction back', async () => {
    const { transport, setReaction } = setup();
    setReaction.mockRejectedValueOnce(new Error('network down'));
    await open(transport);
    fireEvent(screen.getByLabelText('אמא: יצאנו לטיול. 10:00'), 'longPress');
    await act(async () => { fireEvent.press(screen.getByLabelText('תגובה 👍')); });
    expect(screen.queryByLabelText('👍 1: אבא')).toBeNull();
  });

  it('read-only chat (impersonation) offers no reactions', async () => {
    useAuthStore.setState({ impersonatingUserId: 'user-noa' });
    const { transport } = setup();
    await open(transport);
    expect(screen.queryByLabelText('תגובה ❤️')).toBeNull();
  });
});

describe('reaction logic', () => {
  it('an older row never undoes a newer one; null removes', () => {
    const stamps = new Map<string, string>();
    let state = applyChatReactions({}, [{ messageId: 'm', userId: 'u', emoji: '❤️', updatedAt: '2026-01-01T00:00:02Z' }], stamps);
    state = applyChatReactions(state, [{ messageId: 'm', userId: 'u', emoji: '👍', updatedAt: '2026-01-01T00:00:01Z' }], stamps);
    expect(state.m).toEqual({ u: '❤️' });
    state = applyChatReactions(state, [{ messageId: 'm', userId: 'u', emoji: null, updatedAt: '2026-01-01T00:00:03Z' }], stamps);
    expect(state.m).toEqual({});
  });

  it('summarizes most-used first and toggles the same emoji off', () => {
    expect(summarizeChatReactions({ a: '👍', b: '❤️', c: '❤️' }, 'a').map((r) => [r.emoji, r.count, r.mine]))
      .toEqual([['❤️', 2, false], ['👍', 1, true]]);
    expect(nextChatReaction('❤️', '❤️')).toBeNull();
    expect(nextChatReaction('❤️', '👍')).toBe('👍');
    expect(nextChatReaction(undefined, '👍')).toBe('👍');
  });
});

describe('migrations', () => {
  const read = (name: string) => fs.readFileSync(path.join(__dirname, '../../../supabase/migrations', name), 'utf8');

  it('reactions: no client writes, read access = reading the message, never deleted (RLS-safe realtime)', () => {
    const sql = read('20261112150100_chat_message_reactions.sql');
    expect(sql).toContain('revoke all on public.chat_message_reactions from public, anon, authenticated;');
    expect(sql).toContain('grant select on public.chat_message_reactions to authenticated;');
    expect(sql).toContain('public.chat_can_access_conversation(conversation_id)');
    expect(sql).toContain('m.deleted_at is null');
    expect(sql).not.toMatch(/delete from public\.chat_message_reactions/);
    expect(sql).toContain("emoji text check (emoji in ('❤️', '👍', '😂', '😮', '😢', '🙏'))");
  });

  it('realtime publication is restored only for RLS-protected tables the app subscribes to', () => {
    const sql = read('20261112150000_restore_realtime_publication.sql');
    for (const t of ['users', 'dogs', 'schedule_rules', 'schedule_entries', 'walks', 'walk_swap_requests', 'time_change_requests', 'chat_messages', 'chat_conversation_members']) {
      expect(sql).toContain(`'${t}'`);
    }
    expect(sql).toContain('refusing to publish public.% without row level security');
  });
});
