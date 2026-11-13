import React, { useCallback, useEffect, useRef, useState } from 'react';
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
const HAPPY_JUMP_V2 = require('../../assets/branding/walkie-happy-jump-v2-final.webp');
const THANK_YOU_HEART_V2 = require('../../assets/branding/walkie-thank-you-heart-v2-final.webp');
const SLEEPY_GOOD_NIGHT_V2 = require('../../assets/branding/walkie-sleepy-good-night-v2-final.webp');
const TROPHY_V2 = require('../../assets/branding/walkie-trophy-v2-final.webp');

const V2_CELEBRATIONS: Record<string, { source: number; durationMs: number }> = {
  'high-five': { source: HIGH_FIVE_V2, durationMs: 5100 },
  'happy-jump': { source: HAPPY_JUMP_V2, durationMs: 5100 },
  'thank-you-heart': { source: THANK_YOU_HEART_V2, durationMs: 5100 },
  'sleepy-good-night': { source: SLEEPY_GOOD_NIGHT_V2, durationMs: 5100 },
  'trophy-teaser': { source: TROPHY_V2, durationMs: 5100 },
};

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

/**
 * Owner report 2026-11-13: "the animations don't appear after every walk".
 * Each V2 asset is ~1 MB; the 5.1 s display window used to start at mount,
 * so on a slow connection the asset could still be downloading when the
 * celebration auto-dismissed — nothing was ever seen. Now the display window
 * starts only once the mascot has actually loaded, and if it hasn't loaded
 * within this long the static mascot (small, already cached) is shown instead.
 */
export const CELEBRATION_LOAD_TIMEOUT_MS = 2500;

/**
 * Renders the given celebration's animated asset invisibly so the browser
 * downloads and caches it ahead of time (Home mounts this while a walk is
 * about to end). Renders nothing for celebrations without a V2 asset.
 */
export function CelebrationAssetWarmup({ celebrationId }: { celebrationId: string }) {
  const v2 = V2_CELEBRATIONS[celebrationId];
  if (!v2) return null;
  return (
    <View pointerEvents="none" style={styles.warmup} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <Image source={v2.source} style={styles.warmupImage} />
    </View>
  );
}

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
  // True once the animated asset missed CELEBRATION_LOAD_TIMEOUT_MS: switch
  // to the static mascot so there is always something to see.
  const [loadTimedOut, setLoadTimedOut] = useState(false);
  const loadTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
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
  const v2Celebration = celebration ? V2_CELEBRATIONS[celebration.id] : undefined;
  const highFivePose = celebration && !v2Celebration ? highFivePoseForCelebration(celebration.id) : undefined;
  const frames = celebration && !v2Celebration && !highFivePose ? framesForCelebration(celebration.id) : undefined;

  // Per-celebration readiness resets only when a NEW celebration starts —
  // never when the reduced-motion check resolves, or an asset that already
  // loaded (onLoad fired first) would be forgotten and time out needlessly.
  const mascotReadyRef = useRef(false);
  const markMascotReady = useCallback(() => {
    mascotReadyRef.current = true;
    setMascotReady(true);
  }, []);
  useEffect(() => {
    mascotReadyRef.current = false;
    setMascotReady(false);
    setEntranceArrived(false);
    setLoadTimedOut(false);
  }, [celebration?.id]);

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
    setBubbleVisible(reducedMotion || (!v2Celebration && !frames && !highFivePose));
    scale.setValue(reducedMotion ? 1 : 0.94);
    translateY.setValue(reducedMotion ? 0 : 18);
    if (!reducedMotion) {
      Animated.parallel([
        Animated.timing(scale, { toValue: 1, duration: motion.feedback, useNativeDriver: true }),
        Animated.spring(translateY, { toValue: 0, damping: 16, stiffness: 180, mass: 0.8, useNativeDriver: true }),
      ]).start();
    }
    if (loadTimeoutRef.current) clearTimeout(loadTimeoutRef.current);
    // The animated asset may still be downloading: give it a bounded wait,
    // then fall back to the static mascot (see CELEBRATION_LOAD_TIMEOUT_MS).
    // A cached asset can finish loading before this effect even runs, so
    // the ref is checked rather than assuming it hasn't loaded yet.
    if (v2Celebration && !reducedMotion && !mascotReadyRef.current) {
      loadTimeoutRef.current = setTimeout(() => {
        if (!mascotReadyRef.current) setLoadTimedOut(true);
      }, CELEBRATION_LOAD_TIMEOUT_MS);
    }
  }, [celebration?.id, frames, highFivePose, v2Celebration, motionChecked, scale, reducedMotion, translateY]);

  // Auto-dismiss is keyed to the celebration id rather than object identity,
  // so harmless parent re-renders cannot restart the timer indefinitely. For
  // the animated V2 assets the window starts only once the mascot is actually
  // on screen (mascotReady), so a slow download no longer eats the whole
  // display time; everything else starts immediately, as before.
  const waitsForMascot = !!v2Celebration && !reducedMotion;
  const dismissClockStarted = !!celebration && motionChecked && (!waitsForMascot || mascotReady || loadTimedOut);
  useEffect(() => {
    if (!dismissClockStarted) {
      // A new celebration resets readiness — drop a timer started on stale state.
      if (autoDismissTimerRef.current) clearTimeout(autoDismissTimerRef.current);
      return;
    }
    if (loadTimeoutRef.current) clearTimeout(loadTimeoutRef.current);
    if (autoDismissTimerRef.current) clearTimeout(autoDismissTimerRef.current);
    const visualDuration = v2Celebration && !reducedMotion && !loadTimedOut ? v2Celebration.durationMs : 2600;
    const dismissDelay = screenReaderEnabled ? Math.max(6500, visualDuration + 1200) : visualDuration;
    autoDismissTimerRef.current = setTimeout(() => dismissRef.current(), dismissDelay);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- started once per celebration; see comment above
  }, [celebration?.id, dismissClockStarted]);

  // Real-device QA round 8 — the bubble reveals once BOTH the mascot is
  // ready and the entrance slide has actually arrived, so it never shows
  // while the character is still sliding in from off-screen.
  useEffect(() => {
    if ((mascotReady || loadTimedOut) && entranceArrived) setBubbleVisible(true);
  }, [mascotReady, loadTimedOut, entranceArrived]);

  useEffect(() => () => {
    if (autoDismissTimerRef.current) clearTimeout(autoDismissTimerRef.current);
    if (loadTimeoutRef.current) clearTimeout(loadTimeoutRef.current);
  }, []);

  if (!celebration) return null;
  const message = celebration.title;
  return (
    <Modal visible transparent animationType="none" onRequestClose={onDismiss} statusBarTranslucent>
      <Pressable style={styles.backdrop} onPress={onDismiss} accessibilityRole="button" accessibilityLabel="סגירת תגובת הקמע של Walkie Doggy Link">
        <MascotSafeZone from="left" anchor={anchor ?? null} testID="completion-mascot-safe-zone" onEntranceComplete={() => setEntranceArrived(true)}>
          <Animated.View style={[styles.moment, { transform: [{ translateY }] }]} accessibilityRole="alert" accessibilityLiveRegion="polite">
            {bubbleVisible ? (
              <View style={styles.speechBubbleWrap}>
                <View style={styles.bubble}><RtlText style={styles.message} numberOfLines={2}>{message}</RtlText></View>
                <View style={styles.tail} />
              </View>
            ) : null}
            <Animated.View style={{ transform: [{ scale }] }}>
              {v2Celebration ? (
                <Image
                  source={reducedMotion || loadTimedOut ? COMPLETION_MASCOT : v2Celebration.source}
                  style={styles.v2Mascot}
                  resizeMode="contain"
                  accessibilityLabel="הקמע של Walkie Doggy Link חוגג את סיום הטיול"
                  testID="completion-mascot-animation"
                  onLoad={markMascotReady}
                />
              ) : highFivePose ? (
                <MascotPoseCelebration
                  pose={highFivePose}
                  size={CELEBRATION_MASCOT_SIZE}
                  fallback={COMPLETION_MASCOT}
                  accessibilityLabel="הקמע של Walkie Doggy Link חוגג את סיום הטיול"
                  testID="completion-mascot-animation"
                  onReady={markMascotReady}
                />
              ) : frames ? (
                <MascotFrameAnimation
                  frames={frames}
                  fps={MASCOT_FRAME_FPS}
                  size={CELEBRATION_MASCOT_SIZE}
                  fallback={COMPLETION_MASCOT}
                  accessibilityLabel="הקמע של Walkie Doggy Link חוגג את סיום הטיול"
                  testID="completion-mascot-animation"
                  onReady={markMascotReady}
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
  warmup: { position: 'absolute', width: 1, height: 1, opacity: 0, overflow: 'hidden', left: -10, top: -10 },
  warmupImage: { width: 1, height: 1 },
  // Compact diagonal speech bubble: it sits above-left of the mascot, over
  // the free space above the last-walk time, while the mascot itself remains
  // exactly centred in the gap between edit and pee/poop controls.
  // Real-device QA round 8 — offsets scaled ~2x alongside the mascot size
  // (84 -> 168) so the bubble keeps the same relative position against the
  // now much larger character instead of appearing to sit too close/overlap.
  speechBubbleWrap: { position: 'absolute', left: -78, top: -64, alignItems: 'flex-end', zIndex: 3 },
  bubble: { minWidth: 96, maxWidth: 142, minHeight: 64, backgroundColor: colors.surface, borderRadius: 999, paddingHorizontal: 16, paddingVertical: 10, alignItems: 'center', justifyContent: 'center', shadowColor: '#0B5C75', shadowOpacity: 0.12, shadowRadius: 10, shadowOffset: { width: 0, height: 4 }, elevation: 4 },
  message: { color: colors.textPrimary, fontSize: 13, lineHeight: 17, fontWeight: '800', textAlign: 'center', writingDirection: 'rtl' },
  tail: { width: 14, height: 14, backgroundColor: colors.surface, transform: [{ rotate: '45deg' }], marginTop: -8, marginRight: 24 },
  confetti: { position: 'absolute', top: 64, color: colors.primary, fontSize: 24, letterSpacing: 10 },
  dismissButton: { minHeight: 44, paddingHorizontal: 18, justifyContent: 'center', marginTop: -6 },
  dismissText: { color: colors.textInverse, fontWeight: '700', fontSize: 14 },
});
