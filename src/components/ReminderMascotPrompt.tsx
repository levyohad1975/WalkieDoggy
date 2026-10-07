import React, { useEffect, useState } from 'react';
import { AccessibilityInfo, Image, Modal, Pressable, StyleSheet, View } from 'react-native';
import { MascotFrameAnimation } from './MascotFrameAnimation';
import { colors } from '../theme/colors';
import { radii, spacing } from '../theme/tokens';
import { RtlText } from './RtlText';
import { selectReminderAnimation, type ReminderAnimationId, type ReminderStage } from '../logic/reminderAnimationLibrary';
import { MascotSafeZone } from './MascotSafeZone';
import { MASCOT_FRAME_SETS, MASCOT_FRAME_FPS } from '../mascot/celebrationAnimationManifest';

interface ReminderMascotPromptProps {
  visible: boolean;
  message: string;
  onDismiss: () => void;
  animationId?: ReminderAnimationId;
  stage?: ReminderStage;
}

/** A notification-open prompt, intentionally distinct from completion gratitude. */
const FALLBACK_MASCOT = require('../../assets/branding/walkie-doggy-mascot-transparent.png');
const REMINDER_V2: Record<ReminderAnimationId, number> = {
  'happy-jump': require('../../assets/branding/walkie-happy-jump-v2-final.webp'),
  'high-five': require('../../assets/branding/walkie-high-five-v2-final.webp'),
  'thank-you-heart': require('../../assets/branding/walkie-thank-you-heart-v2-final.webp'),
  'trophy': require('../../assets/branding/walkie-trophy-v2-final.webp'),
  'sleepy-good-night': require('../../assets/branding/walkie-sleepy-good-night-v2-final.webp'),
  'leash-ready': require('../../assets/branding/walkie-doggy-mascot-transparent.png'),
  'tail-wag': require('../../assets/branding/walkie-doggy-mascot-transparent.png'),
  'curious-listen': require('../../assets/branding/walkie-doggy-mascot-transparent.png'),
  'peek-a-boo': require('../../assets/branding/walkie-doggy-mascot-transparent.png'),
  'trophy-winner': require('../../assets/branding/walkie-doggy-mascot-transparent.png'),
};

let lastReminderAnimationId: ReminderAnimationId | undefined;

export function ReminderMascotPrompt({ visible, message, onDismiss, animationId, stage }: ReminderMascotPromptProps) {
  // Fail-safe default true, same convention as WalkieMascot/MascotFrameAnimation/
  // WalkCompletionCelebration: static until the OS setting is confirmed off.
  const [reducedMotion, setReducedMotion] = useState(true);
  // Fail-safe default false — see WalkCompletionCelebration's identical
  // state for why (never a permanently-stuck modal if detection is slow).
  const [screenReaderEnabled, setScreenReaderEnabled] = useState(false);
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
    if (!visible) return;
    // Same reasoning as WalkCompletionCelebration: never auto-dismiss a
    // dynamic Hebrew reminder sentence out from under VoiceOver/TalkBack —
    // the backdrop tap stays available as the explicit dismiss.
    if (screenReaderEnabled) return;
    const timer = setTimeout(onDismiss, 3200);
    return () => clearTimeout(timer);
  }, [visible, onDismiss, screenReaderEnabled]);
  return (
    <Modal visible={visible} transparent animationType={reducedMotion ? 'none' : 'fade'} onRequestClose={onDismiss} statusBarTranslucent>
      <Pressable style={styles.backdrop} onPress={onDismiss} accessibilityRole="button" accessibilityLabel="סגירת תזכורת הקמע של Walkie Doggy Link">
        <MascotSafeZone from="right" testID="reminder-mascot-safe-zone">
          <View style={styles.moment} accessibilityRole="alert" accessibilityLiveRegion="polite">
            <View style={styles.bubble}><RtlText style={styles.message} numberOfLines={2}>{message}</RtlText></View>
            <View style={styles.tail} />
            {!reducedMotion && ['leash-ready', 'tail-wag', 'curious-listen', 'peek-a-boo', 'trophy-winner'].includes(selectedAnimationId) ? (
              <MascotFrameAnimation
                frames={MASCOT_FRAME_SETS['leash-ready']}
                fps={MASCOT_FRAME_FPS}
                fallback={FALLBACK_MASCOT}
                size={168}
                accessibilityLabel="הקמע של Walkie Doggy Link מוכן לטיול עם הרצועה"
                testID="reminder-mascot-animation"
              />
            ) : (
              <Image
                source={reducedMotion ? FALLBACK_MASCOT : REMINDER_V2[selectedAnimationId]}
                style={styles.mascot}
                resizeMode="contain"
                accessibilityLabel="הקמע של Walkie Doggy Link מזכיר שהגיע זמן הטיול"
                testID="reminder-mascot-animation"
              />
            )}
          </View>
        </MascotSafeZone>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'transparent' },
  moment: { alignItems: 'center', maxWidth: 340 },
  bubble: { backgroundColor: colors.surface, borderRadius: radii.xl, paddingHorizontal: 18, paddingVertical: spacing.md, marginBottom: -6, zIndex: 2 },
  message: { color: colors.textPrimary, fontSize: 19, fontWeight: '800', textAlign: 'center', writingDirection: 'rtl' },
  tail: { width: 18, height: 18, backgroundColor: colors.surface, transform: [{ rotate: '45deg' }], marginTop: -9, marginBottom: -3, zIndex: 1 },
  mascot: { width: 168, height: 168 },
});
