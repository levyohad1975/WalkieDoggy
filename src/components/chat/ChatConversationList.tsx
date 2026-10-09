import React, { useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import Svg, { Circle, Line, Path, Rect } from 'react-native-svg';
import { RtlText } from '../RtlText';
import { Avatar } from '../Avatar';
import { UserPickerModal } from '../UserPickerModal';
import { colors } from '../../theme/colors';
import { layout, nativeDirection, radii, spacing, typography } from '../../theme/tokens';
import { useChatStore } from '../../store/chatStore';
import { formatChatBadge, formatChatListTime, formatChatPreview } from '../../logic/chat';
import type { ChatConversationState, FamilyUser } from '../../types';

const ROW_AVATAR = 48;

export function FamilyChatGlyph({ size = ROW_AVATAR }: { size?: number }) {
  return (
    <View
      accessible={false}
      style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' }}
    >
      <Svg width={size * 0.5} height={size * 0.5} viewBox="0 0 24 24" accessibilityElementsHidden>
        <Circle cx="9" cy="8" r="3" stroke={colors.textInverse} strokeWidth={2} fill="none" />
        <Circle cx="17" cy="9" r="2.5" stroke={colors.textInverse} strokeWidth={2} fill="none" />
        <Path d="M3.5 20c.4-4 2.3-6 5.5-6s5.1 2 5.5 6M14 15c3.7-.8 6 1 6.5 4.5" stroke={colors.textInverse} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" fill="none" />
      </Svg>
    </View>
  );
}

export function LockGlyph({ color, size = 12 }: { color: string; size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" accessibilityElementsHidden>
      <Rect x="5" y="11" width="14" height="9" rx="2" stroke={color} strokeWidth={2.4} fill="none" />
      <Path d="M8 11V8a4 4 0 0 1 8 0v3" stroke={color} strokeWidth={2.4} strokeLinecap="round" fill="none" />
    </Svg>
  );
}

interface ChatConversationListProps {
  users: FamilyUser[];
  /** Highlights the open conversation in the desktop two-pane layout. */
  selectedConversationId?: string | null;
}

/**
 * The unified Chats list: the family group and the signed-in member's
 * private conversations, most recently active first, each with a
 * last-message preview and its own unread badge.
 */
export function ChatConversationList({ users, selectedConversationId }: ChatConversationListProps) {
  const conversations = useChatStore((s) => s.conversations);
  const capabilities = useChatStore((s) => s.capabilities);
  const openingDirect = useChatStore((s) => s.openingDirect);
  const openConversation = useChatStore((s) => s.openConversation);
  const startDirect = useChatStore((s) => s.startDirect);
  const [pickerVisible, setPickerVisible] = useState(false);

  const usersById = useMemo(() => new Map(users.map((u) => [u.id, u])), [users]);
  const myUserId = conversations[0]?.userId ?? null;
  const activeMembers = useMemo(() => users.filter((u) => !u.removedAt), [users]);
  const hasPrivate = conversations.some((c) => c.kind === 'direct');

  const renderRow = (conversation: ChatConversationState) => {
    const isFamily = conversation.kind === 'family';
    const other = conversation.otherUserId ? usersById.get(conversation.otherUserId) : undefined;
    const title = isFamily ? 'הצ׳אט המשפחתי' : other?.name ?? 'בן/בת משפחה';
    const lastSender = conversation.lastMessage?.senderUserId ? usersById.get(conversation.lastMessage.senderUserId) : undefined;
    const preview = formatChatPreview(conversation.lastMessage, {
      myUserId,
      kind: conversation.kind,
      senderName: lastSender?.name,
    });
    const badge = formatChatBadge(conversation.unreadCount);
    const time = conversation.lastMessage ? formatChatListTime(conversation.lastMessage.createdAt) : '';
    const selected = selectedConversationId === conversation.conversationId;
    const label = [
      isFamily ? 'הצ׳אט המשפחתי, כל המשפחה' : `שיחה פרטית עם ${title}`,
      badge ? `${badge} הודעות שלא נקראו` : null,
      preview,
    ]
      .filter(Boolean)
      .join('. ');

    return (
      <Pressable
        key={conversation.conversationId}
        onPress={() => openConversation(conversation.conversationId)}
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityState={{ selected }}
        style={({ pressed }) => [styles.row, selected && styles.rowSelected, pressed && styles.pressed]}
      >
        {/* Physical order, left to right: time + badge, text, avatar. */}
        <View style={styles.rowMeta}>
          <RtlText style={[styles.time, badge ? styles.timeUnread : null]} numberOfLines={1}>{time}</RtlText>
          {badge ? (
            <View style={styles.badge}>
              <RtlText allowFontScaling={false} style={styles.badgeText} numberOfLines={1}>{badge}</RtlText>
            </View>
          ) : conversation.notificationsMuted ? (
            <RtlText style={styles.mutedMark} accessibilityLabel="מושתק">🔕</RtlText>
          ) : null}
        </View>
        <View style={styles.rowText}>
          <View style={styles.titleLine}>
            {!isFamily ? (
              <View style={styles.privateTag}>
                <LockGlyph color={colors.primaryDark} />
                <RtlText style={styles.privateTagText}>פרטי</RtlText>
              </View>
            ) : null}
            <RtlText style={[styles.rowTitle, badge ? styles.rowTitleUnread : null]} numberOfLines={1}>{title}</RtlText>
          </View>
          <RtlText style={[styles.preview, badge ? styles.previewUnread : null]} numberOfLines={1}>{preview}</RtlText>
        </View>
        {isFamily ? (
          <FamilyChatGlyph />
        ) : (
          <Avatar emoji={other?.avatar ?? '🙂'} color={other?.color ?? colors.statusPending} photoUrl={other?.photoUrl} size={ROW_AVATAR} />
        )}
      </Pressable>
    );
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        {capabilities.privateConversations ? (
          <Pressable
            onPress={() => setPickerVisible(true)}
            disabled={openingDirect}
            accessibilityRole="button"
            accessibilityLabel="שיחה פרטית חדשה"
            style={({ pressed }) => [styles.newButton, pressed && styles.pressed]}
          >
            {openingDirect ? (
              <ActivityIndicator color={colors.primaryDark} accessibilityLabel="טוען…" />
            ) : (
              <Svg width={20} height={20} viewBox="0 0 24 24" accessibilityElementsHidden>
                <Line x1="12" y1="5" x2="12" y2="19" stroke={colors.primaryDark} strokeWidth={2.4} strokeLinecap="round" />
                <Line x1="5" y1="12" x2="19" y2="12" stroke={colors.primaryDark} strokeWidth={2.4} strokeLinecap="round" />
              </Svg>
            )}
          </Pressable>
        ) : null}
        <View style={styles.headerText}>
          <RtlText style={styles.title} accessibilityRole="header" numberOfLines={1}>צ׳אטים</RtlText>
          <RtlText style={styles.subtitle} numberOfLines={1}>המשפחה ושיחות פרטיות</RtlText>
        </View>
      </View>

      <ScrollView style={styles.scroll} contentContainerStyle={styles.listContent}>
        {conversations.map(renderRow)}
        {capabilities.privateConversations && !hasPrivate ? (
          <Pressable
            onPress={() => setPickerVisible(true)}
            accessibilityRole="button"
            style={({ pressed }) => [styles.hintCard, pressed && styles.pressed]}
          >
            <RtlText style={styles.hintTitle}>רוצים לדבר עם מישהו בפרטי?</RtlText>
            <RtlText style={styles.hintText}>בחרו בן/בת משפחה ופתחו שיחה ששניכם בלבד רואים.</RtlText>
          </Pressable>
        ) : null}
      </ScrollView>

      <UserPickerModal
        visible={pickerVisible}
        title="שיחה פרטית עם…"
        users={activeMembers}
        excludeUserId={myUserId ?? undefined}
        onSelect={(userId) => {
          setPickerVisible(false);
          void startDirect(userId);
        }}
        onClose={() => setPickerVisible(false)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  pressed: { opacity: 0.75 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: layout.screenPadding,
    paddingTop: spacing.md,
    paddingBottom: spacing.md,
    ...nativeDirection('ltr'),
  },
  headerText: { flex: 1, minWidth: 0 },
  title: { ...typography.screenTitle, color: colors.textPrimary },
  subtitle: { ...typography.meta, color: colors.textSecondary, marginTop: 2 },
  newButton: {
    width: layout.minTouchTarget,
    height: layout.minTouchTarget,
    borderRadius: layout.minTouchTarget / 2,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primarySoft,
    borderWidth: 1,
    borderColor: '#C5EBEE',
  },
  scroll: { flex: 1 },
  listContent: { paddingHorizontal: spacing.lg, paddingBottom: spacing.xl, gap: spacing.sm },
  row: {
    minHeight: 72,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    borderRadius: radii.lg,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    ...nativeDirection('ltr'),
  },
  rowSelected: { borderColor: colors.primary, backgroundColor: colors.primarySoft },
  rowMeta: { minWidth: 44, alignItems: 'flex-start', gap: spacing.xs },
  time: { ...typography.caption, fontWeight: '500', color: colors.textSecondary, writingDirection: 'ltr', textAlign: 'left' },
  timeUnread: { color: colors.primaryDark, fontWeight: '700' },
  badge: {
    minWidth: 22,
    height: 22,
    borderRadius: 11,
    paddingHorizontal: 6,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primaryDark,
  },
  badgeText: { fontSize: 12, lineHeight: 16, fontWeight: '800', color: colors.textInverse, textAlign: 'center', writingDirection: 'ltr' },
  mutedMark: { fontSize: 13 },
  rowText: { flex: 1, minWidth: 0, gap: 2 },
  titleLine: { flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: spacing.sm },
  rowTitle: { flexShrink: 1, ...typography.body, fontWeight: '700', color: colors.textPrimary },
  rowTitleUnread: { fontWeight: '800' },
  privateTag: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: radii.round,
    backgroundColor: colors.primarySoft,
  },
  privateTagText: { ...typography.caption, color: colors.primaryDark },
  preview: { ...typography.meta, color: colors.textSecondary },
  previewUnread: { color: colors.textPrimary, fontWeight: '700' },
  hintCard: {
    marginTop: spacing.sm,
    padding: spacing.lg,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.border,
    borderStyle: 'dashed',
    gap: spacing.xs,
  },
  hintTitle: { ...typography.cardTitle, color: colors.textPrimary },
  hintText: { ...typography.meta, color: colors.textSecondary },
});
