import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  AppState,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  TextInput,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { useBottomTabBarHeight } from '@react-navigation/bottom-tabs';
import Svg, { Line, Path } from 'react-native-svg';
import { RtlText } from '../components/RtlText';
import { Avatar } from '../components/Avatar';
import { Button } from '../components/Button';
import { ConfirmModal } from '../components/ConfirmModal';
import { EmptyState } from '../components/EmptyState';
import { colors } from '../theme/colors';
import { elevation, layout, nativeDirection, radii, spacing, typography } from '../theme/tokens';
import { useAuthStore } from '../store/authStore';
import { useFamilyStore } from '../store/familyStore';
import { useChatStore } from '../store/chatStore';
import { isSupabaseConfigured } from '../lib/supabase';
import { useWebKeyboardInset } from '../lib/useWebKeyboardInset';
import { DEMO_FAMILY } from '../data/demoData';
import {
  CHAT_MESSAGE_MAX_LENGTH,
  buildChatListItems,
  chatBodyLength,
  chatTextDirection,
  formatChatTime,
  type ChatListItem,
} from '../logic/chat';
import type { ChatMessage, FamilyUser } from '../types';

/** Reading column for the conversation on tablet/desktop — wide enough to feel like a chat, never a stretched phone. */
const CHAT_COLUMN_MAX_WIDTH = 760;
const BUBBLE_MAX_WIDTH = 520;
/** The counter only appears once it is useful, so a normal message is never nagged about length. */
const COUNTER_VISIBLE_FROM = CHAT_MESSAGE_MAX_LENGTH - 200;
const NEAR_BOTTOM_PX = 96;
const INPUT_LINE_HEIGHT = 22;
const INPUT_MAX_HEIGHT = 120;

const FORMER_MEMBER: Pick<FamilyUser, 'name' | 'avatar' | 'color' | 'photoUrl'> = {
  name: 'בן/בת משפחה',
  avatar: '🙂',
  color: colors.statusPending,
  photoUrl: undefined,
};

function SendIcon({ color }: { color: string }) {
  return (
    <Svg width={20} height={20} viewBox="0 0 24 24" accessibilityElementsHidden>
      <Path d="M12 19V5M5.5 11.5 12 5l6.5 6.5" stroke={color} strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" fill="none" />
    </Svg>
  );
}

function BellIcon({ color, muted }: { color: string; muted: boolean }) {
  return (
    <Svg width={layout.iconSize} height={layout.iconSize} viewBox="0 0 24 24" accessibilityElementsHidden>
      <Path d="M6 16.5V11a6 6 0 0 1 12 0v5.5l1.5 2h-15z" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" fill="none" />
      <Path d="M10 20.5a2.2 2.2 0 0 0 4 0" stroke={color} strokeWidth={2} strokeLinecap="round" fill="none" />
      {muted ? <Line x1="4" y1="4" x2="20" y2="20" stroke={color} strokeWidth={2} strokeLinecap="round" /> : null}
    </Svg>
  );
}

interface MessageRowProps {
  item: Extract<ChatListItem, { type: 'message' }>;
  sender: Pick<FamilyUser, 'name' | 'avatar' | 'color' | 'photoUrl'>;
  canModerate: boolean;
  selected: boolean;
  sendError?: string;
  onSelect: (messageId: string | null) => void;
  onRequestDelete: (message: ChatMessage) => void;
  onRetry: (messageId: string) => void;
  onDiscard: (messageId: string) => void;
}

const MessageRow = React.memo(function MessageRow({
  item,
  sender,
  canModerate,
  selected,
  sendError,
  onSelect,
  onRequestDelete,
  onRetry,
  onDiscard,
}: MessageRowProps) {
  const { message, isMine, startsGroup } = item;
  const removed = Boolean(message.deletedAt);
  const direction = chatTextDirection(message.body);
  const time = formatChatTime(message.createdAt);
  const moderatable = canModerate && !removed && message.delivery === 'sent';

  const statusLabel =
    message.delivery === 'sending' ? 'שולח…' : message.delivery === 'failed' ? 'לא נשלח' : time;
  const accessibilityLabel = removed
    ? `הודעה של ${sender.name} הוסרה, ${time}`
    : `${isMine ? 'אני' : sender.name}: ${message.body}. ${statusLabel}`;

  const bubble = (
    <View
      style={[
        styles.bubble,
        isMine ? styles.bubbleMine : styles.bubbleTheirs,
        removed && styles.bubbleRemoved,
        message.delivery === 'failed' && styles.bubbleFailed,
        selected && styles.bubbleSelected,
      ]}
    >
      {!isMine && startsGroup ? (
        <RtlText style={styles.senderName} numberOfLines={1}>
          {sender.name}
        </RtlText>
      ) : null}
      {removed ? (
        <RtlText style={styles.removedText}>ההודעה הוסרה על ידי מנהל/ת</RtlText>
      ) : (
        <RtlText
          style={[
            styles.bodyText,
            { writingDirection: direction, textAlign: direction === 'rtl' ? 'right' : 'left' },
          ]}
          selectable
        >
          {message.body}
        </RtlText>
      )}
      <RtlText
        style={[styles.metaText, message.delivery === 'failed' && styles.metaTextFailed]}
        numberOfLines={1}
      >
        {statusLabel}
      </RtlText>
    </View>
  );

  return (
    <View style={[styles.messageRow, isMine ? styles.messageRowMine : styles.messageRowTheirs, startsGroup && styles.messageRowGroupStart]}>
      <View style={[styles.messageLine, isMine && styles.messageLineMine]}>
        {!isMine ? (
          <View style={styles.avatarSlot}>
            {startsGroup ? (
              <Avatar emoji={sender.avatar} color={sender.color} photoUrl={sender.photoUrl} size={layout.avatarSm} />
            ) : null}
          </View>
        ) : null}
        {moderatable ? (
          <Pressable
            onPress={() => onSelect(selected ? null : message.id)}
            onLongPress={() => onSelect(message.id)}
            accessibilityRole="button"
            accessibilityLabel={accessibilityLabel}
            accessibilityHint="הקשה מציגה אפשרויות ניהול להודעה"
            accessibilityState={{ selected }}
            style={styles.bubblePressable}
          >
            {bubble}
          </Pressable>
        ) : (
          <View accessible accessibilityLabel={accessibilityLabel} style={styles.bubblePressable}>
            {bubble}
          </View>
        )}
      </View>

      {selected && moderatable ? (
        <View style={[styles.rowActions, !isMine && styles.rowActionsIndented]}>
          <Pressable
            onPress={() => onRequestDelete(message)}
            accessibilityRole="button"
            accessibilityLabel="מחיקת ההודעה לכל בני המשפחה"
            style={styles.rowAction}
            hitSlop={8}
          >
            <RtlText style={styles.rowActionDanger}>מחיקת ההודעה</RtlText>
          </Pressable>
        </View>
      ) : null}

      {message.delivery === 'failed' ? (
        <View style={styles.rowActions}>
          {sendError ? (
            <RtlText style={styles.sendErrorText} accessibilityRole="alert">
              {sendError}
            </RtlText>
          ) : null}
          <Pressable
            onPress={() => onRetry(message.id)}
            accessibilityRole="button"
            accessibilityLabel="שליחה חוזרת של ההודעה"
            style={styles.rowAction}
            hitSlop={8}
          >
            <RtlText style={styles.rowActionPrimary}>נסו שוב</RtlText>
          </Pressable>
          <Pressable
            onPress={() => onDiscard(message.id)}
            accessibilityRole="button"
            accessibilityLabel="ביטול ההודעה שלא נשלחה"
            style={styles.rowAction}
            hitSlop={8}
          >
            <RtlText style={styles.rowActionMuted}>ביטול</RtlText>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
});

export function ChatScreen() {
  const familyId = useAuthStore((s) => s.familyId) ?? DEMO_FAMILY.id;
  const systemObserverActive = useAuthStore((s) => s.systemObserverActive);
  const testModeUserId = useAuthStore((s) => s.testModeUserId);
  const impersonatingUserId = useAuthStore((s) => s.impersonatingUserId);
  const users = useFamilyStore((s) => s.users);
  const loadFamily = useFamilyStore((s) => s.load);

  const status = useChatStore((s) => s.status);
  const errorMessage = useChatStore((s) => s.errorMessage);
  const actionError = useChatStore((s) => s.actionError);
  const conversation = useChatStore((s) => s.conversation);
  const messages = useChatStore((s) => s.messages);
  const hasMore = useChatStore((s) => s.hasMore);
  const loadingOlder = useChatStore((s) => s.loadingOlder);
  const unreadDividerFrom = useChatStore((s) => s.unreadDividerFrom);
  const live = useChatStore((s) => s.live);
  const online = useChatStore((s) => s.online);
  const sendErrors = useChatStore((s) => s.sendErrors);
  const refresh = useChatStore((s) => s.refresh);
  const loadOlder = useChatStore((s) => s.loadOlder);
  const send = useChatStore((s) => s.send);
  const retry = useChatStore((s) => s.retry);
  const discard = useChatStore((s) => s.discard);
  const remove = useChatStore((s) => s.remove);
  const setMuted = useChatStore((s) => s.setMuted);
  const setScreenActive = useChatStore((s) => s.setScreenActive);
  const clearActionError = useChatStore((s) => s.clearActionError);

  const [draft, setDraft] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ChatMessage | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [showJumpToLatest, setShowJumpToLatest] = useState(false);
  // react-native-web's multiline field does not grow with its content by
  // itself; native does. Track the content height for web only.
  const [webInputHeight, setWebInputHeight] = useState(INPUT_LINE_HEIGHT);

  const listRef = useRef<FlatList<ChatListItem>>(null);
  const inputRef = useRef<TextInput>(null);
  const stickToBottom = useRef(true);
  const scrollMetrics = useRef({ offset: 0, contentHeight: 0 });
  const restoreAfterPrepend = useRef<{ contentHeight: number; offset: number } | null>(null);

  const tabBarHeight = useBottomTabBarHeight();
  const keyboardInset = useWebKeyboardInset();
  const keyboardPadding = Math.max(0, keyboardInset - tabBarHeight);

  // The roster is normally already loaded by Home; cover a direct landing
  // here (e.g. from a notification) without re-triggering a reload each visit.
  useEffect(() => {
    if (users.length === 0) void loadFamily(familyId);
  }, [users.length, loadFamily, familyId]);

  // "Reading" means this tab is focused AND the app is in the foreground —
  // only then do arriving messages count as read.
  useFocusEffect(
    useCallback(() => {
      const sync = () => setScreenActive(AppState.currentState === 'active');
      sync();
      const subscription = AppState.addEventListener('change', sync);
      return () => {
        subscription.remove();
        setScreenActive(false);
        setSelectedId(null);
      };
    }, [setScreenActive])
  );

  const usersById = useMemo(() => new Map(users.map((u) => [u.id, u])), [users]);
  const memberCount = useMemo(() => users.filter((u) => !u.removedAt).length, [users]);
  const myUserId = conversation?.userId ?? null;
  const items = useMemo(
    () => buildChatListItems(messages, myUserId, { unreadFrom: unreadDividerFrom }),
    [messages, myUserId, unreadDividerFrom]
  );

  const scrollToLatest = useCallback((animated: boolean) => {
    stickToBottom.current = true;
    setShowJumpToLatest(false);
    listRef.current?.scrollToEnd({ animated });
  }, []);

  const handleContentSizeChange = useCallback((_width: number, height: number) => {
    const restore = restoreAfterPrepend.current;
    if (restore) {
      // Older messages were added above: keep the message the reader was
      // looking at exactly where it was.
      restoreAfterPrepend.current = null;
      listRef.current?.scrollToOffset({ offset: restore.offset + (height - restore.contentHeight), animated: false });
    } else if (stickToBottom.current) {
      listRef.current?.scrollToEnd({ animated: false });
    }
    scrollMetrics.current.contentHeight = height;
  }, []);

  const handleScroll = useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent;
    scrollMetrics.current = { offset: contentOffset.y, contentHeight: contentSize.height };
    const nearBottom = contentSize.height - (contentOffset.y + layoutMeasurement.height) < NEAR_BOTTOM_PX;
    stickToBottom.current = nearBottom;
    setShowJumpToLatest((current) => (current === !nearBottom ? current : !nearBottom));
  }, []);

  const handleLoadOlder = useCallback(() => {
    restoreAfterPrepend.current = { ...scrollMetrics.current };
    stickToBottom.current = false;
    void loadOlder();
  }, [loadOlder]);

  useEffect(() => {
    if (keyboardInset > 0) scrollToLatest(false);
  }, [keyboardInset, scrollToLatest]);

  const draftLength = chatBodyLength(draft.trim());
  const overLimit = draftLength > CHAT_MESSAGE_MAX_LENGTH;
  const canSend = draftLength > 0 && !overLimit && status === 'ready';

  // The draft is mirrored in a ref because two taps (or Enter + a tap) can
  // land in the same tick, before React has re-rendered with the cleared
  // state. The ref is emptied synchronously, so the second attempt finds
  // nothing left to send — one press, one message.
  const draftRef = useRef('');
  const updateDraft = useCallback((text: string) => {
    draftRef.current = text;
    setDraft(text);
  }, []);

  const handleSend = useCallback(() => {
    const text = draftRef.current;
    const result = send(text);
    if (!result.ok) return;
    updateDraft('');
    setSelectedId(null);
    scrollToLatest(true);
  }, [send, updateDraft, scrollToLatest]);

  const handleKeyPress = useCallback(
    (event: { nativeEvent: { key: string; shiftKey?: boolean }; preventDefault?: () => void }) => {
      // Desktop web only: Enter sends, Shift+Enter breaks the line. On touch
      // keyboards Enter always stays a line break.
      if (Platform.OS !== 'web' || event.nativeEvent.key !== 'Enter' || event.nativeEvent.shiftKey) return;
      if (typeof window === 'undefined' || !window.matchMedia?.('(pointer: fine)').matches) return;
      event.preventDefault?.();
      handleSend();
    },
    [handleSend]
  );

  const confirmDelete = useCallback(async () => {
    if (!deleteTarget || deleting) return;
    setDeleting(true);
    await remove(deleteTarget.id);
    setDeleting(false);
    setDeleteTarget(null);
    setSelectedId(null);
  }, [deleteTarget, deleting, remove]);

  const renderItem = useCallback(
    ({ item }: { item: ChatListItem }) => {
      if (item.type === 'day') {
        return (
          <View style={styles.dayRow} accessibilityRole="header" accessible accessibilityLabel={item.label}>
            <RtlText style={styles.dayLabel}>{item.label}</RtlText>
          </View>
        );
      }
      if (item.type === 'unread') {
        return (
          <View style={styles.unreadRow} accessible accessibilityLabel="הודעות חדשות">
            <View style={styles.unreadLine} />
            <RtlText style={styles.unreadLabel}>הודעות חדשות</RtlText>
            <View style={styles.unreadLine} />
          </View>
        );
      }
      const sender = (item.message.senderUserId && usersById.get(item.message.senderUserId)) || FORMER_MEMBER;
      return (
        <MessageRow
          item={item}
          sender={sender}
          canModerate={conversation?.canModerate === true}
          selected={selectedId === item.message.id}
          sendError={sendErrors[item.message.id]}
          onSelect={setSelectedId}
          onRequestDelete={setDeleteTarget}
          onRetry={retry}
          onDiscard={discard}
        />
      );
    },
    [usersById, conversation?.canModerate, selectedId, sendErrors, retry, discard]
  );

  const readOnlyReason = impersonatingUserId
    ? 'בזמן התחזות לבן משפחה אחר הצ׳אט מוצג בשמכם ולקריאה בלבד.'
    : testModeUserId
      ? 'במצב בדיקה הצ׳אט מוצג בשמכם ולקריאה בלבד.'
      : null;

  const header = (
    <View style={styles.header}>
      <View style={styles.headerText}>
        <RtlText style={styles.title} accessibilityRole="header" numberOfLines={1}>
          הצ׳אט המשפחתי
        </RtlText>
        <RtlText style={styles.subtitle} numberOfLines={1}>
          {memberCount > 0 ? `פרטי למשפחה בלבד · ${memberCount} בני משפחה` : 'פרטי למשפחה בלבד'}
        </RtlText>
      </View>
      {isSupabaseConfigured && conversation && status === 'ready' ? (
        <Pressable
          onPress={() => void setMuted(!conversation.notificationsMuted)}
          accessibilityRole="switch"
          accessibilityState={{ checked: !conversation.notificationsMuted }}
          accessibilityLabel="התראות על הודעות חדשות בצ׳אט"
          style={({ pressed }) => [styles.headerButton, pressed && styles.pressed]}
        >
          <BellIcon
            color={conversation.notificationsMuted ? colors.textSecondary : colors.primaryDark}
            muted={conversation.notificationsMuted}
          />
        </Pressable>
      ) : null}
    </View>
  );

  if (systemObserverActive) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        {header}
        <EmptyState emoji="🔒" title="הצ׳אט המשפחתי פרטי" subtitle="שיחות המשפחה אינן זמינות בצפיית מנהל מערכת." />
      </SafeAreaView>
    );
  }

  let body: React.ReactNode;
  if (status === 'idle' || status === 'loading') {
    body = (
      <View style={styles.centered}>
        <ActivityIndicator color={colors.primary} accessibilityLabel="טוען…" />
        <RtlText style={styles.centeredText}>טוענים את ההודעות…</RtlText>
      </View>
    );
  } else if (status === 'unavailable') {
    body = (
      <View style={styles.centered}>
        <EmptyState
          emoji="🛠️"
          title="הצ׳אט המשפחתי עוד לא הופעל כאן"
          subtitle="התכונה מותקנת באפליקציה, אבל עדיין לא הופעלה בסביבה הזו. נסו שוב בעוד זמן קצר."
        />
        <Button label="נסו שוב" variant="secondary" onPress={() => void refresh()} compact />
      </View>
    );
  } else if (status === 'error') {
    body = (
      <View style={styles.centered}>
        <EmptyState
          emoji={online ? '😕' : '📡'}
          title={online ? 'לא הצלחנו לטעון את הצ׳אט' : 'אין חיבור לאינטרנט'}
          subtitle={online ? errorMessage ?? undefined : 'ההודעות ייטענו ברגע שהחיבור יחזור.'}
        />
        <Button label="נסו שוב" variant="secondary" onPress={() => void refresh()} compact />
      </View>
    );
  } else {
    body = (
      <>
        <FlatList
          ref={listRef}
          data={items}
          keyExtractor={(item) => item.key}
          renderItem={renderItem}
          style={styles.list}
          contentContainerStyle={[styles.listContent, items.length === 0 && styles.listContentEmpty]}
          onContentSizeChange={handleContentSizeChange}
          onScroll={handleScroll}
          scrollEventThrottle={64}
          keyboardShouldPersistTaps="handled"
          initialNumToRender={40}
          windowSize={21}
          removeClippedSubviews={false}
          ListHeaderComponent={
            hasMore ? (
              <View style={styles.olderRow}>
                {loadingOlder ? (
                  <ActivityIndicator color={colors.primary} accessibilityLabel="טוען…" />
                ) : (
                  <Pressable
                    onPress={handleLoadOlder}
                    accessibilityRole="button"
                    style={({ pressed }) => [styles.olderButton, pressed && styles.pressed]}
                  >
                    <RtlText style={styles.olderLabel}>הודעות קודמות</RtlText>
                  </Pressable>
                )}
              </View>
            ) : null
          }
          ListEmptyComponent={
            <EmptyState
              emoji="💬"
              title="עדיין אין הודעות"
              subtitle="כאן כל המשפחה מתעדכנת במקום אחד. כתבו את ההודעה הראשונה."
            />
          }
        />
        {showJumpToLatest && items.length > 0 ? (
          <Pressable
            onPress={() => scrollToLatest(true)}
            accessibilityRole="button"
            accessibilityLabel="מעבר להודעות האחרונות"
            style={({ pressed }) => [styles.jumpButton, pressed && styles.pressed]}
          >
            <RtlText style={styles.jumpLabel}>↓ להודעות האחרונות</RtlText>
          </Pressable>
        ) : null}
      </>
    );
  }

  const showComposer = status === 'ready' && !readOnlyReason;

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <KeyboardAvoidingView
        style={[styles.flex, keyboardPadding > 0 && { paddingBottom: keyboardPadding }]}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        {header}

        {!online ? (
          <View style={[styles.banner, styles.bannerWarning]}>
            <RtlText style={[styles.bannerText, styles.bannerTextWarning]} accessibilityRole="alert" accessibilityLiveRegion="polite">
              אין חיבור לאינטרנט. הודעות שתכתבו יישלחו כשהחיבור יחזור.
            </RtlText>
          </View>
        ) : status === 'ready' && live !== 'live' ? (
          <View style={[styles.banner, styles.bannerInfo]}>
            <RtlText style={styles.bannerText} accessibilityLiveRegion="polite">
              מתחברים מחדש לעדכונים חיים…
            </RtlText>
          </View>
        ) : null}

        {actionError ? (
          <Pressable
            onPress={clearActionError}
            accessibilityRole="button"
            accessibilityHint="הקשה סוגרת את ההודעה"
            style={[styles.banner, styles.bannerDanger]}
          >
            <RtlText style={[styles.bannerText, styles.bannerTextDanger]} accessibilityRole="alert" accessibilityLiveRegion="polite">
              {actionError}
            </RtlText>
          </Pressable>
        ) : null}

        <View style={styles.bodyWrap}>{body}</View>

        {status === 'ready' && readOnlyReason ? (
          <View style={styles.readOnlyBar}>
            <RtlText style={styles.readOnlyText}>{readOnlyReason}</RtlText>
          </View>
        ) : null}

        {showComposer ? (
          <View style={styles.composerOuter}>
            <View style={styles.composer}>
              <View style={styles.inputWrap}>
                <TextInput
                  ref={inputRef}
                  value={draft}
                  onChangeText={updateDraft}
                  onFocus={() => scrollToLatest(false)}
                  onKeyPress={handleKeyPress as never}
                  placeholder="כתבו הודעה למשפחה…"
                  placeholderTextColor={colors.textSecondary}
                  accessibilityLabel="הודעה חדשה לצ׳אט המשפחתי"
                  multiline
                  {...(Platform.OS === 'web' ? ({ rows: 1 } as object) : null)}
                  onContentSizeChange={(event) => {
                    if (Platform.OS !== 'web') return;
                    const next = Math.min(INPUT_MAX_HEIGHT, Math.max(INPUT_LINE_HEIGHT, Math.ceil(event.nativeEvent.contentSize.height)));
                    setWebInputHeight((current) => (current === next ? current : next));
                  }}
                  // A generous hard stop well above the real limit: the
                  // counter explains the limit, this only prevents a
                  // runaway paste from freezing the field.
                  maxLength={CHAT_MESSAGE_MAX_LENGTH * 2}
                  style={[
                    styles.input,
                    Platform.OS === 'web' && { height: draft.length === 0 ? INPUT_LINE_HEIGHT : webInputHeight },
                    // An empty field follows the app's Hebrew direction; a
                    // draft follows its own first strong character.
                    draft.length > 0 && {
                      writingDirection: chatTextDirection(draft),
                      textAlign: chatTextDirection(draft) === 'rtl' ? 'right' : 'left',
                    },
                  ]}
                />
              </View>
              <Pressable
                onPress={handleSend}
                disabled={!canSend}
                accessibilityRole="button"
                accessibilityLabel="שליחת ההודעה"
                accessibilityState={{ disabled: !canSend }}
                style={({ pressed }) => [styles.sendButton, !canSend && styles.sendButtonDisabled, pressed && canSend && styles.pressed]}
              >
                <SendIcon color={colors.textInverse} />
              </Pressable>
            </View>
            {draftLength >= COUNTER_VISIBLE_FROM ? (
              <RtlText
                style={[styles.counter, overLimit && styles.counterOver]}
                accessibilityRole={overLimit ? 'alert' : undefined}
                accessibilityLiveRegion="polite"
              >
                {overLimit
                  ? `ההודעה ארוכה מדי: ${draftLength.toLocaleString('en-US')} מתוך ${CHAT_MESSAGE_MAX_LENGTH.toLocaleString('en-US')} תווים`
                  : `${draftLength.toLocaleString('en-US')} / ${CHAT_MESSAGE_MAX_LENGTH.toLocaleString('en-US')}`}
              </RtlText>
            ) : null}
          </View>
        ) : null}
      </KeyboardAvoidingView>

      <ConfirmModal
        visible={deleteTarget !== null}
        title="למחוק את ההודעה?"
        message="ההודעה תוסר אצל כל בני המשפחה, ואי אפשר יהיה לשחזר אותה."
        confirmLabel="מחיקה"
        cancelLabel="ביטול"
        loading={deleting}
        onConfirm={() => void confirmDelete()}
        onCancel={() => {
          if (!deleting) setDeleteTarget(null);
        }}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  flex: { flex: 1 },
  pressed: { opacity: 0.75 },

  header: {
    width: '100%',
    maxWidth: CHAT_COLUMN_MAX_WIDTH,
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: layout.screenPadding,
    paddingTop: spacing.md,
    paddingBottom: spacing.md,
  },
  headerText: { flex: 1, minWidth: 0 },
  title: { ...typography.screenTitle, color: colors.textPrimary },
  subtitle: { ...typography.meta, color: colors.textSecondary, marginTop: 2 },
  headerButton: {
    width: layout.minTouchTarget,
    height: layout.minTouchTarget,
    borderRadius: layout.minTouchTarget / 2,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },

  banner: {
    width: '100%',
    maxWidth: CHAT_COLUMN_MAX_WIDTH - layout.screenPadding * 2,
    alignSelf: 'center',
    marginHorizontal: layout.screenPadding,
    marginBottom: spacing.sm,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radii.md,
  },
  bannerInfo: { backgroundColor: colors.surfaceMuted },
  bannerWarning: { backgroundColor: colors.warningSoft },
  bannerDanger: { backgroundColor: colors.dangerSoft },
  bannerText: { ...typography.meta, color: colors.textSecondary, textAlign: 'center' },
  bannerTextWarning: { color: colors.warning, fontWeight: '700' },
  bannerTextDanger: { color: colors.danger, fontWeight: '700' },

  bodyWrap: { flex: 1, minHeight: 0 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl, gap: spacing.md },
  centeredText: { ...typography.meta, color: colors.textSecondary, textAlign: 'center' },

  list: { flex: 1 },
  listContent: {
    width: '100%',
    maxWidth: CHAT_COLUMN_MAX_WIDTH,
    alignSelf: 'center',
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    paddingBottom: spacing.lg,
  },
  listContentEmpty: { flexGrow: 1, justifyContent: 'center' },

  olderRow: { alignItems: 'center', paddingVertical: spacing.sm, minHeight: layout.minTouchTarget, justifyContent: 'center' },
  olderButton: {
    minHeight: layout.minTouchTarget,
    paddingHorizontal: spacing.lg,
    borderRadius: radii.round,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  olderLabel: { ...typography.meta, fontWeight: '700', color: colors.primaryDark, textAlign: 'center' },

  dayRow: { alignItems: 'center', marginTop: spacing.lg, marginBottom: spacing.sm },
  dayLabel: {
    ...typography.caption,
    color: colors.textSecondary,
    backgroundColor: colors.surfaceMuted,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: radii.round,
    overflow: 'hidden',
    textAlign: 'center',
  },
  unreadRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: spacing.md, marginBottom: spacing.xs },
  unreadLine: { flex: 1, height: 1, backgroundColor: colors.primary, opacity: 0.35 },
  unreadLabel: { ...typography.caption, color: colors.primaryDark, textAlign: 'center' },

  // The sides are PHYSICAL, like the tab bar: other people's messages on the
  // right with their avatar at the edge, my own on the left — the mirrored
  // layout Hebrew chat apps use. The web build lays out left-to-right while
  // native is forced RTL, so the row pins its own direction (nativeDirection)
  // and both platforms render the same picture. Text direction is set per
  // message and is unaffected.
  messageRow: { marginTop: 3, maxWidth: '100%', ...nativeDirection('ltr') },
  messageRowGroupStart: { marginTop: spacing.md },
  messageRowTheirs: { alignItems: 'flex-end' },
  messageRowMine: { alignItems: 'flex-start' },
  messageLine: { flexDirection: 'row-reverse', alignItems: 'flex-end', gap: spacing.sm, maxWidth: '88%' },
  messageLineMine: { flexDirection: 'row', maxWidth: '82%' },
  avatarSlot: { width: layout.avatarSm, height: layout.avatarSm, alignSelf: 'flex-start' },
  bubblePressable: { flexShrink: 1, minWidth: 0, maxWidth: BUBBLE_MAX_WIDTH },

  bubble: {
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    paddingBottom: 6,
    borderRadius: radii.lg,
    borderWidth: 1,
    minWidth: 72,
  },
  bubbleTheirs: { backgroundColor: colors.surface, borderColor: colors.border, ...elevation.card },
  bubbleMine: { backgroundColor: colors.primarySoft, borderColor: '#C5EBEE' },
  bubbleRemoved: { backgroundColor: colors.surfaceMuted, borderColor: colors.border, shadowOpacity: 0, elevation: 0 },
  bubbleFailed: { borderColor: colors.statusOverdue, borderStyle: 'dashed' },
  bubbleSelected: { borderColor: colors.primary, borderWidth: 2, paddingHorizontal: spacing.md - 1, paddingTop: spacing.sm - 1, paddingBottom: 5 },

  senderName: { ...typography.meta, fontWeight: '700', color: colors.primaryDark, marginBottom: 2 },
  bodyText: { fontSize: 16, lineHeight: 23, fontWeight: '500', color: colors.textPrimary },
  removedText: { ...typography.meta, color: colors.textSecondary, fontStyle: 'italic' },
  // Times read left-to-right in both languages; pinned to the bubble's end.
  metaText: { fontSize: 11, lineHeight: 15, fontWeight: '500', color: colors.textSecondary, marginTop: 3, writingDirection: 'ltr', textAlign: 'left' },
  metaTextFailed: { color: colors.danger, fontWeight: '700', writingDirection: 'rtl' },

  rowActions: { flexDirection: 'row-reverse', flexWrap: 'wrap', alignItems: 'center', gap: spacing.md, marginTop: 2 },
  rowActionsIndented: { paddingRight: layout.avatarSm + spacing.sm },
  rowAction: { minHeight: 36, justifyContent: 'center', paddingHorizontal: spacing.xs },
  rowActionDanger: { ...typography.meta, fontWeight: '700', color: colors.danger },
  rowActionPrimary: { ...typography.meta, fontWeight: '700', color: colors.primaryDark },
  rowActionMuted: { ...typography.meta, fontWeight: '700', color: colors.textSecondary },
  sendErrorText: { ...typography.meta, color: colors.danger, flexShrink: 1 },

  jumpButton: {
    position: 'absolute',
    bottom: spacing.md,
    alignSelf: 'center',
    minHeight: 36,
    paddingHorizontal: spacing.lg,
    borderRadius: radii.round,
    backgroundColor: colors.primaryDark,
    alignItems: 'center',
    justifyContent: 'center',
    ...elevation.card,
  },
  jumpLabel: { ...typography.meta, fontWeight: '700', color: colors.textInverse, textAlign: 'center' },

  readOnlyBar: {
    backgroundColor: colors.surface,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingVertical: spacing.md,
    paddingHorizontal: layout.screenPadding,
  },
  readOnlyText: { ...typography.meta, color: colors.textSecondary, textAlign: 'center' },

  composerOuter: {
    backgroundColor: colors.surface,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    paddingBottom: spacing.sm,
  },
  composer: {
    width: '100%',
    maxWidth: CHAT_COLUMN_MAX_WIDTH - spacing.lg * 2,
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: spacing.sm,
  },
  inputWrap: {
    flex: 1,
    minWidth: 0,
    minHeight: layout.minTouchTarget,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.background,
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
    paddingVertical: Platform.OS === 'ios' ? spacing.sm : spacing.xs,
  },
  input: {
    // 16px keeps iOS Safari from zooming the page when the field is focused.
    fontSize: 16,
    lineHeight: INPUT_LINE_HEIGHT,
    color: colors.textPrimary,
    maxHeight: INPUT_MAX_HEIGHT,
    padding: 0,
    textAlign: 'right',
    writingDirection: 'rtl',
    ...(Platform.OS === 'web' ? ({ outlineStyle: 'none' } as object) : null),
  },
  sendButton: {
    width: layout.minTouchTarget,
    height: layout.minTouchTarget,
    borderRadius: layout.minTouchTarget / 2,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendButtonDisabled: { backgroundColor: colors.statusPending },
  counter: {
    width: '100%',
    maxWidth: CHAT_COLUMN_MAX_WIDTH - spacing.lg * 2,
    alignSelf: 'center',
    ...typography.caption,
    color: colors.textSecondary,
    marginTop: spacing.xs,
    textAlign: 'right',
  },
  counterOver: { color: colors.danger },
});
