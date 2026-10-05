import React, { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, Modal, Pressable, StyleSheet, View } from 'react-native';
import { colors } from '../theme/colors';
import { motion, radii, spacing } from '../theme/tokens';
import type { CompletionCelebration } from '../logic/walkCompletionCelebration';
import { RtlText } from './RtlText';
import { MascotFrameAnimation } from './MascotFrameAnimation';
import { framesForCelebration, MASCOT_FRAME_FPS } from '../mascot/celebrationAnimationManifest';
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
  // Real-device QA fix — `reducedMotion` is fail-safe-default-true above,
  // which briefly reads as "reduced motion is on" before the real async
  // check resolves. The bubble effect below used to run immediately on
  // that default and show the bubble right away, then correct itself a
  // tick later once the real value landed — a visible flash of the bubble
  // before the mascot had even started preloading, on every normal
  // (non-reduced-motion) device. Gating that effect on `motionChecked`
  // too means it only ever runs once, with the real answer.
  const [motionChecked, setMotionChecked] = useState(false);
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
    AccessibilityInfo.isReduceMotionEnabled()
      .then((enabled) => { if (mounted) { setReducedMotion(!!enabled); setMotionChecked(true); } })
      .catch(() => { if (mounted) { setReducedMotion(false); setMotionChecked(true); } });
    const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', setReducedMotion);
    AccessibilityInfo.isScreenReaderEnabled().then((enabled) => mounted && setScreenReaderEnabled(!!enabled)).catch(() => {});
    const srSubscription = AccessibilityInfo.addEventListener('screenReaderChanged', setScreenReaderEnabled);
    return () => { mounted = false; subscription?.remove?.(); srSubscription?.remove?.(); };
  }, []);

  const frames = celebration ? framesForCelebration(celebration.id) : undefined;

  useEffect(() => {
    if (!celebration || !motionChecked) return;
    // Real-device QA fix — the bubble used to appear on a fixed 360ms
    // timer, racing the mascot's own actual paint: on a real iPhone the
    // bubble could appear before the mascot was visibly rendered and
    // animating at all. It is now gated on MascotFrameAnimation's own
    // onReady callback below (fired once every frame has actually
    // finished loading and playback is starting) instead — reduced motion
    // and "no sprite mapped for this celebration" are the only cases with
    // nothing to wait for, so the bubble still appears immediately there.
    setBubbleVisible(reducedMotion || !frames);
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
    autoDismissTimerRef.current = setTimeout(() => dismissRef.current(), screenReaderEnabled ? 5000 : 2600);
  }, [celebration?.id, frames, motionChecked, opacity, reducedMotion, screenReaderEnabled, translateY]);

  useEffect(() => () => {
    if (autoDismissTimerRef.current) clearTimeout(autoDismissTimerRef.current);
  }, []);

  if (!celebration) return null;
  const message = celebration.title;
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
              {frames ? (
                <MascotFrameAnimation
                  frames={frames}
                  fps={MASCOT_FRAME_FPS}
                  // Real-device QA round 5 — reverted the round-4 bump to
                  // 92 (unproven: direct pixel inspection of the frame
                  // assets found the subject already covers ~50% of its
                  // 256x256 canvas, not under-sized) back to the original
                  // approved 84, per "keep approximately the current
                  // visual size" — this round's real regressions (timing,
                  // the reported black rectangle) were never about size.
                  size={84}
                  fallback={COMPLETION_MASCOT}
                  accessibilityLabel="הקמע של Walkie Doggy Link חוגג את סיום הטיול"
                  testID="completion-mascot-animation"
                  onReady={() => setBubbleVisible(true)}
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
  speechBubbleWrap: { position: 'absolute', left: -44, top: -38, alignItems: 'flex-end', zIndex: 3 },
  bubble: { maxWidth: 154, backgroundColor: colors.surface, borderRadius: 22, paddingHorizontal: 12, paddingVertical: 8, shadowColor: '#0B5C75', shadowOpacity: 0.12, shadowRadius: 10, shadowOffset: { width: 0, height: 4 }, elevation: 4 },
  message: { color: colors.textPrimary, fontSize: 13, lineHeight: 17, fontWeight: '800', textAlign: 'center', writingDirection: 'rtl' },
  tail: { width: 13, height: 13, backgroundColor: colors.surface, transform: [{ rotate: '45deg' }], marginTop: -7, marginRight: 12 },
  confetti: { position: 'absolute', top: 64, color: colors.primary, fontSize: 24, letterSpacing: 10 },
  dismissButton: { minHeight: 44, paddingHorizontal: 18, justifyContent: 'center', marginTop: -6 },
  dismissText: { color: colors.textInverse, fontWeight: '700', fontSize: 14 },
});
