import React, { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, Image, StyleSheet, type ImageSourcePropType } from 'react-native';

export interface MascotPoseCelebrationProps {
  /** A single, already-approved, already-verified-transparent character pose. */
  pose: ImageSourcePropType;
  fallback: ImageSourcePropType;
  size: number;
  accessibilityLabel: string;
  testID?: string;
  /**
   * Fires exactly once, the moment the pose is actually visible and
   * animating (or immediately, when there is nothing to wait for — Reduced
   * Motion). Mirrors MascotFrameAnimation's own onReady contract so callers
   * (the speech bubble) don't need to know which rendering technique is in
   * use underneath.
   */
  onReady?: () => void;
}

/**
 * Real-device QA round 6 — MascotFrameAnimation's discrete-frame-swap
 * technique (source changing every tick between many separate PNG files)
 * kept producing real-device-only symptoms across five straight rounds —
 * a black rectangle, then too-fast/"frantic" playback, then a black
 * rectangle again after every preload/timing fix — that never reproduced
 * in this suite's instant, synchronous test mocks. Rather than attempt a
 * sixth variant of the same swap-many-sources approach, this retires it
 * for the celebration this was all reported against and replaces it with
 * the technique this app ALREADY ships everywhere else (the header
 * mascot, every hero/idle/onboarding moment) via WalkieMascot.tsx: ONE
 * single already-approved, already-verified-transparent image, animated
 * purely through Animated transforms (translateY/rotate/scale,
 * useNativeDriver: true). The <Image>'s `source` prop never changes once
 * set — there is no "swap to the next frame" step at all, so the entire
 * class of real-device bugs this file's sibling has chased (duplicate
 * preload requests, restart-on-rerender cascades, a visible window where
 * a not-yet-decoded frame's slot paints solid black) cannot occur here:
 * nothing is ever mid-load during playback, because playback never
 * touches `source` again after the one initial load.
 *
 * The pose itself (not this component) carries the recognizable gesture —
 * passed in already showing the raised paw/High-Five, verified pixel-by-
 * pixel to have a clean, genuine alpha channel with no black-under-alpha
 * artifacts (see celebrationAnimationManifest.ts's own doc comment on
 * HIGH_FIVE_POSE for that verification). Motion comes entirely from a
 * ~2.2s present → lively hold → settle transform sequence around that one
 * fixed image, the same proven technique as WalkieMascot's own 'success'
 * state.
 */
export function MascotPoseCelebration({ pose, fallback, size, accessibilityLabel, testID, onReady }: MascotPoseCelebrationProps) {
  const [reducedMotion, setReducedMotion] = useState(true);
  const [motionChecked, setMotionChecked] = useState(false);
  const [poseLoaded, setPoseLoaded] = useState(false);
  const readyFiredRef = useRef(false);
  const onReadyRef = useRef(onReady);
  const translateY = useRef(new Animated.Value(0)).current;
  const rotateRaw = useRef(new Animated.Value(0)).current;
  const scale = useRef(new Animated.Value(0.92)).current;

  useEffect(() => {
    onReadyRef.current = onReady;
  }, [onReady]);

  useEffect(() => {
    let active = true;
    AccessibilityInfo.isReduceMotionEnabled()
      .then((enabled) => { if (active) { setReducedMotion(!!enabled); setMotionChecked(true); } })
      .catch(() => { if (active) { setReducedMotion(false); setMotionChecked(true); } });
    const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', setReducedMotion);
    return () => { active = false; subscription?.remove?.(); };
  }, []);

  // Nothing to wait for once Reduced Motion is known to be on (shows the
  // static fallback immediately); otherwise wait for the one pose image to
  // actually finish loading before calling this "ready".
  const ready = motionChecked && (reducedMotion || poseLoaded);

  useEffect(() => {
    if (readyFiredRef.current || !ready) return;
    readyFiredRef.current = true;
    onReadyRef.current?.();
  }, [ready]);

  useEffect(() => {
    if (!ready || reducedMotion) return;
    const timing = (value: Animated.Value, toValue: number, duration: number) =>
      Animated.timing(value, { toValue, duration, useNativeDriver: true });
    translateY.setValue(0);
    rotateRaw.setValue(0);
    scale.setValue(0.92);
    // Present (~400ms): pop up into the pose with a small overshoot.
    // Lively hold (~1440ms, two gentle wiggles): the gesture is already
    // fully visible — this just keeps it feeling alive, not static.
    // Settle (~400ms): ease back to rest, holding there for the remainder
    // of the celebration.
    const animation = Animated.sequence([
      Animated.parallel([timing(scale, 1.1, 220), timing(translateY, -12, 220)]),
      Animated.parallel([timing(scale, 1, 180), timing(translateY, -8, 180)]),
      Animated.sequence([timing(rotateRaw, 1, 180), timing(rotateRaw, -1, 360), timing(rotateRaw, 0, 180)]),
      Animated.sequence([timing(rotateRaw, 1, 180), timing(rotateRaw, -1, 360), timing(rotateRaw, 0, 180)]),
      Animated.parallel([timing(translateY, 0, 400), timing(scale, 1, 400)]),
    ]);
    animation.start();
    return () => animation.stop();
  }, [ready, reducedMotion, translateY, rotateRaw, scale]);

  const rotate = rotateRaw.interpolate({ inputRange: [-1, 1], outputRange: ['-6deg', '6deg'] });
  const source = reducedMotion ? fallback : poseLoaded ? pose : fallback;

  return (
    <>
      <Animated.View style={{ width: size, height: size, transform: [{ translateY }, { rotate }, { scale }] }}>
        <Image
          testID={testID}
          source={source}
          accessibilityLabel={accessibilityLabel}
          style={{ width: size, height: size, backgroundColor: 'transparent' }}
          resizeMode="contain"
        />
      </Animated.View>
      {!reducedMotion && !poseLoaded ? (
        <Image
          source={pose}
          onLoad={() => setPoseLoaded(true)}
          onError={() => setPoseLoaded(true)}
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          style={preloadStyles.hidden}
        />
      ) : null}
    </>
  );
}

const preloadStyles = StyleSheet.create({
  hidden: { position: 'absolute', width: 1, height: 1, opacity: 0 },
});
