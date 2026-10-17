import React, { useEffect, useState } from 'react';
import { AccessibilityInfo, Modal, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { RtlText } from '../RtlText';
import { Button } from '../Button';
import { WalkieMascot } from '../WalkieMascot';
import { colors } from '../../theme/colors';
import { breakpoints, spacing, typography } from '../../theme/tokens';
import { resolveTutorialSource } from '../../lib/tutorialConfig';
import { useTutorialStore } from '../../store/tutorialStore';
import { TutorialVideoPlayer } from './TutorialVideoPlayer';

/**
 * Full-screen, dismissible first-run / Help tutorial surface.
 *
 * welcome → (▶ צפה בהדרכה) → player → (ended) → "יאללה, מתחילים!"
 *
 * Home is already mounted underneath; closing at any point returns to it.
 * The mascot shown here is the Walkie Doggy brand mascot — never the
 * family's own dog — so its accessibility label never uses a dog name.
 */

export const TUTORIAL_COPY = {
  // The brief's copy ended with a generic dog emoji; the brand guard
  // (DogPhoto.mascotOnlyFallback.test.ts, MASCOT_SPEC.md) keeps generic dog
  // imagery out of production UI. The official mascot renders above it.
  title: 'ברוכים הבאים ל־Walkie Doggy!',
  description: 'רוצים לראות איך מנהלים את הטיולים המשפחתיים בקלות? הכנו לכם הדרכה קצרה.',
  watch: '▶ צפה בהדרכה',
  skip: 'דלג והתחל',
  start: 'יאללה, מתחילים!',
  replay: '↺ צפייה חוזרת',
  doneNote: 'אפשר לחזור להדרכה בכל רגע דרך ״סרטון הדרכה״.',
  mascotLabel: 'הדמות של Walkie Doggy',
} as const;

function useReducedMotion(): boolean {
  // Default to reduced until the OS answers (same policy as WalkieMascot).
  const [reduced, setReduced] = useState(true);
  useEffect(() => {
    let mounted = true;
    AccessibilityInfo.isReduceMotionEnabled?.()
      .then((value) => { if (mounted) setReduced(Boolean(value)); })
      .catch(() => undefined);
    const sub = AccessibilityInfo.addEventListener?.('reduceMotionChanged', (value: boolean) => setReduced(Boolean(value)));
    return () => { mounted = false; sub?.remove?.(); };
  }, []);
  return reduced;
}

export function TutorialOverlay() {
  const visible = useTutorialStore((s) => s.visible);
  const mode = useTutorialStore((s) => s.mode);
  const context = useTutorialStore((s) => s.context);
  const startPlayback = useTutorialStore((s) => s.startPlayback);
  const markEnded = useTutorialStore((s) => s.markEnded);
  const dismiss = useTutorialStore((s) => s.dismiss);
  const finish = useTutorialStore((s) => s.finish);
  const insets = useSafeAreaInsets();
  const reducedMotion = useReducedMotion();
  // Re-mount the player on replay so a fresh, user-initiated start happens.
  const [playerRun, setPlayerRun] = useState(0);

  if (!visible || !context) return null;
  const source = resolveTutorialSource(context.role);

  return (
    <Modal
      visible
      transparent={false}
      animationType={reducedMotion ? 'none' : 'fade'}
      onRequestClose={dismiss}
      supportedOrientations={['portrait', 'landscape']}
    >
      <View style={[styles.screen, { paddingTop: insets.top + spacing.md, paddingBottom: insets.bottom + spacing.md }]} testID="tutorial-overlay">
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <View style={styles.column}>
            {mode === 'welcome' ? (
              <View style={styles.block} testID="tutorial-welcome">
                <WalkieMascot state="idle" size={150} accessibilityLabel={TUTORIAL_COPY.mascotLabel} testID="tutorial-mascot" />
                <RtlText style={styles.title} accessibilityRole="header">{TUTORIAL_COPY.title}</RtlText>
                <RtlText style={styles.description}>{TUTORIAL_COPY.description}</RtlText>
                <View style={styles.actions}>
                  <Button label={TUTORIAL_COPY.watch} onPress={startPlayback} accessibilityLabel="צפה בהדרכה" />
                  <Button label={TUTORIAL_COPY.skip} variant="secondary" onPress={dismiss} />
                </View>
              </View>
            ) : null}

            {mode === 'player' ? (
              <TutorialVideoPlayer
                key={playerRun}
                source={source}
                startOnMount
                onEnded={markEnded}
                onClose={dismiss}
              />
            ) : null}

            {mode === 'done' ? (
              <View style={styles.block} testID="tutorial-done">
                <WalkieMascot state="success" size={140} accessibilityLabel={TUTORIAL_COPY.mascotLabel} />
                <RtlText style={styles.title} accessibilityRole="header" accessibilityLiveRegion="polite">{TUTORIAL_COPY.start}</RtlText>
                <RtlText style={styles.description}>{TUTORIAL_COPY.doneNote}</RtlText>
                <View style={styles.actions}>
                  <Button label={TUTORIAL_COPY.start} onPress={finish} />
                  <Button
                    label={TUTORIAL_COPY.replay}
                    variant="secondary"
                    accessibilityLabel="צפייה חוזרת בהדרכה"
                    onPress={() => { setPlayerRun((n) => n + 1); startPlayback(); }}
                  />
                </View>
              </View>
            ) : null}
          </View>
        </ScrollView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  content: { flexGrow: 1, justifyContent: 'center', paddingHorizontal: spacing.lg },
  column: { width: '100%', maxWidth: breakpoints.readingColumn, alignSelf: 'center' },
  block: { alignItems: 'center', gap: spacing.lg },
  title: { ...typography.display, fontSize: 26, lineHeight: 34, color: colors.textPrimary, textAlign: 'center', width: '100%' },
  description: { ...typography.body, fontWeight: '500', color: colors.textSecondary, textAlign: 'center', width: '100%' },
  actions: { width: '100%', maxWidth: 420, gap: spacing.md, marginTop: spacing.sm },
});
