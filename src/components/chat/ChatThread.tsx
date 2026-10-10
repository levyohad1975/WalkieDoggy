import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  TextInput,
  View,
  useWindowDimensions,
  type LayoutChangeEvent,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';
import Svg, { Circle, Line, Path, Rect } from 'react-native-svg';
import { RtlText } from '../RtlText';
import { Avatar } from '../Avatar';
import { Button } from '../Button';
import { ConfirmModal } from '../ConfirmModal';
import { EmptyState } from '../EmptyState';
import { ChatImageBubble, ChatImageViewer } from './ChatImage';
import { ChatAttachSheet, ChatImagePreview } from './ChatImageComposer';
import { FamilyChatGlyph, LockGlyph } from './ChatConversationList';
import { colors } from '../../theme/colors';
import { elevation, layout, nativeDirection, radii, spacing, typography } from '../../theme/tokens';
import { useAuthStore } from '../../store/authStore';
import { useChatStore, type ChatThread as ChatThreadState } from '../../store/chatStore';
import { isSupabaseConfigured } from '../../lib/supabase';
import { pickChatImage, releasePreparedChatImage, type ChatImageSource, type PreparedChatImage } from '../../lib/chatImages';
import { chatImageProblemMessage } from '../../logic/chatImages';
import {
  CHAT_MESSAGE_MAX_LENGTH,
  buildChatListItems,
  chatBodyLength,
  chatTextDirection,
  formatChatTime,
  type ChatListItem,
} from '../../logic/chat';
import type { ChatConversationState, ChatMessage, FamilyUser } from '../../types';

/** Reading column for the conversation on tablet/desktop — wide enough to feel like a chat, never a stretched phone. */
const CHAT_COLUMN_MAX_WIDTH = 760;
const BUBBLE_MAX_WIDTH = 520;
/** The counter only appears once it is useful, so a normal message is never nagged about length. */
const COUNTER_VISIBLE_FROM = CHAT_MESSAGE_MAX_LENGTH - 200;
const NEAR_BOTTOM_PX = 96;
const INPUT_LINE_HEIGHT = 22;
const INPUT_MAX_HEIGHT = 120;
const NO_THREAD: ChatThreadState = { status: 'idle', messages: [], hasMore: false, loadingOlder: false };

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

function CameraIcon({ color }: { color: string }) {
  return (
    <Svg width={layout.iconSize} height={layout.iconSize} viewBox="0 0 24 24" accessibilityElementsHidden>
      <Rect x="3" y="7" width="18" height="13" rx="3" stroke={color} strokeWidth={2} fill="none" />
      <Path d="M8.5 7 10 4.5h4L15.5 7" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" fill="none" />
      <Circle cx="12" cy="13.5" r="3.2" stroke={color} strokeWidth={2} fill="none" />
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
  isPrivate: boolean;
  /** This viewer may remove this message (family: a manager; private: its sender). */
  canRemove: boolean;
  selected: boolean;
  selectionMode: boolean;
  sendError?: string;
  imageMaxWidth: number;
  onSelect: (messageId: string) => void;
  onRequestDelete: (message: ChatMessage) => void;
  onRetry: (messageId: string) => void;
  onDiscard: (messageId: string) => void;
  onOpenImage: (message: ChatMessage) => void;
}

const MessageRow = React.memo(function MessageRow({
  item,
  sender,
  isPrivate,
  canRemove,
  selected,
  selectionMode,
  sendError,
  imageMaxWidth,
  onSelect,
  onRequestDelete,
  onRetry,
  onDiscard,
  onOpenImage,
}: MessageRowProps) {
  const { message, isMine, startsGroup } = item;
  const removed = Boolean(message.deletedAt);
  const hasImage = Boolean(message.attachment) && !removed;
  const direction = chatTextDirection(message.body);
  const time = formatChatTime(message.createdAt);
  const removable = canRemove && !removed && message.delivery === 'sent';
  // In a private conversation the other side is the conversation's title:
  // repeating their name and avatar on every bubble adds nothing.
  const showSender = !isMine && !isPrivate;

  const statusLabel =
    message.delivery === 'sending' ? 'שולח…' : message.delivery === 'failed' ? 'לא נשלח' : time;
  const spoken = hasImage ? (message.body ? `תמונה. ${message.body}` : 'תמונה') : message.body;
  const accessibilityLabel = removed
    ? `הודעה של ${sender.name} הוסרה, ${time}`
    : `${isMine ? 'אני' : sender.name}: ${spoken}. ${statusLabel}`;

  const bubble = (
    <View
      style={[
        styles.bubble,
        isMine ? styles.bubbleMine : styles.bubbleTheirs,
        hasImage && styles.bubbleWithImage,
        removed && styles.bubbleRemoved,
        message.delivery === 'failed' && styles.bubbleFailed,
        selected && styles.bubbleSelected,
      ]}
    >
      {showSender && startsGroup ? (
        <RtlText style={styles.senderName} numberOfLines={1}>
          {sender.name}
        </RtlText>
      ) : null}
      {removed ? (
        <RtlText style={styles.removedText}>
          {isPrivate || message.deletedByUserId === message.senderUserId ? 'ההודעה נמחקה' : 'ההודעה הוסרה על ידי מנהל/ת'}
        </RtlText>
      ) : (
        <>
          {hasImage ? (
            <ChatImageBubble
              message={message}
              maxWidth={imageMaxWidth}
              senderName={isMine ? 'אני' : sender.name}
              onOpen={onOpenImage}
              onLongPress={() => onSelect(message.id)}
              onCancelUpload={onDiscard}
            />
          ) : null}
          {message.body.length > 0 ? (
            <RtlText
              style={[
                styles.bodyText,
                { writingDirection: direction, textAlign: direction === 'rtl' ? 'right' : 'left' },
              ]}
              selectable
            >
              {message.body}
            </RtlText>
          ) : null}
        </>
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
        {showSender ? (
          <View style={styles.avatarSlot}>
            {startsGroup ? (
              <Avatar emoji={sender.avatar} color={sender.color} photoUrl={sender.photoUrl} size={layout.avatarSm} />
            ) : null}
          </View>
        ) : null}
        {removable && !hasImage ? (
          <Pressable
            onPress={() => onSelect(message.id)}
            onLongPress={() => onSelect(message.id)}
            delayLongPress={350}
            accessibilityRole="button"
            accessibilityLabel={accessibilityLabel}
            accessibilityHint="הקשה מציגה אפשרויות להודעה"
            accessibilityState={{ selected }}
            style={styles.bubblePressable}
          >
            {bubble}
          </Pressable>
        ) : (
          <View accessible={!hasImage} accessibilityLabel={accessibilityLabel} style={styles.bubblePressable}>
            {bubble}
          </View>
        )}
      </View>

      {/* An image bubble's own tap opens the viewer, so its options are a
          separate, always-visible control instead of "tap the bubble". */}
      {removable && hasImage && !selected ? (
        <View style={[styles.rowActions, showSender && styles.rowActionsIndented]}>
          <Pressable
            onPress={() => onSelect(message.id)}
            accessibilityRole="button"
            accessibilityLabel="אפשרויות לתמונה"
            style={styles.rowAction}
            hitSlop={8}
          >
              <RtlText style={styles.rowActionMuted}>{selected ? 'נבחרה למחיקה' : 'אפשרויות'}</RtlText>
          </Pressable>
        </View>
      ) : null}

      {removable && (selectionMode || selected) ? (
        <View style={[styles.rowActions, showSender && styles.rowActionsIndented]}>
          <Pressable
            onPress={() => onSelect(message.id)}
            accessibilityRole="checkbox"
            accessibilityLabel={selected ? 'ביטול בחירת ההודעה' : 'בחירת ההודעה למחיקה'}
            accessibilityState={{ checked: selected }}
            style={styles.selectionCheck}
          >
            <Svg width={20} height={20} viewBox="0 0 24 24" accessibilityElementsHidden>
              <Circle cx="12" cy="12" r="9" fill={selected ? colors.primary : colors.surface} stroke={selected ? colors.primary : colors.textSecondary} strokeWidth={2} />
              {selected ? <Path d="m7.5 12.5 3 3 6-7" stroke="#fff" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" fill="none" /> : null}
            </Svg>
          </Pressable>
          <Pressable
            onPress={() => onRequestDelete(message)}
            accessibilityRole="button"
            accessibilityLabel={isPrivate ? 'מחיקת ההודעה אצל שניכם' : 'מחיקת ההודעה לכל בני המשפחה'}
            style={styles.rowAction}
            hitSlop={8}
          >
            <RtlText style={styles.rowActionDanger}>מחיקת ההודעה</RtlText>
          </Pressable>
          {hasImage ? (
            <Pressable
              onPress={() => onSelect(message.id)}
              accessibilityRole="button"
              accessibilityLabel="סגירת האפשרויות"
              style={styles.rowAction}
              hitSlop={8}
            >
              <RtlText style={styles.rowActionMuted}>סגירה</RtlText>
            </Pressable>
          ) : null}
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

interface ChatThreadProps {
  conversation: ChatConversationState;
  users: FamilyUser[];
  /** Phone layout: a back control returns to the Chats list. Hidden in the desktop two-pane layout. */
  showBack: boolean;
  /** Extra bottom padding while the on-screen keyboard covers the page (web). */
  keyboardPadding: number;
}

/** One open conversation — the family group or a private one — with its composer. */
export function ChatThread({ conversation, users, showBack, keyboardPadding }: ChatThreadProps) {
  const testModeUserId = useAuthStore((s) => s.testModeUserId);
  const impersonatingUserId = useAuthStore((s) => s.impersonatingUserId);

  const thread = useChatStore((s) => s.threads[conversation.conversationId]) ?? NO_THREAD;
  const capabilities = useChatStore((s) => s.capabilities);
  const actionError = useChatStore((s) => s.actionError);
  const unreadDividerFrom = useChatStore((s) => s.unreadDividerFrom);
  const live = useChatStore((s) => s.live);
  const online = useChatStore((s) => s.online);
  const sendErrors = useChatStore((s) => s.sendErrors);
  const refresh = useChatStore((s) => s.refresh);
  const loadOlder = useChatStore((s) => s.loadOlder);
  const send = useChatStore((s) => s.send);
  const sendImage = useChatStore((s) => s.sendImage);
  const retry = useChatStore((s) => s.retry);
  const discard = useChatStore((s) => s.discard);
  const remove = useChatStore((s) => s.remove);
  const removeMany = useChatStore((s) => s.removeMany);
  const clearForMe = useChatStore((s) => s.clearForMe);
  const clearForEveryone = useChatStore((s) => s.clearForEveryone);
  const setMuted = useChatStore((s) => s.setMuted);
  const closeConversation = useChatStore((s) => s.closeConversation);
  const clearActionError = useChatStore((s) => s.clearActionError);

  const { messages, hasMore, loadingOlder } = thread;
  const isPrivate = conversation.kind === 'direct';

  const [draft, setDraft] = useState('');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const selectionMode = selectedIds.size > 0;
  const [deleteTarget, setDeleteTarget] = useState<ChatMessage[] | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [showConversationActions, setShowConversationActions] = useState(false);
  const [clearForMeVisible, setClearForMeVisible] = useState(false);
  const [clearEveryoneStep, setClearEveryoneStep] = useState<0 | 1 | 2>(0);
  const [showJumpToLatest, setShowJumpToLatest] = useState(false);
  const [attachSheetVisible, setAttachSheetVisible] = useState(false);
  const [pickedImage, setPickedImage] = useState<PreparedChatImage | null>(null);
  const [pickError, setPickError] = useState<string | null>(null);
  const [preparingImage, setPreparingImage] = useState(false);
  const [viewerMessage, setViewerMessage] = useState<ChatMessage | null>(null);
  // react-native-web's multiline field does not grow with its content by
  // itself; native does. Track the content height for web only.
  const [webInputHeight, setWebInputHeight] = useState(INPUT_LINE_HEIGHT);

  const listRef = useRef<FlatList<ChatListItem>>(null);
  const stickToBottom = useRef(true);
  const scrollMetrics = useRef({ offset: 0, contentHeight: 0, layoutHeight: 0 });
  const restoreAfterPrepend = useRef<{ contentHeight: number; offset: number } | null>(null);
  const { width: windowWidth } = useWindowDimensions();

  const usersById = useMemo(() => new Map(users.map((u) => [u.id, u])), [users]);
  const memberCount = useMemo(() => users.filter((u) => !u.removedAt).length, [users]);
  const other = conversation.otherUserId ? usersById.get(conversation.otherUserId) : undefined;
  const otherName = other?.name ?? FORMER_MEMBER.name;
  const otherLeft = isPrivate && Boolean(other?.removedAt);
  const myUserId = conversation.userId;
  const items = useMemo(
    () => buildChatListItems(messages, myUserId, { unreadFrom: unreadDividerFrom }),
    [messages, myUserId, unreadDividerFrom]
  );
  // Widest an image may be drawn inside a bubble on this screen.
  const imageMaxWidth = Math.max(140, Math.min(300, Math.min(windowWidth, CHAT_COLUMN_MAX_WIDTH) * 0.62));

  // If the open image's message is removed while it is on screen, close the viewer.
  useEffect(() => {
    if (!viewerMessage) return;
    const current = messages.find((m) => m.id === viewerMessage.id);
    if (!current || current.deletedAt || !current.attachment) setViewerMessage(null);
  }, [messages, viewerMessage]);

  // Scrolls to an exact offset computed from the sizes this screen measured
  // itself. FlatList's own scrollToEnd() reads the list's cached content
  // length, which is still the OLD length inside onContentSizeChange — so it
  // lands short by exactly the height of whatever was just added.
  const scrollToBottom = useCallback((animated: boolean) => {
    const { contentHeight, layoutHeight } = scrollMetrics.current;
    listRef.current?.scrollToOffset({ offset: Math.max(0, contentHeight - layoutHeight), animated });
  }, []);

  const scrollToLatest = useCallback((animated: boolean) => {
    stickToBottom.current = true;
    setShowJumpToLatest(false);
    scrollToBottom(animated);
  }, [scrollToBottom]);

  const handleContentSizeChange = useCallback((_width: number, height: number) => {
    const restore = restoreAfterPrepend.current;
    scrollMetrics.current.contentHeight = height;
    if (restore) {
      // Older messages were added above: keep the message the reader was
      // looking at exactly where it was.
      restoreAfterPrepend.current = null;
      listRef.current?.scrollToOffset({ offset: restore.offset + (height - restore.contentHeight), animated: false });
    } else if (stickToBottom.current) {
      scrollToBottom(false);
    }
  }, [scrollToBottom]);

  const handleListLayout = useCallback((event: LayoutChangeEvent) => {
    scrollMetrics.current.layoutHeight = event.nativeEvent.layout.height;
    // The viewport itself changed (keyboard, banner, rotation): stay pinned.
    if (stickToBottom.current) scrollToBottom(false);
  }, [scrollToBottom]);

  const handleScroll = useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent;
    scrollMetrics.current = { offset: contentOffset.y, contentHeight: contentSize.height, layoutHeight: layoutMeasurement.height };
    const nearBottom = contentSize.height - (contentOffset.y + layoutMeasurement.height) < NEAR_BOTTOM_PX;
    stickToBottom.current = nearBottom;
    setShowJumpToLatest((current) => (current === !nearBottom ? current : !nearBottom));
  }, []);

  const handleLoadOlder = useCallback(() => {
    restoreAfterPrepend.current = { contentHeight: scrollMetrics.current.contentHeight, offset: scrollMetrics.current.offset };
    stickToBottom.current = false;
    void loadOlder();
  }, [loadOlder]);

  useEffect(() => {
    if (keyboardPadding > 0) scrollToLatest(false);
  }, [keyboardPadding, scrollToLatest]);

  const draftLength = chatBodyLength(draft.trim());
  const overLimit = draftLength > CHAT_MESSAGE_MAX_LENGTH;
  const canSend = draftLength > 0 && !overLimit && thread.status === 'ready';

  // The draft is mirrored in a ref because two taps (or Enter + a tap) can
  // land in the same tick, before React has re-rendered with the cleared
  // state. The ref is emptied synchronously, so the second attempt finds
  // nothing left to send — one press, one message.
  const draftRef = useRef('');
  const updateDraft = useCallback((text: string) => {
    draftRef.current = text;
    setDraft(text);
  }, []);

  const toggleSelected = useCallback((messageId: string) => {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(messageId)) next.delete(messageId);
      else next.add(messageId);
      return next;
    });
  }, []);

  const handleSend = useCallback(() => {
    const text = draftRef.current;
    const result = send(text);
    if (!result.ok) return;
    updateDraft('');
    setSelectedIds(new Set());
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

  // Runs inside the press that chose camera/gallery, so the system picker
  // opens within the user's gesture.
  const handlePick = useCallback((source: ChatImageSource) => {
    setAttachSheetVisible(false);
    setPickError(null);
    setPreparingImage(true);
    void pickChatImage(source).then((result) => {
      setPreparingImage(false);
      if (result.ok) {
        setPickedImage(result.image);
      } else if (result.reason === 'permission_denied') {
        setPickError(
          source === 'camera'
            ? 'אין הרשאה למצלמה. אפשרו גישה למצלמה בהגדרות המכשיר ונסו שוב.'
            : 'אין הרשאה לתמונות. אפשרו גישה לתמונות בהגדרות המכשיר ונסו שוב.'
        );
      } else if (result.reason !== 'cancelled') {
        setPickError(chatImageProblemMessage(result.reason));
      }
    });
  }, []);

  const handleAttachPress = useCallback(() => {
    // A desktop browser has no camera capture flow — "take a photo" would
    // just open the same file dialog — so go straight to choosing a file.
    const desktop =
      Platform.OS === 'web' &&
      typeof window !== 'undefined' &&
      Boolean(window.matchMedia?.('(pointer: fine)').matches) &&
      !window.matchMedia?.('(pointer: coarse)').matches;
    if (desktop) handlePick('library');
    else setAttachSheetVisible(true);
  }, [handlePick]);

  const handleSendImage = useCallback(
    (caption: string) => {
      if (!pickedImage) return;
      const result = sendImage(pickedImage, caption);
      if (result.ok) {
        // The store now owns the image (and releases it when it is done).
        setPickedImage(null);
        scrollToLatest(true);
      } else {
        setPickError(
          result.reason === 'too_long' ? 'הכיתוב ארוך מדי.' : 'לא ניתן לשלוח את התמונה כרגע. נסו שוב.'
        );
      }
    },
    [pickedImage, sendImage, scrollToLatest]
  );

  const cancelPickedImage = useCallback(() => {
    releasePreparedChatImage(pickedImage);
    setPickedImage(null);
  }, [pickedImage]);

  const confirmDelete = useCallback(async () => {
    if (!deleteTarget || deleting) return;
    setDeleting(true);
    if (deleteTarget.length === 1) await remove(deleteTarget[0].id);
    else await removeMany(deleteTarget.map((message) => message.id));
    setDeleting(false);
    setDeleteTarget(null);
    setSelectedIds(new Set());
  }, [deleteTarget, deleting, remove, removeMany]);

  const confirmClearForMe = useCallback(async () => {
    if (deleting) return;
    setDeleting(true);
    const cleared = await clearForMe();
    setDeleting(false);
    if (cleared) {
      setClearForMeVisible(false);
      setShowConversationActions(false);
      setSelectedIds(new Set());
    }
  }, [clearForMe, deleting]);

  const confirmClearForEveryone = useCallback(async () => {
    if (deleting) return;
    if (clearEveryoneStep === 1) {
      setClearEveryoneStep(2);
      return;
    }
    if (clearEveryoneStep !== 2) return;
    setDeleting(true);
    const cleared = await clearForEveryone();
    setDeleting(false);
    if (cleared) {
      setClearEveryoneStep(0);
      setShowConversationActions(false);
      setSelectedIds(new Set());
    }
  }, [clearEveryoneStep, clearForEveryone, deleting]);

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
          isPrivate={isPrivate}
          canRemove={isPrivate ? item.isMine : conversation.canModerate || item.isMine}
          selected={selectedIds.has(item.message.id)}
          selectionMode={selectionMode}
          sendError={sendErrors[item.message.id]}
          imageMaxWidth={imageMaxWidth}
          onSelect={toggleSelected}
          onRequestDelete={(message) => setDeleteTarget([message])}
          onRetry={retry}
          onDiscard={discard}
          onOpenImage={setViewerMessage}
        />
      );
    },
    [usersById, isPrivate, conversation.canModerate, selectedIds, sendErrors, imageMaxWidth, retry, discard, toggleSelected]
  );

  const readOnlyReason = impersonatingUserId
    ? 'בזמן התחזות לבן משפחה אחר הצ׳אט מוצג בשמכם ולקריאה בלבד.'
    : testModeUserId
      ? 'במצב בדיקה הצ׳אט מוצג בשמכם ולקריאה בלבד.'
      : otherLeft
        ? `${otherName} כבר לא חלק מהמשפחה. אפשר לקרוא את השיחה, אבל לא לשלוח בה הודעות.`
        : null;

  // Physical order, left to right (the web build lays out LTR; native is
  // pinned to match): mute, title, avatar, back. Hebrew readers get the back
  // control and the conversation's identity at the right-hand edge.
  const header = (
    <View style={[styles.headerBand, isPrivate && styles.headerBandPrivate]}>
      <View style={styles.header}>
        <Pressable
          onPress={() => setShowConversationActions((visible) => !visible)}
          accessibilityRole="button"
          accessibilityLabel="אפשרויות שיחה"
          accessibilityState={{ expanded: showConversationActions }}
          style={({ pressed }) => [styles.headerButton, pressed && styles.pressed]}
        >
          <RtlText style={styles.headerMenuLabel}>⋯</RtlText>
        </Pressable>
        {isSupabaseConfigured && thread.status === 'ready' ? (
          <Pressable
            onPress={() => void setMuted(!conversation.notificationsMuted)}
            accessibilityRole="switch"
            accessibilityState={{ checked: !conversation.notificationsMuted }}
            accessibilityLabel="התראות על הודעות חדשות בשיחה הזו"
            style={({ pressed }) => [styles.headerButton, pressed && styles.pressed]}
          >
            <BellIcon
              color={conversation.notificationsMuted ? colors.textSecondary : colors.primaryDark}
              muted={conversation.notificationsMuted}
            />
          </Pressable>
        ) : null}
        <View style={styles.headerText}>
          <RtlText style={styles.title} accessibilityRole="header" numberOfLines={1}>
            {isPrivate ? otherName : 'הצ׳אט המשפחתי'}
          </RtlText>
          {isPrivate ? (
            <View style={styles.privateLine}>
              <RtlText style={styles.privateLabel} numberOfLines={1}>שיחה פרטית · רק שניכם רואים אותה</RtlText>
              <LockGlyph color={colors.primaryDark} size={13} />
            </View>
          ) : (
            <RtlText style={styles.subtitle} numberOfLines={1}>
              {memberCount > 0 ? `פרטי למשפחה בלבד · ${memberCount} בני משפחה` : 'פרטי למשפחה בלבד'}
            </RtlText>
          )}
        </View>
        {isPrivate ? (
          <Avatar emoji={other?.avatar ?? FORMER_MEMBER.avatar} color={other?.color ?? FORMER_MEMBER.color} photoUrl={other?.photoUrl} size={40} />
        ) : showBack ? (
          <FamilyChatGlyph size={40} />
        ) : null}
        {showBack ? (
          <Pressable
            onPress={closeConversation}
            accessibilityRole="button"
            accessibilityLabel="חזרה לרשימת הצ׳אטים"
            style={({ pressed }) => [styles.backButton, pressed && styles.pressed]}
          >
            <Svg width={22} height={22} viewBox="0 0 24 24" accessibilityElementsHidden>
              <Path d="M9 5l7 7-7 7" stroke={colors.textPrimary} strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" fill="none" />
            </Svg>
          </Pressable>
        ) : null}
      </View>
    </View>
  );

  let body: React.ReactNode;
  if (thread.status === 'idle' || thread.status === 'loading') {
    body = (
      <View style={styles.centered}>
        <ActivityIndicator color={colors.primary} accessibilityLabel="טוען…" />
        <RtlText style={styles.centeredText}>טוענים את ההודעות…</RtlText>
      </View>
    );
  } else if (thread.status === 'error') {
    body = (
      <View style={styles.centered}>
        <EmptyState
          emoji={online ? '😕' : '📡'}
          title={online ? 'לא הצלחנו לטעון את השיחה' : 'אין חיבור לאינטרנט'}
          subtitle={online ? 'בדקו את החיבור ונסו שוב.' : 'ההודעות ייטענו ברגע שהחיבור יחזור.'}
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
          onLayout={handleListLayout}
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
            isPrivate ? (
              <EmptyState
                emoji="🔒"
                title="שיחה פרטית"
                subtitle={`רק את/ה ו${otherName} רואים את ההודעות כאן. גם מנהלי המשפחה לא.`}
              />
            ) : (
              <EmptyState
                emoji="💬"
                title="עדיין אין הודעות"
                subtitle="כאן כל המשפחה מתעדכנת במקום אחד. כתבו את ההודעה הראשונה."
              />
            )
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

  const showComposer = thread.status === 'ready' && !readOnlyReason;
  const audienceLabel = isPrivate ? `ל${otherName}, בשיחה פרטית` : 'לכל המשפחה';

  return (
    <View style={styles.flex}>
      <KeyboardAvoidingView
        style={[styles.flex, keyboardPadding > 0 && { paddingBottom: keyboardPadding }]}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        {header}

        {selectionMode && thread.status === 'ready' ? (
          <View style={styles.selectionToolbar}>
            <RtlText style={styles.selectionLabel}>{`נבחרו ${selectedIds.size} הודעות`}</RtlText>
            <Pressable
              onPress={() => setDeleteTarget(messages.filter((message) => selectedIds.has(message.id) && !message.deletedAt))}
              accessibilityRole="button"
              accessibilityLabel={`מחיקת ${selectedIds.size} הודעות נבחרות`}
              style={styles.selectionDelete}
            >
              <RtlText style={styles.rowActionDanger}>מחיקת הודעות</RtlText>
            </Pressable>
            <Pressable onPress={() => setSelectedIds(new Set())} accessibilityRole="button" style={styles.rowAction}>
              <RtlText style={styles.rowActionMuted}>ביטול בחירה</RtlText>
            </Pressable>
          </View>
        ) : null}

        {showConversationActions && !selectionMode ? (
          <View style={styles.conversationActions}>
            <Pressable onPress={() => setClearForMeVisible(true)} accessibilityRole="button" style={styles.conversationAction}>
              <RtlText style={styles.conversationActionText}>ניקוי השיחה אצלי</RtlText>
            </Pressable>
            {conversation.kind === 'family' && conversation.canModerate ? (
              <Pressable onPress={() => setClearEveryoneStep(1)} accessibilityRole="button" style={styles.conversationAction}>
                <RtlText style={styles.conversationActionDanger}>מחיקת השיחה לכולם</RtlText>
              </Pressable>
            ) : null}
          </View>
        ) : null}

        <View style={styles.banners}>
        {!online ? (
          <View style={[styles.banner, styles.bannerWarning]}>
            <RtlText style={[styles.bannerText, styles.bannerTextWarning]} accessibilityRole="alert" accessibilityLiveRegion="polite">
              אין חיבור לאינטרנט. הודעות שתכתבו יישלחו כשהחיבור יחזור.
            </RtlText>
          </View>
        ) : thread.status === 'ready' && live !== 'live' ? (
          <View style={[styles.banner, styles.bannerInfo]}>
            <RtlText style={styles.bannerText} accessibilityLiveRegion="polite">
              מתחברים מחדש לעדכונים חיים…
            </RtlText>
          </View>
        ) : null}

        {actionError || pickError ? (
          <Pressable
            onPress={() => {
              clearActionError();
              setPickError(null);
            }}
            accessibilityRole="button"
            accessibilityHint="הקשה סוגרת את ההודעה"
            style={[styles.banner, styles.bannerDanger]}
          >
            <RtlText style={[styles.bannerText, styles.bannerTextDanger]} accessibilityRole="alert" accessibilityLiveRegion="polite">
              {pickError ?? actionError}
            </RtlText>
          </Pressable>
        ) : null}
        </View>

        <View style={styles.bodyWrap}>{body}</View>

        {thread.status === 'ready' && readOnlyReason ? (
          <View style={styles.readOnlyBar}>
            <RtlText style={styles.readOnlyText}>{readOnlyReason}</RtlText>
          </View>
        ) : null}

        {showComposer ? (
          <View style={styles.composerOuter}>
            <View style={styles.composer}>
              {capabilities.images ? (
                <Pressable
                  onPress={handleAttachPress}
                  disabled={preparingImage}
                  accessibilityRole="button"
                  accessibilityLabel="צירוף תמונה"
                  accessibilityState={{ busy: preparingImage }}
                  style={({ pressed }) => [styles.attachButton, pressed && styles.pressed]}
                >
                  {preparingImage ? (
                    <ActivityIndicator color={colors.primaryDark} accessibilityLabel="טוען…" />
                  ) : (
                    <CameraIcon color={colors.primaryDark} />
                  )}
                </Pressable>
              ) : null}
              <View style={styles.inputWrap}>
                <TextInput
                  value={draft}
                  onChangeText={updateDraft}
                  onFocus={() => scrollToLatest(false)}
                  onKeyPress={handleKeyPress as never}
                  placeholder={isPrivate ? `הודעה פרטית ל${otherName}…` : 'כתבו הודעה למשפחה…'}
                  placeholderTextColor={colors.textSecondary}
                  accessibilityLabel={isPrivate ? `הודעה פרטית חדשה ל${otherName}` : 'הודעה חדשה לצ׳אט המשפחתי'}
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

      <ChatAttachSheet visible={attachSheetVisible} onPick={handlePick} onClose={() => setAttachSheetVisible(false)} />
      <ChatImagePreview image={pickedImage} audienceLabel={audienceLabel} onSend={handleSendImage} onCancel={cancelPickedImage} />
      <ChatImageViewer
        message={viewerMessage}
        senderName={
          viewerMessage?.senderUserId === myUserId
            ? 'אני'
            : (viewerMessage?.senderUserId && usersById.get(viewerMessage.senderUserId)?.name) || FORMER_MEMBER.name
        }
        onClose={() => setViewerMessage(null)}
      />

      <ConfirmModal
        visible={deleteTarget !== null}
        title={deleteTarget?.length === 1 ? 'למחוק את ההודעה?' : `למחוק ${deleteTarget?.length ?? 0} הודעות?`}
        message={
          isPrivate
            ? 'ההודעות יימחקו אצל שניכם, ואי אפשר יהיה לשחזר אותן. עותק שכבר נשמר במכשיר אחר עשוי להישאר שם.'
            : 'ההודעות יוסרו אצל כל בני המשפחה, ואי אפשר יהיה לשחזר אותן. עותק שכבר נשמר במכשיר אחר עשוי להישאר שם.'
        }
        confirmLabel="מחיקה"
        cancelLabel="ביטול"
        loading={deleting}
        onConfirm={() => void confirmDelete()}
        onCancel={() => {
          if (!deleting) setDeleteTarget(null);
        }}
      />
      <ConfirmModal
        visible={clearForMeVisible}
        title="לנקות את השיחה אצלך?"
        message="ההיסטוריה תוסתר רק בפרופיל הזה. בני המשפחה האחרים עדיין יראו את ההודעות והתמונות."
        confirmLabel="ניקוי אצלי"
        cancelLabel="ביטול"
        loading={deleting}
        onConfirm={() => void confirmClearForMe()}
        onCancel={() => { if (!deleting) setClearForMeVisible(false); }}
      />
      <ConfirmModal
        visible={clearEveryoneStep > 0}
        title={clearEveryoneStep === 1 ? 'למחוק את השיחה לכולם?' : 'אישור אחרון: למחוק לצמיתות?'}
        message={clearEveryoneStep === 1
          ? 'כל ההודעות והתמונות בצ׳אט המשפחתי יימחקו לכל בני המשפחה ולא ניתן יהיה לשחזר אותן. נדרשת עוד לחיצה אחת לאישור.'
          : 'הפעולה תמחק את תוכן ההודעות ואת קובצי התמונות מהשרת. להמשיך?'}
        confirmLabel={clearEveryoneStep === 1 ? 'המשך לאישור נוסף' : 'כן, למחוק לכולם'}
        cancelLabel="ביטול"
        loading={deleting}
        onConfirm={() => void confirmClearForEveryone()}
        onCancel={() => { if (!deleting) setClearEveryoneStep(0); }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  flex: { flex: 1 },
  pressed: { opacity: 0.75 },

  headerBand: { borderBottomWidth: 1, borderBottomColor: 'transparent' },
  // A private conversation is tinted so it can never be mistaken for the
  // family group at a glance.
  headerBandPrivate: { backgroundColor: colors.primarySoft, borderBottomColor: '#C5EBEE' },
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
    ...nativeDirection('ltr'),
  },
  privateLine: { flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: spacing.xs, marginTop: 2, ...nativeDirection('ltr') },
  privateLabel: { flexShrink: 1, ...typography.meta, fontWeight: '700', color: colors.primaryDark },
  backButton: {
    width: layout.minTouchTarget,
    height: layout.minTouchTarget,
    borderRadius: layout.minTouchTarget / 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  attachButton: {
    width: layout.minTouchTarget,
    height: layout.minTouchTarget,
    borderRadius: layout.minTouchTarget / 2,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primarySoft,
  },
  bubbleWithImage: { paddingHorizontal: spacing.sm, paddingTop: spacing.sm },
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
  headerMenuLabel: { fontSize: 23, lineHeight: 24, color: colors.primaryDark, fontWeight: '800' },
  selectionToolbar: {
    flexDirection: 'row-reverse', alignItems: 'center', flexWrap: 'wrap', gap: spacing.md,
    paddingHorizontal: layout.screenPadding, paddingVertical: spacing.sm,
    backgroundColor: colors.primarySoft, borderBottomWidth: 1, borderBottomColor: '#C5EBEE',
  },
  selectionLabel: { ...typography.meta, color: colors.textPrimary, fontWeight: '700' },
  selectionDelete: { minHeight: layout.minTouchTarget, justifyContent: 'center', paddingHorizontal: spacing.sm },
  selectionCheck: { width: 36, height: layout.minTouchTarget, alignItems: 'center', justifyContent: 'center' },
  conversationActions: {
    flexDirection: 'row-reverse', flexWrap: 'wrap', gap: spacing.md,
    paddingHorizontal: layout.screenPadding, paddingVertical: spacing.sm,
    backgroundColor: colors.surface, borderBottomWidth: 1, borderBottomColor: colors.border,
  },
  conversationAction: { minHeight: layout.minTouchTarget, justifyContent: 'center', paddingHorizontal: spacing.sm },
  conversationActionText: { ...typography.meta, color: colors.primaryDark, fontWeight: '700' },
  conversationActionDanger: { ...typography.meta, color: colors.danger, fontWeight: '800' },

  banners: {
    width: '100%',
    maxWidth: CHAT_COLUMN_MAX_WIDTH,
    alignSelf: 'center',
    paddingHorizontal: spacing.lg,
  },
  banner: {
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
    // Physical order on every platform: attach, field, send.
    ...nativeDirection('ltr'),
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
