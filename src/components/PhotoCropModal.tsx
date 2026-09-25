import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Image, Modal, PanResponder, Platform, Pressable, StyleSheet, View } from 'react-native';
import { RtlText } from './RtlText';
import { Button } from './Button';
import { colors } from '../theme/colors';
import { radii, spacing, typography } from '../theme/tokens';

const VIEWPORT_SIZE = 280;
const OUTPUT_SIZE = 720;
const MIN_ZOOM = 1;
const MAX_ZOOM = 3;
const ZOOM_STEP = 0.25;

interface PhotoCropModalProps {
  visible: boolean;
  uri: string | null;
  onConfirm: (croppedUri: string) => void;
  onCancel: () => void;
}

/**
 * Web-only profile-photo crop/zoom/pan step (PRD §12). Native iOS/Android
 * already get OS-native crop UI from expo-image-picker's
 * `allowsEditing: true, aspect: [1, 1]` (see uploadImage.ts) — Web gets
 * nothing at all from that option, which is the actual gap this closes.
 * Deliberately zero new native dependencies: pan uses PanResponder
 * (already core React Native), zoom is simple +/- step buttons (no
 * pinch-gesture math to maintain), and the real pixel crop is produced
 * with a plain HTML5 <canvas>, created on demand only on confirm. Mirrors
 * webPush.ts's `Platform.OS === 'web'` gating convention — this component
 * is mounted unconditionally by PhotoCropHost but renders null off-web.
 */
export function PhotoCropModal({ visible, uri, onConfirm, onCancel }: PhotoCropModalProps) {
  const [naturalSize, setNaturalSize] = useState<{ width: number; height: number } | null>(null);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const panStart = useRef({ x: 0, y: 0 });
  const panRef = useRef(pan);
  panRef.current = pan;

  useEffect(() => {
    if (!visible || !uri) return;
    setZoom(1);
    setPan({ x: 0, y: 0 });
    setNaturalSize(null);
    Image.getSize(
      uri,
      (width, height) => setNaturalSize({ width, height }),
      () => setNaturalSize({ width: VIEWPORT_SIZE, height: VIEWPORT_SIZE }),
    );
  }, [visible, uri]);

  const baseScale = naturalSize
    ? Math.max(VIEWPORT_SIZE / naturalSize.width, VIEWPORT_SIZE / naturalSize.height)
    : 1;
  const scale = baseScale * zoom;
  const displayedWidth = naturalSize ? naturalSize.width * scale : VIEWPORT_SIZE;
  const displayedHeight = naturalSize ? naturalSize.height * scale : VIEWPORT_SIZE;
  const maxPanX = Math.max(0, (displayedWidth - VIEWPORT_SIZE) / 2);
  const maxPanY = Math.max(0, (displayedHeight - VIEWPORT_SIZE) / 2);

  const clampPan = useCallback(
    (x: number, y: number) => ({
      x: Math.min(maxPanX, Math.max(-maxPanX, x)),
      y: Math.min(maxPanY, Math.max(-maxPanY, y)),
    }),
    [maxPanX, maxPanY],
  );

  // Re-clamp whenever zoom (or a freshly loaded image's natural size)
  // shrinks the pannable range, so a pan set at a lower zoom can't leave
  // the image edge visible inside the viewport after zooming back out.
  useEffect(() => {
    setPan((prev) => clampPan(prev.x, prev.y));
  }, [clampPan]);

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderGrant: () => {
          panStart.current = panRef.current;
        },
        onPanResponderMove: (_evt, gestureState) => {
          setPan(clampPan(panStart.current.x + gestureState.dx, panStart.current.y + gestureState.dy));
        },
      }),
    [clampPan],
  );

  const handleZoomIn = () => setZoom((z) => Math.min(MAX_ZOOM, +(z + ZOOM_STEP).toFixed(2)));
  const handleZoomOut = () => setZoom((z) => Math.max(MIN_ZOOM, +(z - ZOOM_STEP).toFixed(2)));

  const handleConfirm = useCallback(() => {
    if (!uri) return;
    if (Platform.OS !== 'web' || typeof document === 'undefined' || !naturalSize) {
      onConfirm(uri);
      return;
    }
    const left = (VIEWPORT_SIZE - displayedWidth) / 2 + pan.x;
    const top = (VIEWPORT_SIZE - displayedHeight) / 2 + pan.y;
    const srcX = -left / scale;
    const srcY = -top / scale;
    const srcW = VIEWPORT_SIZE / scale;
    const srcH = VIEWPORT_SIZE / scale;

    const img = new window.Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = OUTPUT_SIZE;
      canvas.height = OUTPUT_SIZE;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        onConfirm(uri);
        return;
      }
      ctx.drawImage(img, srcX, srcY, srcW, srcH, 0, 0, OUTPUT_SIZE, OUTPUT_SIZE);
      canvas.toBlob(
        (blob) => {
          if (!blob) {
            onConfirm(uri);
            return;
          }
          onConfirm(URL.createObjectURL(blob));
        },
        'image/jpeg',
        0.9,
      );
    };
    img.onerror = () => onConfirm(uri);
    img.src = uri;
  }, [uri, naturalSize, displayedWidth, displayedHeight, pan, scale, onConfirm]);

  if (Platform.OS !== 'web') return null;

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <View style={styles.backdrop}>
        <View style={styles.card}>
          <RtlText style={styles.title} accessibilityRole="header">
            מיקום ותקריב לתמונה
          </RtlText>
          <RtlText style={styles.hint}>גררו כדי למקם, ולחצו +/- כדי להתקרב או להתרחק.</RtlText>

          <View style={styles.viewport} {...panResponder.panHandlers}>
            {uri ? (
              <Image
                source={{ uri }}
                accessibilityIgnoresInvertColors
                style={{
                  position: 'absolute',
                  width: displayedWidth,
                  height: displayedHeight,
                  left: (VIEWPORT_SIZE - displayedWidth) / 2 + pan.x,
                  top: (VIEWPORT_SIZE - displayedHeight) / 2 + pan.y,
                }}
                resizeMode="cover"
              />
            ) : null}
          </View>

          <View style={styles.zoomRow}>
            <Pressable
              onPress={handleZoomOut}
              style={styles.zoomButton}
              accessibilityRole="button"
              accessibilityLabel="התרחקות"
              disabled={zoom <= MIN_ZOOM}
            >
              <RtlText style={styles.zoomButtonText}>－</RtlText>
            </Pressable>
            <Pressable
              onPress={handleZoomIn}
              style={styles.zoomButton}
              accessibilityRole="button"
              accessibilityLabel="התקרבות"
              disabled={zoom >= MAX_ZOOM}
            >
              <RtlText style={styles.zoomButtonText}>＋</RtlText>
            </Pressable>
          </View>

          <Button label="אישור" onPress={handleConfirm} style={styles.confirmButton} />
          <Button label="ביטול" variant="secondary" onPress={onCancel} style={styles.cancelButton} />
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: '#00000077', alignItems: 'center', justifyContent: 'center', padding: spacing.lg },
  card: { backgroundColor: colors.surface, borderRadius: radii.xl, padding: spacing.lg, alignItems: 'center', width: '100%', maxWidth: 360 },
  title: { fontSize: 17, fontWeight: '700', color: colors.textPrimary, textAlign: 'center', marginBottom: spacing.xs },
  hint: { ...typography.meta, color: colors.textSecondary, textAlign: 'center', marginBottom: spacing.md },
  viewport: {
    width: VIEWPORT_SIZE,
    height: VIEWPORT_SIZE,
    borderRadius: radii.round,
    overflow: 'hidden',
    backgroundColor: colors.surfaceMuted,
    borderWidth: 1,
    borderColor: colors.border,
  },
  zoomRow: { flexDirection: 'row', gap: spacing.md, marginTop: spacing.md },
  zoomButton: {
    width: 44,
    height: 44,
    borderRadius: radii.round,
    backgroundColor: colors.surfaceMuted,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  zoomButtonText: { fontSize: 20, fontWeight: '700', color: colors.textPrimary },
  confirmButton: { marginTop: spacing.lg, width: '100%' },
  cancelButton: { marginTop: spacing.xs, width: '100%' },
});
