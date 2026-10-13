import fs from 'fs';
import path from 'path';

/**
 * QA Guardian sweep — regression guard for a real reduced-motion gap in
 * ReminderMascotPrompt.tsx: its `<Modal>` used a hardcoded
 * `animationType="fade"`, which is React Native's own native transition and
 * is NOT gated by the OS reduce-motion accessibility setting — unlike its
 * sibling mascot-prompt component, WalkCompletionCelebration.tsx, which
 * explicitly sets `animationType="none"` and gates all of its own internal
 * Animated motion behind an `AccessibilityInfo.isReduceMotionEnabled()`
 * check. ReminderMascotPrompt now follows the same pattern: the Modal's
 * own transition is always `"none"`, and a custom `bubbleProgress`
 * Animated.Value — snapped straight to 1 when reduced motion is on,
 * animated via a delay+timing sequence otherwise — drives the speech
 * bubble's reveal instead.
 *
 * This repo has no React Native component-rendering test infrastructure, so
 * — consistent with FamilySharingModal.codeTextAlignment.test.ts and
 * FamilyOnboardingScreen.redeemInputAlignment.test.ts — this is a plain
 * source-text scan, not a rendered-component test.
 */
describe('ReminderMascotPrompt — Modal transition respects reduced motion (structural)', () => {
  const source = fs.readFileSync(path.resolve(__dirname, '../ReminderMascotPrompt.tsx'), 'utf8');

  it('imports AccessibilityInfo and tracks a fail-safe-default reducedMotion state', () => {
    expect(source).toMatch(/import\s*\{[^}]*AccessibilityInfo[^}]*\}\s*from\s*'react-native'/);
    expect(source).toMatch(/useState\(true\)/);
    expect(source).toMatch(/AccessibilityInfo\.isReduceMotionEnabled\(\)/);
    expect(source).toMatch(/addEventListener\('reduceMotionChanged'/);
  });

  // The prompt is no longer a <Modal> at all (non-interactive overlay — see
  // ReminderMascotPrompt.nonInteractive.test.tsx), so there is no native
  // Modal transition left that could bypass the reduce-motion setting.
  it('has no native Modal transition that could ignore reduced motion', () => {
    expect(source).not.toMatch(/animationType=/);
    expect(source).not.toMatch(/<Modal\b/);
  });

  it('gates the custom bubble-reveal animation behind reduced motion instead of the Modal transition', () => {
    expect(source).toMatch(/bubbleProgress\.setValue\(1\)/);
    expect(source).toMatch(/Animated\.sequence/);
    expect(source).toMatch(/if \(reducedMotion\) \{\s*bubbleProgress\.setValue\(1\);\s*return;\s*\}/);
  });

  it('pairs accessibilityRole="alert" with accessibilityLiveRegion="polite" — Android TalkBack needs both (mascot audit, see WalkCompletionCelebration.accessibility.test.ts for the sibling coverage)', () => {
    expect(source).toMatch(/accessibilityRole="alert" accessibilityLiveRegion="polite"/);
  });

  // Previously the prompt never auto-dismissed under a screen reader and
  // relied on a backdrop tap. The overlay can no longer be tapped, so it
  // must always dismiss itself — just later when a screen reader is on.
  it('tracks screen-reader state and gives it a longer, but still automatic, dismissal', () => {
    expect(source).toMatch(/AccessibilityInfo\.isScreenReaderEnabled\(\)/);
    expect(source).toMatch(/addEventListener\('screenReaderChanged', setScreenReaderEnabled\)/);
    expect(source).not.toMatch(/if \(screenReaderEnabled\) return;/);
    expect(source).toContain('setTimeout(onDismiss, screenReaderEnabled ? REMINDER_PROMPT_SCREEN_READER_DISMISS_MS : REMINDER_PROMPT_DISMISS_MS)');
  });

  it('uses real V2 animated assets for reminder motion and keeps a static reduced-motion fallback', () => {
    expect(source).toContain('REMINDER_V2');
    expect(source).toContain('selectReminderAnimation');
    expect(source).toContain('source={reducedMotion ? FALLBACK_MASCOT : REMINDER_V2[selectedAnimationId]}');
    // Size now comes from the placement lane (216 max, same approved asset) — see ReminderMascotPrompt.placement.test.ts.
    expect(source).toContain('style={{ width: placement.mascotSize, height: placement.mascotSize }}');
    expect(source).toContain('testID="reminder-mascot-animation"');
  });

  it('does not expose the rejected legacy frame renderer in reminder prompts', () => {
    expect(source).not.toContain('FRAME_REMINDER_IDS');
    expect(source).not.toContain('MASCOT_FRAME_SETS');
  });
});
