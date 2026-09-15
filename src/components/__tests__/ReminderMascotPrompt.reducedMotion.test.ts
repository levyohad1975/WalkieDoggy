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
 * check (see WalkieMascot.tsx / MascotFrameAnimation.tsx for the same
 * fail-safe-default-true convention). MascotFrameAnimation itself already
 * respects reduced motion for its frame playback, but the outer Modal
 * transition wrapping it did not, so a reduced-motion user opening a
 * reminder notification still saw a native fade-in/out.
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

  it('does not hardcode the native fade transition regardless of reduced motion', () => {
    expect(source).not.toMatch(/animationType="fade"/);
    expect(source).toMatch(/animationType=\{reducedMotion \? 'none' : 'fade'\}/);
  });
});
