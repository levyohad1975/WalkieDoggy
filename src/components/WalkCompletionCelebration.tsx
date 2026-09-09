import React, { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, Modal, Pressable, StyleSheet, View } from 'react-native';
import { colors } from '../theme/colors';
import { motion, radii, spacing, typography } from '../theme/tokens';
import type { CompletionCelebration } from '../logic/walkCompletionCelebration';
import { RtlText } from './RtlText';
import { WalkieMascot } from './WalkieMascot';

interface WalkCompletionCelebrationProps {
  celebration: CompletionCelebration | null;
  dogName?: string;
  onDismiss: () => void;
}

/** A local, non-blocking post-completion moment. It has no persistence or sync role. */
export function WalkCompletionCelebration({ celebration, dogName, onDismiss }: WalkCompletionCelebrationProps) {
  const [reducedMotion, setReducedMotion] = useState(true);
  const opacity = useRef(new Animated.Value(0)).current;
  const translateY = useRef(new Animated.Value(18)).current;
  const scale = useRef(new Animated.Value(0.96)).current;

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
    scale.setValue(reducedMotion ? 1 : 0.96);
    if (!reducedMotion) {
      Animated.parallel([
        Animated.timing(opacity, { toValue: 1, duration: motion.feedback, useNativeDriver: true }),
        Animated.spring(translateY, { toValue: 0, damping: 16, stiffness: 180, mass: 0.8, useNativeDriver: true }),
        Animated.spring(scale, { toValue: 1, damping: 14, stiffness: 200, mass: 0.8, useNativeDriver: true }),
      ]).start();
    }
    const timer = setTimeout(onDismiss, 3600);
    return () => clearTimeout(timer);
  }, [celebration, onDismiss, opacity, reducedMotion, scale, translateY]);

  if (!celebration) return null;
  return (
    <Modal visible transparent animationType="none" onRequestClose={onDismiss} statusBarTranslucent>
      <View style={styles.backdrop} accessibilityViewIsModal>
        <Animated.View style={[styles.card, { opacity, transform: [{ translateY }, { scale }] }]} accessibilityRole="alert">
          {celebration.confetti ? <RtlText style={styles.confetti} accessible={false}>✦  •  ✦  •  ✦</RtlText> : null}
          <Pressable onPress={onDismiss} style={styles.close} accessibilityRole="button" accessibilityLabel="סגירת חגיגת סיום הטיול" hitSlop={10}>
            <RtlText style={styles.closeText}>×</RtlText>
          </Pressable>
          <View style={styles.mascotWrap}>
            <WalkieMascot state="success" size={132} accessibilityLabel="טופי חוגג/ת את סיום הטיול" />
            <View style={styles.accent}><RtlText style={styles.accentText}>{celebration.accent}</RtlText></View>
          </View>
          <RtlText style={styles.eyebrow}>{celebration.eyebrow}</RtlText>
          <RtlText style={styles.title}>{celebration.title}</RtlText>
          <RtlText style={styles.message}>{dogName ? celebration.message.replace('טופי', dogName) : celebration.message}</RtlText>
          <Pressable onPress={onDismiss} style={styles.dismissButton} accessibilityRole="button" accessibilityLabel="המשך לאפליקציה">
            <RtlText style={styles.dismissText}>המשך</RtlText>
          </Pressable>
        </Animated.View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(11, 39, 48, 0.48)', alignItems: 'center', justifyContent: 'center', padding: spacing.xl },
  card: { width: '100%', maxWidth: 420, alignItems: 'center', backgroundColor: colors.surface, borderRadius: radii.xl, paddingHorizontal: spacing.xl, paddingTop: spacing.xxl, paddingBottom: spacing.lg, overflow: 'hidden', shadowColor: '#0B5C75', shadowOpacity: 0.22, shadowRadius: 24, shadowOffset: { width: 0, height: 12 }, elevation: 10 },
  confetti: { position: 'absolute', top: spacing.md, color: colors.primary, fontSize: 20, letterSpacing: 5 },
  close: { position: 'absolute', top: spacing.md, right: spacing.md, width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surfaceMuted, zIndex: 1 },
  closeText: { fontSize: 26, lineHeight: 30, color: colors.textSecondary },
  mascotWrap: { width: 144, height: 144, alignItems: 'center', justifyContent: 'center', marginBottom: spacing.sm },
  accent: { position: 'absolute', bottom: 0, right: 0, minWidth: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.primarySoft, borderWidth: 1, borderColor: colors.primary + '44' },
  accentText: { fontSize: 20 },
  eyebrow: { ...typography.caption, color: colors.primaryDark, textAlign: 'center', letterSpacing: 0.5 },
  title: { ...typography.screenTitle, color: colors.textPrimary, textAlign: 'center', marginTop: spacing.xs },
  message: { ...typography.body, color: colors.textSecondary, textAlign: 'center', marginTop: spacing.sm, lineHeight: 24 },
  dismissButton: { width: '100%', minHeight: 48, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.primary, borderRadius: radii.lg, marginTop: spacing.xl },
  dismissText: { ...typography.sectionTitle, color: colors.textInverse },
});
