import React, { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, Modal, Pressable, StyleSheet, View } from 'react-native';
import { colors } from '../theme/colors';
import { motion, radii, spacing } from '../theme/tokens';
import type { CompletionCelebration } from '../logic/walkCompletionCelebration';
import { RtlText } from './RtlText';
import { MascotSpriteAnimation } from './MascotFrameAnimation';
import { curatedSpriteForCelebration } from '../mascot/celebrationAnimationManifest';
import { MascotSafeZone } from './MascotSafeZone';

const COMPLETION_MASCOT = require('../../assets/branding/walkie-doggy-mascot-transparent.png');

interface WalkCompletionCelebrationProps {
  celebration: CompletionCelebration | null;
  onDismiss: () => void;
  anchor?: { x: number; y: number; width: number; height: number } | null;
}

/** A local, non-blocking post-completion moment. It has no persistence or sync role. */
export function WalkCompletionCelebration({ celebration, onDismiss, anchor }: WalkCompletionCelebrationProps) {
  const [reducedMotion, setReducedMotion] = useState(true);
  const [screenReaderEnabled, setScreenReaderEnabled] = useState(false);
  const [bubbleVisible, setBubbleVisible] = useState(false);
  const autoDismissTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Fail-safe default false: until confirmed on, behave as before (a
  // screen reader user who somehow isn't detected in time still gets the
  // explicit dismiss button/backdrop, never a permanently-stuck modal).
  const dismissRef = useRef(onDismiss);

  useEffect(() => {
    dismissRef.current = onDismiss;
  }, [onDismiss]);
  const opacity = useRef(new Animated.Value(0)).current;
  const translateY = useRef(new Animated.Value(18)).current;


  useEffect(() => {
    let mounted = true;
    AccessibilityInfo.isReduceMotionEnabled().then((enabled) => mounted && setReducedMotion(!!enabled)).catch(() => mounted && setReducedMotion(false));
    const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', setReducedMotion);
    AccessibilityInfo.isScreenReaderEnabled().then((enabled) => mounted && setScreenReaderEnabled(!!enabled)).catch(() => {});
    const srSubscription = AccessibilityInfo.addEventListener('screenReaderChanged', setScreenReaderEnabled);
    return () => { mounted = false; subscription?.remove?.(); srSubscription?.remove?.(); };
  }, []);

  useEffect(() => {
    if (!celebration) return;
    setBubbleVisible(reducedMotion);
    const bubbleTimer = reducedMotion ? null : setTimeout(() => setBubbleVisible(true), 650);
    opacity.setValue(reducedMotion ? 1 : 0);
    translateY.setValue(reducedMotion ? 0 : 18);
    if (!reducedMotion) {
      Animated.parallel([
        Animated.timing(opacity, { toValue: 1, duration: motion.feedback, useNativeDriver: true }),
        Animated.spring(translateY, { toValue: 0, damping: 16, stiffness: 180, mass: 0.8, useNativeDriver: true }),
      ]).start();
    }
    // Auto-dismiss is keyed to the celebration id rather than object identity,
    // so harmless parent re-renders cannot restart the timer indefinitely.
    if (autoDismissTimerRef.current) clearTimeout(autoDismissTimerRef.current);
    autoDismissTimerRef.current = setTimeout(() => dismissRef.current(), screenReaderEnabled ? 5000 : 2200);
    return () => { if (bubbleTimer) clearTimeout(bubbleTimer); };
  }, [celebration?.id, opacity, reducedMotion, screenReaderEnabled, translateY]);

  useEffect(() => () => {
    if (autoDismissTimerRef.current) clearTimeout(autoDismissTimerRef.current);
  }, []);

  if (!celebration) return null;
  const message = celebration.title;
  const sprite = curatedSpriteForCelebration(celebration.id);
  return (
    <Modal visible transparent animationType="none" onRequestClose={onDismiss} statusBarTranslucent>
      <Pressable style={styles.backdrop} onPress={onDismiss} accessibilityRole="button" accessibilityLabel="סגירת תגובת הקמע של Walkie Doggy Link">
        <MascotSafeZone from="left" anchor={anchor} testID="completion-mascot-safe-zone">
          <Animated.View style={[styles.moment, { opacity, transform: [{ translateY }] }]} accessibilityRole="alert" accessibilityLiveRegion="polite">
            {bubbleVisible ? (
              <View style={styles.speechBubbleWrap}>
                <View style={styles.bubble}><RtlText style={styles.message} numberOfLines={2}>{message}</RtlText></View>
                <View style={styles.tail} />
              </View>
            ) : null}
            <Animated.View style={{ transform: [{ scale: opacity.interpolate({ inputRange: [0, 1], outputRange: [0.94, 1] }) }] }}>
              {sprite ? (
                <MascotSpriteAnimation
                  source={sprite.source}
                  columns={sprite.columns}
                  rows={sprite.rows}
                  frameSize={sprite.frameSize}
                  frameCount={sprite.frameCount}
                  fps={sprite.fps}
                  size={84}
                  fallback={COMPLETION_MASCOT}
                  accessibilityLabel="הקמע של Walkie Doggy Link חוגג את סיום הטיול"
                  testID="completion-mascot-animation"
                />
              ) : null}
            </Animated.View>
            {celebration.confetti ? <RtlText style={styles.confetti} accessible={false}>✦  ✦  ✦</RtlText> : null}
          </Animated.View>
        </MascotSafeZone>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'transparent' },
  moment: { width: 96, alignItems: 'center' },
  // Compact diagonal speech bubble: it sits above-left of the mascot, over
  // the free space above the last-walk time, while the mascot itself remains
  // exactly centred in the gap between edit and pee/poop controls.
  speechBubbleWrap: { position: 'absolute', left: -58, top: -42, alignItems: 'flex-end', zIndex: 3 },
  bubble: { maxWidth: 154, backgroundColor: colors.surface, borderRadius: 22, paddingHorizontal: 12, paddingVertical: 8, shadowColor: '#0B5C75', shadowOpacity: 0.12, shadowRadius: 10, shadowOffset: { width: 0, height: 4 }, elevation: 4 },
  message: { color: colors.textPrimary, fontSize: 13, lineHeight: 17, fontWeight: '800', textAlign: 'center', writingDirection: 'rtl' },
  tail: { width: 13, height: 13, backgroundColor: colors.surface, transform: [{ rotate: '45deg' }], marginTop: -7, marginRight: 18 },
  confetti: { position: 'absolute', top: 64, color: colors.primary, fontSize: 24, letterSpacing: 10 },
  dismissButton: { minHeight: 44, paddingHorizontal: 18, justifyContent: 'center', marginTop: -6 },
  dismissText: { color: colors.textInverse, fontWeight: '700', fontSize: 14 },
});
