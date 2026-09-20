import React, { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, Modal, Pressable, StyleSheet, View } from 'react-native';
import { colors } from '../theme/colors';
import { motion, radii, spacing } from '../theme/tokens';
import type { CompletionCelebration } from '../logic/walkCompletionCelebration';
import { RtlText } from './RtlText';
import { resolveCelebrationAsset } from './celebrationAssets';
import { MascotFrameAnimation } from './MascotFrameAnimation';
import { animationManifestFor } from '../mascot/celebrationAnimationManifest';

interface WalkCompletionCelebrationProps {
  celebration: CompletionCelebration | null;
  onDismiss: () => void;
}

/** A local, non-blocking post-completion moment. It has no persistence or sync role. */
export function WalkCompletionCelebration({ celebration, onDismiss }: WalkCompletionCelebrationProps) {
  const [reducedMotion, setReducedMotion] = useState(true);
  const opacity = useRef(new Animated.Value(0)).current;
  const translateY = useRef(new Animated.Value(18)).current;

  useEffect(() => {
    let mounted = true;
    AccessibilityInfo.isReduceMotionEnabled().then((enabled) => mounted && setReducedMotion(!!enabled)).catch(() => mounted && setReducedMotion(false));
    const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', setReducedMotion);
    return () => { mounted = false; subscription?.remove?.(); };
  }, []);

  useEffect(() => {
    if (!celebration) return;
    opacity.setValue(reducedMotion ? 1 : 0);
    translateY.setValue(reducedMotion ? 0 : 18);
    if (!reducedMotion) {
      Animated.parallel([
        Animated.timing(opacity, { toValue: 1, duration: motion.feedback, useNativeDriver: true }),
        Animated.spring(translateY, { toValue: 0, damping: 16, stiffness: 180, mass: 0.8, useNativeDriver: true }),
      ]).start();
    }
    const timer = setTimeout(onDismiss, 3600);
    return () => clearTimeout(timer);
  }, [celebration, onDismiss, opacity, reducedMotion, translateY]);

  if (!celebration) return null;
  const asset = resolveCelebrationAsset(celebration.asset);
  const manifest = animationManifestFor(celebration);
  const message = celebration.title;
  return (
    <Modal visible transparent animationType="none" onRequestClose={onDismiss} statusBarTranslucent>
      <Pressable style={styles.backdrop} onPress={onDismiss} accessibilityRole="button" accessibilityLabel="סגירת תגובת הקמע של Walkie Doggy Link">
        <Animated.View style={[styles.moment, { opacity, transform: [{ translateY }] }]} accessibilityRole="alert">
          <View style={styles.bubble}><RtlText style={styles.message} numberOfLines={2}>{message}</RtlText></View>
          <View style={styles.tail} />
          <MascotFrameAnimation frames={asset.frames} fallback={asset.fallbackSource} fps={manifest?.fps ?? 12} size={220} accessibilityLabel="הקמע של Walkie Doggy Link מגיב לסיום הטיול" testID="completion-mascot-animation" />
          {celebration.confetti ? <RtlText style={styles.confetti} accessible={false}>✦  ✦  ✦</RtlText> : null}
          <Pressable onPress={onDismiss} style={styles.dismissButton} accessibilityRole="button" accessibilityLabel="המשך לאפליקציה"><RtlText style={styles.dismissText}>המשך</RtlText></Pressable>
        </Animated.View>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(11, 39, 48, 0.34)', alignItems: 'center', justifyContent: 'center', padding: spacing.xl },
  moment: { width: '100%', maxWidth: 420, alignItems: 'center' },
  bubble: { maxWidth: 285, backgroundColor: colors.surface, borderRadius: radii.xl, paddingHorizontal: spacing.xl, paddingVertical: 13, shadowColor: '#0B5C75', shadowOpacity: 0.16, shadowRadius: 18, shadowOffset: { width: 0, height: 8 }, elevation: 6 },
  message: { color: colors.textPrimary, fontSize: 20, fontWeight: '800', textAlign: 'center', writingDirection: 'rtl' },
  tail: { width: 20, height: 20, backgroundColor: colors.surface, transform: [{ rotate: '45deg' }, { translateY: -10 }], marginBottom: -12 },
  confetti: { position: 'absolute', top: 85, color: colors.primary, fontSize: 24, letterSpacing: 10 },
  dismissButton: { minHeight: 44, paddingHorizontal: 18, justifyContent: 'center', marginTop: -6 },
  dismissText: { color: colors.textInverse, fontWeight: '700', fontSize: 14 },
});
