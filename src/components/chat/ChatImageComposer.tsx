import React, { useState } from 'react';
import { Image, KeyboardAvoidingView, Modal, Platform, Pressable, StyleSheet, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { RtlText } from '../RtlText';
import { Button } from '../Button';
import { colors } from '../../theme/colors';
import { layout, radii, spacing, typography } from '../../theme/tokens';
import { CHAT_MESSAGE_MAX_LENGTH, chatBodyLength, chatTextDirection } from '../../logic/chat';
import { formatChatImageBytes } from '../../logic/chatImages';
import type { ChatImageSource, PreparedChatImage } from '../../lib/chatImages';

interface ChatAttachSheetProps {
  visible: boolean;
  onPick: (source: ChatImageSource) => void;
  onClose: () => void;
}

/**
 * "Camera or gallery?" Each option's press handler is what opens the system
 * picker, synchronously — browsers only open a file/camera picker from
 * inside a user gesture.
 */
export function ChatAttachSheet({ visible, onPick, onClose }: ChatAttachSheetProps) {
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityRole="button" accessibilityLabel="סגירת בחירת תמונה">
        <Pressable style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, spacing.xl) }]} onPress={(e) => e.stopPropagation()}>
          <RtlText style={styles.title} accessibilityRole="header">שליחת תמונה</RtlText>
          <Pressable
            onPress={() => onPick('camera')}
            accessibilityRole="button"
            style={({ pressed }) => [styles.option, pressed && styles.pressed]}
          >
            <RtlText style={styles.optionIcon}>📷</RtlText>
            <RtlText style={styles.optionLabel}>צילום תמונה</RtlText>
          </Pressable>
          <Pressable
            onPress={() => onPick('library')}
            accessibilityRole="button"
            style={({ pressed }) => [styles.option, pressed && styles.pressed]}
          >
            <RtlText style={styles.optionIcon}>🖼️</RtlText>
            <RtlText style={styles.optionLabel}>בחירה מהגלריה</RtlText>
          </Pressable>
          <Pressable onPress={onClose} accessibilityRole="button" style={styles.cancel}>
            <RtlText style={styles.cancelText}>ביטול</RtlText>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

interface ChatImagePreviewProps {
  image: PreparedChatImage | null;
  /** Who will receive it, e.g. "לכל המשפחה" or "לנועה, בשיחה פרטית". */
  audienceLabel: string;
  onSend: (caption: string) => void;
  onCancel: () => void;
}

/** Shows exactly what will be sent, and to whom, before anything is uploaded. */
export function ChatImagePreview({ image, audienceLabel, onSend, onCancel }: ChatImagePreviewProps) {
  const insets = useSafeAreaInsets();
  const [caption, setCaption] = useState('');
  if (!image) return null;

  const length = chatBodyLength(caption.trim());
  const overLimit = length > CHAT_MESSAGE_MAX_LENGTH;
  const direction = chatTextDirection(caption);

  const close = () => {
    setCaption('');
    onCancel();
  };
  const send = () => {
    if (overLimit) return;
    const text = caption;
    setCaption('');
    onSend(text);
  };

  return (
    <Modal visible transparent={false} animationType="slide" onRequestClose={close}>
      <KeyboardAvoidingView style={styles.preview} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={[styles.previewHeader, { paddingTop: Math.max(insets.top, spacing.md) }]}>
          <RtlText style={styles.previewTitle} accessibilityRole="header">תצוגה מקדימה</RtlText>
          <RtlText style={styles.previewAudience}>{`תישלח ${audienceLabel}`}</RtlText>
        </View>

        <View style={styles.previewStage}>
          <Image source={{ uri: image.uri }} style={styles.previewImage} resizeMode="contain" accessibilityLabel="התמונה שתישלח" />
        </View>

        <View style={[styles.previewFooter, { paddingBottom: Math.max(insets.bottom, spacing.lg) }]}>
          <RtlText style={styles.previewMeta}>{`${image.width}×${image.height} · ${formatChatImageBytes(image.size)}`}</RtlText>
          <TextInput
            value={caption}
            onChangeText={setCaption}
            placeholder="הוסיפו כיתוב (לא חובה)"
            placeholderTextColor={colors.textSecondary}
            accessibilityLabel="כיתוב לתמונה"
            multiline
            maxLength={CHAT_MESSAGE_MAX_LENGTH * 2}
            style={[
              styles.captionInput,
              caption.length > 0 && { writingDirection: direction, textAlign: direction === 'rtl' ? 'right' : 'left' },
            ]}
          />
          {overLimit ? (
            <RtlText style={styles.captionError} accessibilityRole="alert">
              {`הכיתוב ארוך מדי: ${length.toLocaleString('en-US')} מתוך ${CHAT_MESSAGE_MAX_LENGTH.toLocaleString('en-US')} תווים`}
            </RtlText>
          ) : null}
          <View style={styles.previewActions}>
            <Button label="שליחה" onPress={send} disabled={overLimit} style={styles.flex} compact />
            <Button label="ביטול" onPress={close} variant="secondary" style={styles.flex} compact />
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  pressed: { opacity: 0.75 },
  backdrop: { flex: 1, backgroundColor: '#00000055', justifyContent: 'flex-end' },
  sheet: {
    width: '100%',
    maxWidth: 520,
    alignSelf: 'center',
    backgroundColor: colors.surface,
    borderTopLeftRadius: radii.xl,
    borderTopRightRadius: radii.xl,
    padding: spacing.xl,
    gap: spacing.sm,
  },
  title: { ...typography.sectionTitle, fontSize: 18, color: colors.textPrimary, textAlign: 'center', marginBottom: spacing.sm },
  // Physically ordered (icon at the right edge, like the rest of the app's rows on web).
  option: {
    minHeight: layout.rowHeight,
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.md,
    borderRadius: radii.md,
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colors.border,
  },
  optionIcon: { fontSize: 22 },
  optionLabel: { flex: 1, ...typography.body, color: colors.textPrimary },
  cancel: { minHeight: layout.minTouchTarget, alignItems: 'center', justifyContent: 'center', marginTop: spacing.xs },
  cancelText: { color: colors.textSecondary, fontSize: 15, fontWeight: '600', textAlign: 'center' },

  preview: { flex: 1, backgroundColor: colors.background },
  previewHeader: { paddingHorizontal: layout.screenPadding, paddingBottom: spacing.md, gap: 2 },
  previewTitle: { ...typography.screenTitle, color: colors.textPrimary },
  previewAudience: { ...typography.meta, color: colors.primaryDark, fontWeight: '700' },
  previewStage: { flex: 1, minHeight: 0, alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.lg },
  previewImage: { width: '100%', height: '100%', maxWidth: 720 },
  previewFooter: {
    width: '100%',
    maxWidth: 720,
    alignSelf: 'center',
    paddingHorizontal: layout.screenPadding,
    paddingTop: spacing.md,
    gap: spacing.sm,
  },
  previewMeta: { ...typography.caption, color: colors.textSecondary, textAlign: 'center' },
  captionInput: {
    minHeight: layout.minTouchTarget,
    maxHeight: 96,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    fontSize: 16,
    lineHeight: 22,
    color: colors.textPrimary,
    textAlign: 'right',
    writingDirection: 'rtl',
  },
  captionError: { ...typography.meta, color: colors.danger },
  previewActions: { flexDirection: 'row', gap: spacing.md },
});
