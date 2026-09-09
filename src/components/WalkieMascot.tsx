import React, { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, Image, StyleSheet } from 'react-native';

/**
 * Walkie Doggy mascot — reusable animation/state system (Batch 4, C2).
 *
 * ============================================================================
 * BATCH 4 CORRECTION #1 (item 1) — HONEST COMPLETION STATUS
 * ============================================================================
 * This component's animation is a TEMPORARY FALLBACK, not the completed
 * product requirement. It animates whole-image translate/rotate/scale
 * transforms on the ONE static mascot bitmap in this project
 * (assets/branding/walkie-doggy-mascot.png, derived from the official
 * icon.png). Rotating/bouncing/scaling the whole flattened PNG is NOT
 * equivalent to a real eye blink, a wagging tail, an ear/head expression
 * change, or a genuinely different pose (leash-ready, lying-down-concerned,
 * paws-up-celebrating) — those all require independently-moving PARTS (eyes,
 * ears, tail) or distinct new body poses, and every mascot asset actually
 * supplied with this project (icon.png, the two branding JPG/PNG sources,
 * the wordmark) is a single flattened raster image with no separable
 * layers, no sprite sheet, no SVG, and no alternate poses. Producing real
 * part-based motion from a flattened bitmap without redesigning the
 * character was judged unsafe — it would mean inventing artwork (a blinking
 * eye shape, a distinct tail silhouette, a new lying-down pose) that was
 * never actually drawn by whoever made the official mascot, which is exactly
 * the "ad-hoc, inconsistent mascot asset" the brief says not to introduce.
 * So per the brief's own correction instruction (1D): the procedural
 * transform below is KEPT as a temporary fallback (better than nothing,
 * and it does apply real, distinct, lightweight motion to real artwork),
 * the six states are NOT described anywhere as the finished character-
 * animation experience, and MASCOT_ASSET_PRODUCTION_LIST below is an exact,
 * per-state specification of the real character-animation assets a future
 * batch must commission before this product requirement is actually
 * complete. See MASCOT_ANIMATION_STATUS.
 *
 * What this component DOES build, per the brief's own fallback instructions
 * (C2: "if suitable animation assets do not currently exist... implement
 * the reusable animation/state architecture, wire the appropriate states
 * in, use safe static fallbacks, and provide an asset production list"):
 *   1. A real, reusable `<WalkieMascot state="..." />` architecture with all
 *      six required states wired to distinct, lightweight procedural
 *      animation (RN's own Animated API — zero new dependency; no
 *      animation library exists in package.json, see the report) — a stable
 *      public API that a real frame/sprite/Lottie implementation can drop
 *      behind later without any screen integration changing.
 *   2. Every state applies actual motion (bounce/tilt/droop/wiggle/scale)
 *      to the one real static asset — genuine animation of real artwork,
 *      not "several static pictures" swapped on a timer — but see the
 *      correction note above for why this is a fallback, not the final
 *      character-animation requirement.
 *   3. A mandatory static fallback: reduced-motion users (and any render
 *      before the reduce-motion check resolves) see the plain, motionless
 *      image — same asset, same layout, zero behavior lost.
 *   4. MASCOT_ASSET_PRODUCTION_LIST below — the concrete, per-state
 *      specification (including which separate parts/poses each state
 *      needs) of what a future batch must commission to replace this
 *      fallback with real character animation, without needing to change
 *      this component's public API.
 */

export type MascotState = 'idle' | 'excited' | 'ready' | 'waiting' | 'concerned' | 'success';

export const MASCOT_STATES: MascotState[] = ['idle', 'excited', 'ready', 'waiting', 'concerned', 'success'];

/**
 * BATCH 4 CORRECTION #1 (item 1) — a concrete, greppable/testable marker of
 * this component's real completion status. Deliberately NOT 'complete': the
 * six states below are wired and functional, but they are whole-image
 * procedural transforms, not the real blink/tail-wag/ear-expression/new-pose
 * character animation the product requirement describes. See the module doc
 * comment above and MASCOT_ASSET_PRODUCTION_LIST below.
 */
export const MASCOT_ANIMATION_STATUS = 'temporary-fallback-real-character-frames-required' as const;

/**
 * C2, requirement 4 (expanded per Batch 4 correction #1, item 1D) — an
 * EXACT per-state animation asset specification: what a designer must
 * actually draw/produce (which parts need to exist as separate layers or
 * frames, which states need an entirely new body pose that cannot be
 * derived from the current single sitting/winking artwork, and the rough
 * timing) for a future batch to replace the temporary procedural fallback
 * with real character animation. Not consumed by any runtime code; kept
 * here so it ships with (and stays next to) the component it documents, and
 * is checked by a test to make sure every state is accounted for.
 */
export const MASCOT_ASSET_PRODUCTION_LIST: Record<MascotState, string> = {
  idle:
    'Idle/welcome (seamless ~2s loop). NEEDS: eyes as a separate layer/frame — a closed-eyes (blink) frame held ~150-250ms, blinking roughly every 3-4s within the loop; a separate tail layer with 2-3 tail positions (center/left/right) for a small continuous wag; a subtle head-bob (can reuse the current whole-body bob as-is). Base pose (sitting, eyes open, soft/neutral mouth) can reuse the existing artwork.',
  excited:
    'Excited/T-15 (~1.5s, 2-3 plays). NEEDS: the same tail frame set as idle, played at a much faster cadence (3-4 full wags in 1.5s); an "ears perked up" frame alternating with the relaxed-ears base pose; a small whole-body hop (can reuse the current bounce transform). Base sitting pose can be reused; only ears/tail need new frames.',
  ready:
    'Ready/T (~1.1-1.5s, single play, then holds). NEEDS A NEW BASE POSE — cannot be derived from the current sitting/winking artwork without redesigning the character: leash-in-mouth OR front-paws-lifted "let\'s go" pose, drawn to match the existing character\'s proportions/palette/style. Single confident bounce/lean into this new pose, then a held stance.',
  waiting:
    'Waiting/T+15 (~2-2.4s, 2-3 plays). NEEDS: a head-tilt frame (head rotated ~15° from center, alternating with the neutral head pose, 2-3 alternations); 2 eye-position frames (pupils looking left / pupils looking right, "looking around for someone") on the same separate eyes layer used by idle; tail slowed to a single gentle wag using the existing tail frame set.',
  concerned:
    'Concerned/T+30 (~1.5-2s, single play, settles — friendly and humorous, NEVER frightened/pained). NEEDS A NEW BASE POSE — again cannot be derived from the current artwork: lying-down body, chin resting, ears drooping slightly, one eyebrow raised or a small exaggerated-sigh mouth shape for the "dramatic waiting" humor. Single transition into this new pose, then holds.',
  success:
    'Success/completed (~1.5-2s, 2-3 plays). NEEDS A NEW BASE POSE (or a clear variant of "ready"\'s new pose): paws-up / mid-hop with a big open-mouth happy expression, PLUS the fast tail-wag frame set from "excited". 2-3 celebratory bounces ending in a happy, settled still frame.',
};

const MASCOT_SOURCE = require('../../assets/branding/walkie-doggy-mascot.png');

interface AnimatedValues {
  translateY: Animated.Value;
  rotateDeg: Animated.Value;
  scale: Animated.Value;
}

function timing(value: Animated.Value, toValue: number, duration: number) {
  return Animated.timing(value, { toValue, duration, useNativeDriver: true });
}

/**
 * Builds the Animated.CompositeAnimation for one mascot state. Every branch
 * is a BOUNDED animation (a fixed number of plays, ~1-3s total) except
 * `idle`, which is a deliberately subtle, slow, infinite loop — matching
 * the brief's own distinction between "idle should feel alive" and "do not
 * create distracting infinite animation loops" (idle's amplitude is small
 * enough, and its period slow enough, not to read as distracting; every
 * event-driven state below settles back to rest rather than looping
 * forever).
 */
function buildMascotAnimation(state: MascotState, values: AnimatedValues): Animated.CompositeAnimation {
  const { translateY, rotateDeg, scale } = values;

  switch (state) {
    case 'idle': {
      // Gentle head-bob-and-settle, continuous but small (4px) and slow
      // (1.4s each way) — a living-but-calm resting pose.
      return Animated.loop(
        Animated.sequence([timing(translateY, -4, 1400), timing(translateY, 0, 1400)])
      );
    }
    case 'excited': {
      // Faster bounce + a little wiggle, ~2.1s total (3 plays of 700ms).
      const cycle = Animated.parallel([
        Animated.sequence([timing(translateY, -10, 220), timing(translateY, 0, 220)]),
        Animated.sequence([timing(rotateDeg, 0.5, 150), timing(rotateDeg, -0.5, 300), timing(rotateDeg, 0, 150)]),
      ]);
      return Animated.loop(cycle, { iterations: 3 });
    }
    case 'ready': {
      // Confident entrance: overshoot scale + a small forward-lean hold —
      // one play, ~1.1s, then rests in the leaned-in pose.
      return Animated.sequence([
        Animated.parallel([timing(scale, 1.12, 260), timing(rotateDeg, -0.4, 260)]),
        timing(scale, 1, 220),
      ]);
    }
    case 'waiting': {
      // Slow head-tilt "looking around" loop, ~2.4s (3 plays of 800ms).
      const cycle = Animated.sequence([
        timing(rotateDeg, -0.6, 400),
        timing(rotateDeg, 0.6, 800),
        timing(rotateDeg, 0, 400),
      ]);
      return Animated.loop(cycle, { iterations: 3 });
    }
    case 'concerned': {
      // Droop-and-settle — a single, held transition (never looping: a
      // repeated "droop" would read as sad/distressing rather than the
      // brief's required "friendly, humorous, dramatic waiting").
      return Animated.parallel([timing(translateY, 6, 700), timing(scale, 0.96, 700)]);
    }
    case 'success': {
      // Celebration bounce + wiggle + scale pulse, ~1.8s (3 plays of 600ms).
      const cycle = Animated.parallel([
        Animated.sequence([timing(translateY, -14, 260), timing(translateY, 0, 340)]),
        Animated.sequence([timing(rotateDeg, 1, 150), timing(rotateDeg, -1, 300), timing(rotateDeg, 0, 150)]),
        Animated.sequence([timing(scale, 1.08, 260), timing(scale, 1, 340)]),
      ]);
      return Animated.loop(cycle, { iterations: 3 });
    }
  }
}

export interface WalkieMascotProps {
  state: MascotState;
  size?: number;
  /**
   * Decorative by default (hidden from screen readers, same convention as
   * every other purely-illustrative emoji/image in this app) — pass an
   * explicit label only when the mascot IS the meaningful content (e.g. the
   * onboarding hero image), never for a corner/badge use.
   */
  accessibilityLabel?: string;
  testID?: string;
}

/**
 * Renders the Walkie Doggy mascot, animated per `state` via RN's built-in
 * Animated API (no new dependency). Falls back to the plain static image —
 * no animation started at all — when the OS reduce-motion accessibility
 * setting is on, or before that check resolves on mount.
 */
export function WalkieMascot({ state, size = 72, accessibilityLabel, testID }: WalkieMascotProps) {
  const [reducedMotion, setReducedMotion] = useState(true); // fail-safe default: static until proven otherwise
  const translateY = useRef(new Animated.Value(0)).current;
  const rotateRaw = useRef(new Animated.Value(0)).current;
  const scale = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    let mounted = true;
    AccessibilityInfo.isReduceMotionEnabled()
      .then((enabled) => {
        if (mounted) setReducedMotion(!!enabled);
      })
      .catch(() => {
        if (mounted) setReducedMotion(false);
      });
    const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', (enabled: boolean) =>
      setReducedMotion(!!enabled)
    );
    return () => {
      mounted = false;
      subscription?.remove?.();
    };
  }, []);

  useEffect(() => {
    translateY.stopAnimation();
    rotateRaw.stopAnimation();
    scale.stopAnimation();
    translateY.setValue(0);
    rotateRaw.setValue(0);
    scale.setValue(1);

    if (reducedMotion) {
      // Static fallback — required regardless of `state` (C2).
      return;
    }

    const animation = buildMascotAnimation(state, { translateY, rotateDeg: rotateRaw, scale });
    animation.start();
    return () => animation.stop();
  }, [state, reducedMotion, translateY, rotateRaw, scale]);

  const rotate = rotateRaw.interpolate({ inputRange: [-1, 1], outputRange: ['-8deg', '8deg'] });

  return (
    <Animated.View
      testID={testID}
      accessibilityElementsHidden={!accessibilityLabel}
      importantForAccessibility={accessibilityLabel ? 'yes' : 'no-hide-descendants'}
      accessibilityLabel={accessibilityLabel}
      style={[styles.container, { width: size, height: size, transform: [{ translateY }, { rotate }, { scale }] }]}
    >
      <Image source={MASCOT_SOURCE} style={styles.image} resizeMode="contain" />
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: { overflow: 'hidden' },
  image: { width: '100%', height: '100%' },
});



