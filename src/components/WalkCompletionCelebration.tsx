import React, { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, Image, Modal, Pressable, StyleSheet, View } from 'react-native';
import { colors } from '../theme/colors';
import { motion, radii, spacing } from '../theme/tokens';
import type { CompletionCelebration } from '../logic/walkCompletionCelebration';
import { RtlText } from './RtlText';
import { MascotFrameAnimation } from './MascotFrameAnimation';
import { MascotPoseCelebration } from './MascotPoseCelebration';
import { framesForCelebration, highFivePoseForCelebration, MASCOT_FRAME_FPS } from '../mascot/celebrationAnimationManifest';
import { MascotSafeZone } from './MascotSafeZone';

const COMPLETION_MASCOT = require('../../assets/branding/walkie-doggy-mascot-transparent.png');
const HIGH_FIVE_V2 = require('../../assets/branding/walkie-high-five-v2-final.webp');
const HIGH_FIVE_V2_IDS = new Set(['high-five', 'paw-party']);
const HIGH_FIVE_V2_DURATION_MS = 5100;

// Real-device QA round 8 — roughly doubled from the previous 84 (within
// the requested ~160-170 range) per direct real-iPhone feedback that the
// mascot "lacks presence" at the old size. Applies to every celebration
// variant (both the MascotPoseCelebration and MascotFrameAnimation render
// branches below use this same constant), not just one. The anchor box
// itself is untouched — MascotSafeZone's `anchoredStage` already renders
// with `overflow: 'visible'`, so the larger mascot is free to extend
// beyond the Last Walk card's own bounds without being clipped or
// shifting any surrounding layout.
const CELEBRATION_MASCOT_SIZE = 168;

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
  // Real-device QA round 8 — "keep the speech bubble synchronized with the
  // mascot's arrival": now that the entrance is a real, visible slide
  // across the screen (not a small in-place appear), the bubble must wait
  // for BOTH the mascot to be ready (asset loaded) AND the entrance slide
  // to have actually finished — otherwise it could appear while the
  // character is still mid-flight. Reset together with bubbleVisible
  // whenever a new celebration starts; the effect below combines them.
  const [mascotReady, setMascotReady] = useState(false);
  const [entranceArrived, setEntranceArrived] = useState(false);
  const autoDismissTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Fail-safe default false: until confirmed on, behave as before (a
  // screen reader user who somehow isn't detected in time still gets the
  // explicit dismiss button/backdrop, never a permanently-stuck modal).
  const dismissRef = useRef(onDismiss);

  useEffect(() => {
    dismissRef.current = onDismiss;
  }, [onDismiss]);
  // Real-device QA round 7 — this used to be a SECOND, fully independent
  // animated opacity layer (0->1) stacked directly on top of
  // MascotSafeZone's own opacity+translateX entrance animation, with a
  // THIRD layer (scale) derived from it, around a plain <Image> rendering
  // real per-pixel alpha content via background-image CSS. Frame-by-frame
  // analysis of real-iPhone footage found a solid gray rectangle, shaped
  // exactly like the Image's own bounding box with the mascot's opaque
  // silhouette cut out of it — i.e. the transparent regions of the PNG
  // were painting a neutral backing-store fill instead of true
  // transparency. The one thing that structurally differs between this
  // component (reported broken) and every other MascotSafeZone consumer
  // in this app (ReminderMascotPrompt — a single opacity layer via
  // MascotSafeZone only, never reported) is this redundant second
  // independently-animating opacity layer: a known WebKit defect class is
  // nested/stacked animated-opacity compositing layers mishandling alpha
  // content underneath. `scale` replaces `opacity` as a plain, directly
  // animated value (no second opacity layer at all) — MascotSafeZone's own
  // single fade still provides the entrance, and the pop-in/settle motion
  // is unchanged; only the redundant opacity layer is removed.
  const scale = useRef(new Animated.Value(0.94)).current;
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

  // Real-device QA round 6 — `high-five`/`paw-party` render through
  // MascotPoseCelebration (a single static pose, animated purely via
  // transforms) instead of MascotFrameAnimation's discrete-frame-swap
  // technique, which reproduced a different real-device-only rendering
  // symptom on every one of three straight attempts. See
  // celebrationAnimationManifest.ts's own doc comment above HIGH_FIVE_POSE
  // for the full history. highFivePose takes priority: frames is only
  // consulted for every OTHER celebration, unaffected by this change.
  const usesHighFiveV2 = !!celebration && HIGH_FIVE_V2_IDS.has(celebration.id);
  const highFivePose = celebration && !usesHighFiveV2 ? highFivePoseForCelebration(celebration.id) : undefined;
  const frames = celebration && !usesHighFiveV2 && !highFivePose ? framesForCelebration(celebration.id) : undefined;

  useEffect(() => {
    if (!celebration || !motionChecked) return;
    // Real-device QA fix — the bubble used to appear on a fixed 360ms
    // timer, racing the mascot's own actual paint: on a real iPhone the
    // bubble could appear before the mascot was visibly rendered and
    // animating at all. It is now gated on the mascot being ready AND
    // having arrived (see the mascotReady/entranceArrived effect below)
    // instead — reduced motion and "no sprite mapped for this
    // celebration" are the only cases with nothing to wait for, so the
    // bubble still appears immediately there.
    setBubbleVisible(reducedMotion || (!usesHighFiveV2 && !frames && !highFivePose));
    setMascotReady(false);
    setEntranceArrived(false);
    scale.setValue(reducedMotion ? 1 : 0.94);
    translateY.setValue(reducedMotion ? 0 : 18);
    if (!reducedMotion) {
      Animated.parallel([
        Animated.timing(scale, { toValue: 1, duration: motion.feedback, useNativeDriver: true }),
        Animated.spring(translateY, { toValue: 0, damping: 16, stiffness: 180, mass: 0.8, useNativeDriver: true }),
      ]).start();
    }
    // Auto-dismiss is keyed to the celebration id rather than object identity,
    // so harmless parent re-renders cannot restart the timer indefinitely.
    if (autoDismissTimerRef.current) clearTimeout(autoDismissTimerRef.current);
    const visualDuration = usesHighFiveV2 && !reducedMotion ? HIGH_FIVE_V2_DURATION_MS : 2600;
    const dismissDelay = screenReaderEnabled ? Math.max(6500, visualDuration + 1200) : visualDuration;
    autoDismissTimerRef.current = setTimeout(() => dismissRef.current(), dismissDelay);
  }, [celebration?.id, frames, highFivePose, usesHighFiveV2, motionChecked, scale, reducedMotion, screenReaderEnabled, translateY]);

  // Real-device QA round 8 — the bubble reveals once BOTH the mascot is
  // ready and the entrance slide has actually arrived, so it never shows
  // while the character is still sliding in from off-screen.
  useEffect(() => {
    if (mascotReady && entranceArrived) setBubbleVisible(true);
  }, [mascotReady, entranceArrived]);

  useEffect(() => () => {
    if (autoDismissTimerRef.current) clearTimeout(autoDismissTimerRef.current);
  }, []);

  if (!celebration) return null;
  const message = celebration.title;
  return (
    <Modal visible transparent animationType="none" onRequestClose={onDismiss} statusBarTranslucent>
      <Pressable style={styles.backdrop} onPress={onDismiss} accessibilityRole="button" accessibilityLabel="סגירת תגובת הקמע של Walkie Doggy Link">
        <MascotSafeZone from="left" anchor={anchor} testID="completion-mascot-safe-zone" onEntranceComplete={() => setEntranceArrived(true)}>
          <Animated.View style={[styles.moment, { transform: [{ translateY }] }]} accessibilityRole="alert" accessibilityLiveRegion="polite">
            {bubbleVisible ? (
              <View style={styles.speechBubbleWrap}>
                <View style={styles.bubble}><RtlText style={styles.message} numberOfLines={2}>{message}</RtlText></View>
                <View style={styles.tail} />
              </View>
            ) : null}
            <Animated.View style={{ transform: [{ scale }] }}>
              {usesHighFiveV2 ? (
                <Image
                  source={reducedMotion ? COMPLETION_MASCOT : HIGH_FIVE_V2}
                  style={styles.v2Mascot}
                  resizeMode="contain"
                  accessibilityLabel="הקמע של Walkie Doggy Link חוגג את סיום הטיול"
                  testID="completion-mascot-animation"
                  onLoad={() => setMascotReady(true)}
                />
              ) : highFivePose ? (
                <MascotPoseCelebration
                  pose={highFivePose}
                  size={CELEBRATION_MASCOT_SIZE}
                  fallback={COMPLETION_MASCOT}
                  accessibilityLabel="הקמע של Walkie Doggy Link חוגג את סיום הטיול"
                  testID="completion-mascot-animation"
                  onReady={() => setMascotReady(true)}
                />
              ) : frames ? (
                <MascotFrameAnimation
                  frames={frames}
                  fps={MASCOT_FRAME_FPS}
                  size={CELEBRATION_MASCOT_SIZE}
                  fallback={COMPLETION_MASCOT}
                  accessibilityLabel="הקמע של Walkie Doggy Link חוגג את סיום הטיול"
                  testID="completion-mascot-animation"
                  onReady={() => setMascotReady(true)}
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
  // Real-device QA round 8 — widened to match CELEBRATION_MASCOT_SIZE (168,
  // doubled from the previous 84/96) so the mascot's own bounding box no
  // longer exceeds its layout container; MascotSafeZone's anchoredStage
  // still renders with overflow: visible, so this never clips the larger
  // character, it only keeps the speech bubble's relative offsets correct.
  moment: { width: 168, alignItems: 'center' },
  v2Mascot: { width: CELEBRATION_MASCOT_SIZE, height: CELEBRATION_MASCOT_SIZE },
  // Compact diagonal speech bubble: it sits above-left of the mascot, over
  // the free space above the last-walk time, while the mascot itself remains
  // exactly centred in the gap between edit and pee/poop controls.
  // Real-device QA round 8 — offsets scaled ~2x alongside the mascot size
  // (84 -> 168) so the bubble keeps the same relative position against the
  // now much larger character instead of appearing to sit too close/overlap.
  speechBubbleWrap: { position: 'absolute', left: -88, top: -76, alignItems: 'flex-end', zIndex: 3 },
  bubble: { maxWidth: 154, backgroundColor: colors.surface, borderRadius: 22, paddingHorizontal: 12, paddingVertical: 8, shadowColor: '#0B5C75', shadowOpacity: 0.12, shadowRadius: 10, shadowOffset: { width: 0, height: 4 }, elevation: 4 },
  message: { color: colors.textPrimary, fontSize: 13, lineHeight: 17, fontWeight: '800', textAlign: 'center', writingDirection: 'rtl' },
  tail: { width: 13, height: 13, backgroundColor: colors.surface, transform: [{ rotate: '45deg' }], marginTop: -7, marginRight: 12 },
  confetti: { position: 'absolute', top: 64, color: colors.primary, fontSize: 24, letterSpacing: 10 },
  dismissButton: { minHeight: 44, paddingHorizontal: 18, justifyContent: 'center', marginTop: -6 },
  dismissText: { color: colors.textInverse, fontWeight: '700', fontSize: 14 },
});
