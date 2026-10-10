import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Image, Modal, Platform, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Line, Path } from 'react-native-svg';
import { RtlText } from '../RtlText';
import { colors } from '../../theme/colors';
import { layout, radii, spacing, typography } from '../../theme/tokens';
import { getChatTransport } from '../../lib/chat';
import { chatImageSaveStrategyFor, saveChatImage } from '../../lib/chatImages';
import { getLocalChatImagePreview } from '../../store/chatStore';
import {
  chatImageDisplaySize,
  chatImageFileName,
  chatImageSaveHint,
  chatImageSaveMessage,
  type ChatImageSaveOutcome,
} from '../../logic/chatImages';
import type { ChatMessage } from '../../types';

type LoadState = { status: 'loading' } | { status: 'ready'; uri: string } | { status: 'error' };

/**
 * Resolves something displayable for a message's image: the local preview if
 * this device sent it, otherwise a short-lived signed URL the server issues
 * only if this profile may read the image. Nothing is persisted.
 */
function useChatImageUri(message: ChatMessage): { state: LoadState; reload: () => void } {
  const path = message.attachment?.path;
  const localUri = message.upload?.localUri ?? (path ? getLocalChatImagePreview(path) : undefined);
  const [state, setState] = useState<LoadState>(localUri ? { status: 'ready', uri: localUri } : { status: 'loading' });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (localUri) {
      setState({ status: 'ready', uri: localUri });
      return undefined;
    }
    if (!path) {
      setState({ status: 'error' });
      return undefined;
    }
    let cancelled = false;
    setState({ status: 'loading' });
    getChatTransport()
      .getAttachmentUrl(path)
      .then((uri) => {
        if (!cancelled) setState({ status: 'ready', uri });
      })
      .catch(() => {
        if (!cancelled) setState({ status: 'error' });
      });
    return () => {
      cancelled = true;
    };
  }, [path, localUri, attempt]);

  const reload = useCallback(() => setAttempt((n) => n + 1), []);
  return { state, reload };
}

interface ChatImageBubbleProps {
  message: ChatMessage;
  maxWidth: number;
  senderName: string;
  onOpen: (message: ChatMessage) => void;
  onLongPress?: () => void;
  onCancelUpload: (messageId: string) => void;
}

/** The image inside a message bubble: sized from the stored dimensions so the list never jumps when it loads. */
export function ChatImageBubble({ message, maxWidth, senderName, onOpen, onLongPress, onCancelUpload }: ChatImageBubbleProps) {
  const attachment = message.attachment;
  const { state, reload } = useChatImageUri(message);
  // A signed URL can expire while the screen stays open: refetch once on a load failure.
  const retriedAfterLoadError = useRef(false);
  if (!attachment) return null;

  const size = chatImageDisplaySize(attachment, maxWidth, 320);
  const uploading = message.delivery === 'sending' && Boolean(message.upload);
  const percent = Math.round((message.upload?.progress ?? 0) * 100);

  return (
    <View style={[styles.frame, { width: size.width, height: size.height }]}>
      {state.status === 'ready' ? (
        <Pressable
          onPress={() => onOpen(message)}
          onLongPress={onLongPress}
          delayLongPress={350}
          disabled={uploading}
          accessibilityRole="imagebutton"
          accessibilityLabel={`תמונה מאת ${senderName}. הקשה מציגה אותה במסך מלא`}
          style={StyleSheet.absoluteFill}
        >
          <Image
            source={{ uri: state.uri }}
            style={StyleSheet.absoluteFill}
            resizeMode="cover"
            onError={() => {
              if (!message.upload && !retriedAfterLoadError.current) {
                retriedAfterLoadError.current = true;
                reload();
              }
            }}
          />
        </Pressable>
      ) : state.status === 'loading' ? (
        <View style={styles.centerFill}>
          <ActivityIndicator color={colors.primary} accessibilityLabel="טוען…" />
        </View>
      ) : (
        <Pressable onPress={reload} accessibilityRole="button" accessibilityLabel="התמונה אינה זמינה. הקשה לניסיון נוסף" style={styles.centerFill}>
          <RtlText style={styles.unavailable}>התמונה אינה זמינה</RtlText>
          <RtlText style={styles.unavailableAction}>נסו שוב</RtlText>
        </Pressable>
      )}

      {uploading ? (
        <View style={styles.uploadOverlay}>
          <View style={styles.progressTrack} accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: 100, now: percent }}>
            <View style={[styles.progressFill, { width: `${Math.max(4, percent)}%` }]} />
          </View>
          <RtlText style={styles.uploadLabel}>{`מעלה… ${percent}%`}</RtlText>
          <Pressable
            onPress={() => onCancelUpload(message.id)}
            accessibilityRole="button"
            accessibilityLabel="ביטול העלאת התמונה"
            hitSlop={8}
            style={({ pressed }) => [styles.cancelUpload, pressed && styles.pressed]}
          >
            <RtlText style={styles.cancelUploadLabel}>ביטול</RtlText>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

interface ChatImageViewerProps {
  message: ChatMessage | null;
  senderName: string;
  onClose: () => void;
}

/**
 * Full-screen viewer with "שמור תמונה". The image is fetched into memory when
 * the viewer opens, for two reasons: the picture shown and the file saved are
 * then the same bytes, and the share sheet can be opened inside the user's
 * tap (browsers refuse navigator.share() after an awaited download).
 */
export function ChatImageViewer({ message, senderName, onClose }: ChatImageViewerProps) {
  const insets = useSafeAreaInsets();
  const [displayUri, setDisplayUri] = useState<string | null>(null);
  const [blob, setBlob] = useState<Blob | null>(null);
  const [sourceUrl, setSourceUrl] = useState<string | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [saving, setSaving] = useState(false);
  const [outcome, setOutcome] = useState<ChatImageSaveOutcome | null>(null);

  const path = message?.attachment?.path;
  const localUri = message?.upload?.localUri ?? (path ? getLocalChatImagePreview(path) : undefined);

  useEffect(() => {
    setDisplayUri(null);
    setBlob(null);
    setSourceUrl(null);
    setLoadFailed(false);
    setOutcome(null);
    if (!path) return undefined;

    let cancelled = false;
    let objectUrl: string | null = null;
    (async () => {
      try {
        const url = localUri ?? (await getChatTransport().getAttachmentUrl(path));
        if (cancelled) return;
        setSourceUrl(url);
        if (Platform.OS !== 'web') {
          setDisplayUri(url);
          return;
        }
        const response = await fetch(url);
        if (!response.ok) throw new Error('image fetch failed');
        const data = await response.blob();
        if (cancelled) return;
        objectUrl = URL.createObjectURL(data);
        setBlob(data);
        setDisplayUri(objectUrl);
      } catch {
        if (!cancelled) setLoadFailed(true);
      }
    })();
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [path, localUri]);

  if (!message || !message.attachment) return null;
  const attachment = message.attachment;

  const strategy = chatImageSaveStrategyFor(blob, chatImageFileName(message.createdAt, attachment.mime), attachment.mime);
  // After a cancelled share nothing happened: fall back to the instructions.
  const hint = (outcome ? chatImageSaveMessage(outcome) : null) ?? chatImageSaveHint(strategy);
  const canSave = !saving && !loadFailed && Boolean(Platform.OS === 'web' ? blob : sourceUrl);

  const handleSave = async () => {
    if (!canSave) return;
    setSaving(true);
    const result = await saveChatImage({ blob, url: sourceUrl, createdAt: message.createdAt, mime: attachment.mime });
    setSaving(false);
    setOutcome(result);
  };

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <View style={styles.viewer}>
        <View style={styles.viewerStage}>
          {displayUri ? (
            <Image source={{ uri: displayUri }} style={styles.viewerImage} resizeMode="contain" accessibilityLabel={`תמונה מאת ${senderName}`} />
          ) : loadFailed ? (
            <RtlText style={styles.viewerMessage} accessibilityRole="alert">לא הצלחנו לטעון את התמונה. בדקו את החיבור ונסו שוב.</RtlText>
          ) : (
            <ActivityIndicator color={colors.textInverse} accessibilityLabel="טוען…" />
          )}
        </View>

        {/* Controls sit inside the safe area at both edges so they stay
            reachable under a notch and above the home indicator. */}
        <View style={[styles.viewerTop, { paddingTop: Math.max(insets.top, spacing.md) }]}>
          <Pressable
            onPress={onClose}
            accessibilityRole="button"
            accessibilityLabel="סגירת התמונה"
            style={({ pressed }) => [styles.viewerClose, pressed && styles.pressed]}
          >
            <Svg width={22} height={22} viewBox="0 0 24 24" accessibilityElementsHidden>
              <Line x1="5" y1="5" x2="19" y2="19" stroke={colors.textInverse} strokeWidth={2.4} strokeLinecap="round" />
              <Line x1="19" y1="5" x2="5" y2="19" stroke={colors.textInverse} strokeWidth={2.4} strokeLinecap="round" />
            </Svg>
          </Pressable>
          <RtlText style={styles.viewerTitle} numberOfLines={1}>{senderName}</RtlText>
        </View>

        <View style={[styles.viewerBottom, { paddingBottom: Math.max(insets.bottom, spacing.lg) }]}>
          {hint ? (
            <RtlText
              style={styles.viewerHint}
              accessibilityLiveRegion="polite"
              accessibilityRole={outcome === 'failed' ? 'alert' : undefined}
            >
              {hint}
            </RtlText>
          ) : null}
          <Pressable
            onPress={() => void handleSave()}
            disabled={!canSave}
            accessibilityRole="button"
            accessibilityLabel="שמור תמונה"
            accessibilityState={{ disabled: !canSave, busy: saving }}
            style={({ pressed }) => [styles.saveButton, !canSave && styles.saveButtonDisabled, pressed && canSave && styles.pressed]}
          >
            {saving ? (
              <ActivityIndicator color={colors.textInverse} accessibilityLabel="טוען…" />
            ) : (
              <>
                <Svg width={20} height={20} viewBox="0 0 24 24" accessibilityElementsHidden>
                  <Path d="M12 4v11M7 10.5l5 5 5-5M5 20h14" stroke={colors.textInverse} strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" fill="none" />
                </Svg>
                <RtlText style={styles.saveLabel}>שמור תמונה</RtlText>
              </>
            )}
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  pressed: { opacity: 0.75 },
  frame: { borderRadius: radii.md, overflow: 'hidden', backgroundColor: colors.surfaceMuted, marginBottom: spacing.xs },
  centerFill: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, alignItems: 'center', justifyContent: 'center', padding: spacing.sm, gap: 2 },
  unavailable: { ...typography.meta, color: colors.textSecondary, textAlign: 'center' },
  unavailableAction: { ...typography.meta, fontWeight: '700', color: colors.primaryDark, textAlign: 'center' },
  uploadOverlay: {
    position: 'absolute', top: 0, right: 0, bottom: 0, left: 0,
    backgroundColor: '#00000066',
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.md,
    gap: spacing.sm,
  },
  progressTrack: { width: '80%', height: 6, borderRadius: 3, backgroundColor: '#FFFFFF55', overflow: 'hidden' },
  progressFill: { height: 6, borderRadius: 3, backgroundColor: colors.textInverse },
  uploadLabel: { ...typography.caption, color: colors.textInverse, textAlign: 'center' },
  cancelUpload: {
    minHeight: 32,
    paddingHorizontal: spacing.md,
    borderRadius: radii.round,
    borderWidth: 1,
    borderColor: colors.textInverse,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cancelUploadLabel: { ...typography.caption, color: colors.textInverse, textAlign: 'center' },

  viewer: { flex: 1, backgroundColor: '#000000F2' },
  viewerStage: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  viewerImage: { width: '100%', height: '100%' },
  viewerMessage: { ...typography.body, color: colors.textInverse, textAlign: 'center', paddingHorizontal: spacing.xxl },
  viewerTop: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.md,
    backgroundColor: '#00000080',
  },
  viewerClose: {
    width: layout.minTouchTarget,
    height: layout.minTouchTarget,
    borderRadius: layout.minTouchTarget / 2,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFFFFF26',
  },
  viewerTitle: { flex: 1, ...typography.sectionTitle, color: colors.textInverse },
  viewerBottom: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.md,
    backgroundColor: '#00000080',
  },
  viewerHint: { ...typography.meta, color: colors.textInverse, textAlign: 'center', maxWidth: 420 },
  saveButton: {
    minHeight: 48,
    minWidth: 200,
    paddingHorizontal: spacing.xl,
    borderRadius: radii.round,
    backgroundColor: colors.primary,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
  },
  saveButtonDisabled: { opacity: 0.5 },
  saveLabel: { fontSize: 16, lineHeight: 22, fontWeight: '700', color: colors.textInverse, textAlign: 'center' },
});
