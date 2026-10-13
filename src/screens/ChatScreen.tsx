import React, { useCallback, useEffect } from 'react';
import { ActivityIndicator, AppState, BackHandler, Platform, Pressable, StyleSheet, View, useWindowDimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { useBottomTabBarHeight } from '@react-navigation/bottom-tabs';
import { RtlText } from '../components/RtlText';
import { Button } from '../components/Button';
import { EmptyState } from '../components/EmptyState';
import { ChatConversationList } from '../components/chat/ChatConversationList';
import { ChatThread } from '../components/chat/ChatThread';
import { colors } from '../theme/colors';
import { breakpoints, layout, nativeDirection, radii, spacing, typography } from '../theme/tokens';
import { useAuthStore } from '../store/authStore';
import { useFamilyStore } from '../store/familyStore';
import { useChatStore } from '../store/chatStore';
import { useWebKeyboardInset } from '../lib/useWebKeyboardInset';
import { DEMO_FAMILY } from '../data/demoData';

/** From this width up, the Chats list and the open conversation sit side by side. */
const TWO_PANE_MIN_WIDTH = breakpoints.tablet + 1;
const LIST_PANE_WIDTH = 340;

/**
 * The Chat tab: a unified Chats list (the family group plus the signed-in
 * member's private conversations) and the conversation that is open.
 *   phone   — one at a time: list, then the conversation with a back control
 *   desktop — both, list on the right as Hebrew reads
 */
export function ChatScreen() {
  const familyId = useAuthStore((s) => s.familyId) ?? DEMO_FAMILY.id;
  const systemObserverActive = useAuthStore((s) => s.systemObserverActive);
  const users = useFamilyStore((s) => s.users);
  const loadFamily = useFamilyStore((s) => s.load);

  const status = useChatStore((s) => s.status);
  const errorMessage = useChatStore((s) => s.errorMessage);
  const actionError = useChatStore((s) => s.actionError);
  const online = useChatStore((s) => s.online);
  const conversations = useChatStore((s) => s.conversations);
  const activeConversationId = useChatStore((s) => s.activeConversationId);
  const refresh = useChatStore((s) => s.refresh);
  const setScreenActive = useChatStore((s) => s.setScreenActive);
  const openConversation = useChatStore((s) => s.openConversation);
  const closeConversation = useChatStore((s) => s.closeConversation);
  const clearActionError = useChatStore((s) => s.clearActionError);

  const { width } = useWindowDimensions();
  const twoPane = width >= TWO_PANE_MIN_WIDTH;
  const tabBarHeight = useBottomTabBarHeight();
  const keyboardInset = useWebKeyboardInset();
  const keyboardPadding = Math.max(0, keyboardInset - tabBarHeight);

  const activeConversation = activeConversationId
    ? conversations.find((c) => c.conversationId === activeConversationId)
    : undefined;

  // The roster is normally already loaded by Home; cover a direct landing
  // here (e.g. from a notification) without re-triggering a reload each visit.
  useEffect(() => {
    if (users.length === 0) void loadFamily(familyId);
  }, [users.length, loadFamily, familyId]);

  // "Reading" means this tab is focused AND the app is in the foreground —
  // only then do messages arriving in the open conversation count as read.
  useFocusEffect(
    useCallback(() => {
      const sync = () => setScreenActive(AppState.currentState === 'active');
      sync();
      const subscription = AppState.addEventListener('change', sync);
      return () => {
        subscription.remove();
        setScreenActive(false);
      };
    }, [setScreenActive])
  );

  // Android hardware back: from an open conversation, return to the list.
  useFocusEffect(
    useCallback(() => {
      if (Platform.OS !== 'android') return undefined;
      const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
        if (useChatStore.getState().activeConversationId && !twoPane) {
          closeConversation();
          return true;
        }
        return false;
      });
      return () => subscription.remove();
    }, [closeConversation, twoPane])
  );

  // A conversation that disappears from the list (e.g. a switch of profile
  // mid-render) must not stay "open" with nothing behind it.
  useEffect(() => {
    if (activeConversationId && status === 'ready' && !activeConversation) closeConversation();
  }, [activeConversationId, activeConversation, status, closeConversation]);

  // Side by side there is always room to show a conversation: default to the
  // most recently active one.
  useEffect(() => {
    if (twoPane && status === 'ready' && !activeConversationId && conversations.length > 0) {
      openConversation(conversations[0].conversationId);
    }
  }, [twoPane, status, activeConversationId, conversations, openConversation]);

  if (systemObserverActive) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <View style={styles.plainHeader}>
          <RtlText style={styles.title} accessibilityRole="header">צ׳אטים</RtlText>
        </View>
        <EmptyState emoji="🔒" title="הצ׳אט המשפחתי פרטי" subtitle="שיחות המשפחה אינן זמינות בצפיית מנהל מערכת." />
      </SafeAreaView>
    );
  }

  if (status !== 'ready') {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <View style={styles.plainHeader}>
          <RtlText style={styles.title} accessibilityRole="header">צ׳אטים</RtlText>
        </View>
        {status === 'idle' || status === 'loading' ? (
          <View style={styles.centered}>
            <ActivityIndicator color={colors.primary} accessibilityLabel="טוען…" />
            <RtlText style={styles.centeredText}>טוענים את הצ׳אטים…</RtlText>
          </View>
        ) : status === 'unavailable' ? (
          <View style={styles.centered}>
            <EmptyState
              emoji="🛠️"
              title="הצ׳אט המשפחתי עוד לא הופעל כאן"
              subtitle="התכונה מותקנת באפליקציה, אבל עדיין לא הופעלה בסביבה הזו. נסו שוב בעוד זמן קצר."
            />
            <Button label="נסו שוב" variant="secondary" onPress={() => void refresh()} compact />
          </View>
        ) : (
          <View style={styles.centered}>
            <EmptyState
              emoji={online ? '😕' : '📡'}
              title={online ? 'לא הצלחנו לטעון את הצ׳אט' : 'אין חיבור לאינטרנט'}
              subtitle={online ? errorMessage ?? undefined : 'ההודעות ייטענו ברגע שהחיבור יחזור.'}
            />
            <Button label="נסו שוב" variant="secondary" onPress={() => void refresh()} compact />
          </View>
        )}
      </SafeAreaView>
    );
  }

  const list = <ChatConversationList users={users} selectedConversationId={twoPane ? activeConversationId : null} />;
  const thread = activeConversation ? (
    <ChatThread
      // A different conversation is a different screen: no draft, selection
      // or scroll position may carry over from one to the next.
      key={activeConversation.conversationId}
      conversation={activeConversation}
      users={users}
      showBack={!twoPane}
      keyboardPadding={keyboardPadding}
    />
  ) : null;

  // Errors raised from the list itself (e.g. a private conversation that
  // could not be opened). Inside a conversation, ChatThread shows them.
  const listError =
    actionError && (!activeConversation || twoPane) ? (
      <Pressable
        onPress={clearActionError}
        accessibilityRole="button"
        accessibilityHint="הקשה סוגרת את ההודעה"
        style={styles.listError}
      >
        <RtlText style={styles.listErrorText} accessibilityRole="alert" accessibilityLiveRegion="polite">
          {actionError}
        </RtlText>
      </Pressable>
    ) : null;

  if (twoPane) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        {/* Physical order: conversation on the left, list on the right. */}
        <View style={styles.panes}>
          <View style={styles.threadPane}>
            {thread ?? (
              <View style={styles.centered}>
                <EmptyState emoji="💬" title="בחרו שיחה" subtitle="הצ׳אט המשפחתי והשיחות הפרטיות שלכם מופיעים ברשימה." />
              </View>
            )}
          </View>
          <View style={styles.listPane}>
            {list}
            {activeConversation ? null : listError}
          </View>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      {thread ?? (
        <>
          {list}
          {listError}
        </>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  plainHeader: { paddingHorizontal: layout.screenPadding, paddingTop: spacing.md, paddingBottom: spacing.md },
  title: { ...typography.screenTitle, color: colors.textPrimary },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl, gap: spacing.md },
  centeredText: { ...typography.meta, color: colors.textSecondary, textAlign: 'center' },
  panes: {
    flex: 1,
    width: '100%',
    maxWidth: breakpoints.desktopContent + LIST_PANE_WIDTH / 2,
    alignSelf: 'center',
    flexDirection: 'row',
    ...nativeDirection('ltr'),
  },
  threadPane: { flex: 1, minWidth: 0 },
  listPane: { width: LIST_PANE_WIDTH, borderLeftWidth: 1, borderLeftColor: colors.border },
  listError: {
    marginHorizontal: spacing.lg,
    marginBottom: spacing.md,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radii.md,
    backgroundColor: colors.dangerSoft,
  },
  listErrorText: { ...typography.meta, fontWeight: '700', color: colors.danger, textAlign: 'center' },
});
