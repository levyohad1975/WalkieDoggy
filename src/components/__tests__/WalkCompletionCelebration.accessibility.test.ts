import fs from 'fs';

/**
 * Mascot engineering audit (Phase 5 continuation) — this modal had no test
 * coverage at all. Same source-text-scan convention as
 * ReminderMascotPrompt.reducedMotion.test.ts (this repo has no
 * render-test harness for full screens/complex modals, though see
 * MascotFrameAnimation.test.tsx for genuine render coverage of the
 * component this one embeds).
 */
describe('WalkCompletionCelebration (structural)', () => {
  const source = fs.readFileSync(require.resolve('../WalkCompletionCelebration'), 'utf8').replace(/\r\n/g, '\n');

  it('pairs accessibilityRole="alert" with accessibilityLiveRegion="polite" on the celebration surface — Android TalkBack needs both (see errorBannerLiveRegionAccessibility.test.ts for the established convention)', () => {
    expect(source).toMatch(/accessibilityRole="alert" accessibilityLiveRegion="polite"/);
  });

  it('auto-dismisses normally but never removes the Hebrew message while VoiceOver/TalkBack is reading it', () => {
    expect(source).toMatch(/setTimeout\(\(\) => dismissRef\.current\(\), 2400\)/);
    expect(source).toMatch(/AccessibilityInfo\.isScreenReaderEnabled\(\)/);
    expect(source).toMatch(/AccessibilityInfo\.addEventListener\('screenReaderChanged', setScreenReaderEnabled\)/);
    expect(source).toMatch(/if \(screenReaderEnabled\) return;/);
  });

  it('still allows an immediate explicit dismiss by tapping the celebration backdrop', () => {
    expect(source).toMatch(/onPress=\{onDismiss\}/);
  });

  it('tracks reduced motion with a fail-safe-default-true state, same convention as the other mascot surfaces', () => {
    expect(source).toMatch(/const \[reducedMotion, setReducedMotion\] = useState\(true\);/);
    expect(source).toMatch(/AccessibilityInfo\.isReduceMotionEnabled\(\)/);
  });

  it('confetti, when present, is marked non-accessible decoration rather than being read aloud', () => {
    expect(source).toMatch(/celebration\.confetti \? <RtlText style=\{styles\.confetti\} accessible=\{false\}>/);
  });
});
