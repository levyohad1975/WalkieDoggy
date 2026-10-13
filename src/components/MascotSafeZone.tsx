import React, { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, StyleSheet, View, useWindowDimensions } from 'react-native';

interface MascotSafeZoneProps {
  children: React.ReactNode;
  /** Entrance edge alternates naturally without ever covering fixed chrome. */
  from?: 'left' | 'right';
  /** Optional measured anchor supplied by Home's last-walk action lane. */
  anchor?: { x: number; y: number; width: number; height: number } | null;
  testID?: string;
  /**
   * Real-device QA round 8 — fires exactly once, the moment the entrance
   * slide has actually finished (or immediately, when there is nothing to
   * animate — Reduced Motion). A caller that needs to know "the character
   * has physically arrived at its resting spot" (e.g. to reveal a speech
   * bubble only once it has, not while it is still sliding in) should use
   * this instead of assuming the entrance is instant.
   */
  onEntranceComplete?: () => void;
  /**
   * False for a purely decorative moment (ReminderMascotPrompt): the stage
   * AND the character get pointerEvents="none". The default stage is
   * "box-none", which on web re-enables pointer events on its children and
   * would let the character swallow taps meant for the screen underneath.
   */
  interactive?: boolean;
}

/**
 * Shared "character lives inside the phone" stage.
 *
 * It starts fully outside the physical viewport, enters horizontally into a
 * bounded central safe zone, and never participates in layout. The vertical
 * band deliberately avoids the header/hero/primary next-walk card above and
 * bottom navigation below. Event overlays can therefore feel playful without
 * obscuring the controls that caused them.
 */
export function MascotSafeZone({ children, from = 'right', anchor, testID, onEntranceComplete, interactive = true }: MascotSafeZoneProps) {
  const [reducedMotion, setReducedMotion] = useState(true);
  // Real-device QA round 8 — `reducedMotion` is fail-safe-default-true
  // above, same convention as WalkCompletionCelebration's own identical
  // state. Without this, the entrance effect below would run once on
  // mount under that stale default, see `reducedMotion` as true, and fire
  // `onEntranceComplete` immediately — before the real async check even
  // resolved — telling a caller the character has "arrived" while the
  // real entrance animation (which starts a moment later once the real,
  // non-reduced-motion answer lands) hasn't even begun. Gating the effect
  // on `motionChecked` (same idiom as WalkCompletionCelebration) means it
  // only ever runs once, with the real answer.
  const [motionChecked, setMotionChecked] = useState(false);
  const { width } = useWindowDimensions();
  // Real-device QA round 8 — when anchored (every WalkCompletionCelebration
  // call), this used to be capped at a fraction of the ANCHOR's own (small,
  // ~100-150px) width, so the character started only a little off its
  // resting spot — nowhere near the physical screen edge, despite this
  // component's own doc comment claiming "starts fully outside the
  // physical viewport". Computed instead from the real, measured viewport
  // width and the anchor's actual on-screen position: the distance from
  // the anchor's own center to the near screen edge, plus one full extra
  // screen-width of margin — generous on purpose, since this component
  // only knows the anchor's box, not the (now much larger, ~168px)
  // character's own rendered size, and the margin must comfortably clear
  // it regardless. The un-anchored branch (ReminderMascotPrompt, which
  // never reported this symptom) is untouched.
  const anchorCenterX = anchor ? anchor.x + anchor.width / 2 : width / 2;
  const travel = anchor
    ? (from === 'right' ? width - anchorCenterX : anchorCenterX) + width
    : Math.max(260, width * 0.78);
  const translateX = useRef(new Animated.Value(from === 'right' ? travel : -travel)).current;
  // Keep the mascot fully opaque throughout the slide. Fading from 0 while
  // travelling from off-screen made the first visible frame appear only after
  // most of the horizontal journey had already completed on iPhone, so the
  // entrance looked like an in-card pop instead of an edge entrance.
  const opacity = useRef(new Animated.Value(1)).current;
  const onEntranceCompleteRef = useRef(onEntranceComplete);
  const entranceFiredRef = useRef(false);

  useEffect(() => {
    onEntranceCompleteRef.current = onEntranceComplete;
  }, [onEntranceComplete]);

  useEffect(() => {
    let mounted = true;
    AccessibilityInfo.isReduceMotionEnabled()
      .then((enabled) => { if (mounted) { setReducedMotion(!!enabled); setMotionChecked(true); } })
      .catch(() => { if (mounted) { setReducedMotion(false); setMotionChecked(true); } });
    const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', setReducedMotion);
    return () => { mounted = false; subscription?.remove?.(); };
  }, []);

  useEffect(() => {
    if (!motionChecked) return;
    translateX.setValue(reducedMotion ? 0 : (from === 'right' ? travel : -travel));
    opacity.setValue(1);
    if (reducedMotion) {
      if (!entranceFiredRef.current) {
        entranceFiredRef.current = true;
        onEntranceCompleteRef.current?.();
      }
      return;
    }
    Animated.timing(translateX, {
      toValue: 0,
      duration: 850,
      easing: (t) => 1 - Math.pow(1 - t, 3),
      useNativeDriver: true,
    }).start(() => {
      if (!entranceFiredRef.current) {
        entranceFiredRef.current = true;
        onEntranceCompleteRef.current?.();
      }
    });
  }, [from, motionChecked, opacity, reducedMotion, translateX, travel]);

  return (
    <View pointerEvents={interactive ? 'box-none' : 'none'} style={[styles.stage, anchor ? styles.anchoredStage : null, anchor ? { top: anchor.y, left: anchor.x, width: anchor.width, height: anchor.height, right: undefined, bottom: undefined } : null]} testID={testID}>
      <Animated.View pointerEvents={interactive ? 'auto' : 'none'} style={[styles.character, { opacity, transform: [{ translateX }] }]}>
        {children}
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  stage: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    // Keep event animation in the visual center, below the large next-walk
    // card and above the persistent bottom navigation on compact phones.
    // Keep the mascot in its own lower-right lane. Center placement can visually
    // merge with the yellow walk-edit pencil on Home, especially on iPhone.
    // The inset also keeps the character clear of the screen edge while the
    // bottom padding protects the persistent navigation.
    // The last-walk action row now has a deliberate empty centre lane.
    // Keep the celebration in that central band instead of covering the
    // timeline/upcoming content lower on Home.
    // Anchor the character over the deliberately empty centre lane of the
    // last-walk action row (between edit on the physical left and relief
    // toggles on the physical right). Keep this symmetric so the mascot
    // lands in the lane's centre rather than drifting toward either control.
    // Real-device Home QA: the previous percentage band placed the mascot
    // over the "בהמשך היום" timeline on tall iPhones. Anchor the celebration
    // higher, over the free centre of the last-walk card/action lane.
    paddingTop: 0,
    paddingBottom: 0,
    justifyContent: 'center',
    alignItems: 'center',
    overflow: 'hidden',
  },
  anchoredStage: { overflow: 'visible' },
  character: {
    alignItems: 'center',
    justifyContent: 'center',
    maxWidth: 340,
  },
});
