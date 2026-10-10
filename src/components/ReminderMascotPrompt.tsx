import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, Image, Platform, StyleSheet, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors } from '../theme/colors';
import { layout, radii, spacing } from '../theme/tokens';
import { RtlText } from './RtlText';
import { selectReminderAnimation, type ReminderAnimationId, type ReminderStage } from '../logic/reminderAnimationLibrary';
import { MascotSafeZone } from './MascotSafeZone';
import { computeReminderPromptPlacement, reminderLaneInHost, type ScreenRect } from '../logic/reminderPromptPlacement';

interface ReminderMascotPromptProps {
  visible: boolean;
  message: string;
  onDismiss: () => void;
  animationId?: ReminderAnimationId;
  stage?: ReminderStage;
  /**
   * On-screen rect the moment must not cover — Home's next-walk card,
   * including its Start Walk button. See reminderPromptPlacement.ts.
   */
  avoid?: ScreenRect | null;
}


/** How long the moment stays up before dismissing itself. */
export const REMINDER_PROMPT_DISMISS_MS = 3200;
/**
 * With VoiceOver/TalkBack on it stays longer, so the sentence can be read
 * out — but it still always dismisses itself. The overlay cannot be tapped
 * (see below), so "wait for a tap" would mean a permanent overlay.
 */
export const REMINDER_PROMPT_SCREEN_READER_DISMISS_MS = 8000;

/**
 * A notification-open prompt, intentionally distinct from completion gratitude.
 *
 * Real-iPhone QA: this used to be a React Native Modal holding a
 * full-screen Pressable. That backdrop swallowed every touch for as long
 * as the mascot was up — including on the fully transparent areas — so a
 * tap on Start Walk, Add Walk or the tab bar only dismissed the mascot.
 *
 * It is now a purely DECORATIVE, non-modal overlay: an absolutely
 * positioned view inside the screen with pointerEvents="none" on the whole
 * subtree. It never receives a touch, so everything underneath stays
 * usable, and it leaves on its own timer. Render it as a late child of the
 * screen's root view (not inside a ScrollView).
 */
const FALLBACK_MASCOT = require('../../assets/branding/walkie-doggy-mascot-transparent.png');
const REMINDER_V2: Record<ReminderAnimationId, number> = {
  'happy-jump': require('../../assets/branding/walkie-happy-jump-v2-final.webp'),
  'high-five': require('../../assets/branding/walkie-high-five-v2-final.webp'),
  'thank-you-heart': require('../../assets/branding/walkie-thank-you-heart-v2-final.webp'),
  'trophy': require('../../assets/branding/walkie-trophy-v2-final.webp'),
  'sleepy-good-night': require('../../assets/branding/walkie-sleepy-good-night-v2-final.webp'),
  'leash-ready': require('../../assets/branding/walkie-leash-mouth-v2-final.webp'),
  'playful-wait': require('../../assets/branding/walkie-playful-wait-v2-final.webp'),
  'trophy-lift': require('../../assets/branding/walkie-trophy-lift-v2-final.webp'),
  'paw-wave': require('../../assets/branding/walkie-paw-wave-v2-final.webp'),
};

let lastReminderAnimationId: ReminderAnimationId | undefined;

export function ReminderMascotPrompt({ visible, message, onDismiss, animationId, stage, avoid }: ReminderMascotPromptProps) {
  const { height: windowHeight } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  // The overlay's own box in window coordinates, so the window-space lane
  // can be translated into it (see reminderLaneInHost).
  const overlayRef = useRef<View>(null);
  const [hostRect, setHostRect] = useState<ScreenRect | null>(null);
  const measureHost = useCallback(() => {
    overlayRef.current?.measureInWindow?.((x, y, width, height) => {
      if (width > 0 && height > 0) setHostRect({ x, y, width, height });
    });
  }, []);
  const placement = computeReminderPromptPlacement({
    windowHeight,
    // Same height the tab bar itself uses (navigation: layout.rowHeight + insets.bottom).
    tabBarHeight: layout.rowHeight,
    bottomInset: insets.bottom,
    avoid,
  });
  const lane = reminderLaneInHost(placement, windowHeight, hostRect);
  // Fail-safe default true, matching the app's mascot motion components:
  // render static until the OS setting is confirmed off.
  const [reducedMotion, setReducedMotion] = useState(true);
  // Fail-safe default false — see WalkCompletionCelebration's identical
  // state for why (never a permanently-stuck modal if detection is slow).
  const [screenReaderEnabled, setScreenReaderEnabled] = useState(false);
  const bubbleProgress = useRef(new Animated.Value(0)).current;
  const [selectedAnimationId, setSelectedAnimationId] = useState<ReminderAnimationId>(animationId ?? 'happy-jump');

  useEffect(() => {
    if (!visible) return;
    if (animationId) {
      setSelectedAnimationId(animationId);
      lastReminderAnimationId = animationId;
      return;
    }
    const selected = selectReminderAnimation(stage, lastReminderAnimationId);
    setSelectedAnimationId(selected.animationId);
    lastReminderAnimationId = selected.animationId;
  }, [visible, animationId, stage]);

  useEffect(() => {
    let mounted = true;
    AccessibilityInfo.isReduceMotionEnabled().then((enabled) => mounted && setReducedMotion(!!enabled)).catch(() => mounted && setReducedMotion(false));
    const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', setReducedMotion);
    AccessibilityInfo.isScreenReaderEnabled().then((enabled) => mounted && setScreenReaderEnabled(!!enabled)).catch(() => {});
    const srSubscription = AccessibilityInfo.addEventListener('screenReaderChanged', setScreenReaderEnabled);
    return () => { mounted = false; subscription?.remove?.(); srSubscription?.remove?.(); };
  }, []);

  useEffect(() => {
    bubbleProgress.stopAnimation();
    bubbleProgress.setValue(0);
    if (!visible) return;
    if (reducedMotion) {
      bubbleProgress.setValue(1);
      return;
    }
    const sequence = Animated.sequence([
      Animated.delay(450),
      Animated.timing(bubbleProgress, { toValue: 1, duration: 280, useNativeDriver: true }),
    ]);
    sequence.start();
    return () => sequence.stop();
  }, [visible, reducedMotion, bubbleProgress]);

  useEffect(() => {
    if (!visible) return;
    // Always self-dismissing. A screen-reader user gets a longer window so
    // the dynamic Hebrew sentence is not cut off mid-announcement, but the
    // overlay never waits for a tap it cannot receive.
    const timer = setTimeout(onDismiss, screenReaderEnabled ? REMINDER_PROMPT_SCREEN_READER_DISMISS_MS : REMINDER_PROMPT_DISMISS_MS);
    return () => clearTimeout(timer);
  }, [visible, onDismiss, screenReaderEnabled]);

  useEffect(() => {
    // iOS has no live regions: speak the sentence explicitly so VoiceOver
    // users hear it even though the overlay takes no focus. Android
    // (accessibilityLiveRegion) and web (role="alert") announce it from
    // the markup below, so announcing here as well would say it twice.
    if (!visible || !message || Platform.OS !== 'ios') return;
    AccessibilityInfo.announceForAccessibility?.(message);
  }, [visible, message]);

  if (!visible) return null;
  return (
    <View ref={overlayRef} onLayout={measureHost} pointerEvents="none" style={styles.overlay} testID="reminder-mascot-overlay">
        <View pointerEvents="none" style={[styles.lane, { top: lane.top, bottom: lane.bottom }]} testID="reminder-mascot-lane">
        <MascotSafeZone from="right" interactive={false} testID="reminder-mascot-safe-zone">
          <View pointerEvents="none" style={[styles.moment, placement.compact && styles.momentCompact]} accessibilityRole="alert" accessibilityLiveRegion="polite">
            <Animated.View pointerEvents="none" style={{ flexShrink: 1, opacity: bubbleProgress, transform: [{ translateY: bubbleProgress.interpolate({ inputRange: [0, 1], outputRange: [12, 0] }) }] }}>
              <View style={[styles.bubble, placement.compact && styles.bubbleCompact]}><RtlText style={[styles.message, placement.compact && styles.messageCompact]} numberOfLines={2}>{message}</RtlText></View>
              {placement.compact ? null : <View style={styles.tail} />}
            </Animated.View>
            <Image
              source={reducedMotion ? FALLBACK_MASCOT : REMINDER_V2[selectedAnimationId]}
              style={{ width: placement.mascotSize, height: placement.mascotSize }}
              resizeMode="contain"
              accessibilityLabel="הקמע של Walkie Doggy Link מזכיר שהגיע זמן הטיול"
              testID="reminder-mascot-animation"
            />
          </View>
        </MascotSafeZone>
        </View>
    </View>
  );
}

const styles = StyleSheet.create({
  // Fills the screen it is rendered in, above the Dashboard content, and
  // takes no touches (pointerEvents="none" on the element itself).
  overlay: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, zIndex: 20, backgroundColor: 'transparent' },
  moment: { alignItems: 'center', maxWidth: 340 },
  bubble: { backgroundColor: colors.surface, borderRadius: radii.xl, paddingHorizontal: 18, paddingVertical: spacing.md, marginBottom: -6, zIndex: 2 },
  message: { color: colors.textPrimary, fontSize: 19, fontWeight: '800', textAlign: 'center', writingDirection: 'rtl' },
  tail: { width: 18, height: 18, backgroundColor: colors.surface, transform: [{ rotate: '45deg' }], marginTop: -9, marginBottom: -3, zIndex: 1 },
  lane: { position: 'absolute', left: 0, right: 0 },
  // Short lane: bubble beside the mascot instead of above it.
  momentCompact: { flexDirection: 'row', gap: spacing.sm },
  bubbleCompact: { marginBottom: 0, paddingHorizontal: 14, paddingVertical: spacing.sm },
  messageCompact: { fontSize: 16 },
});
