/**
 * RTL-order bug fix — structural regression guard.
 *
 * This repo has no React Native component-rendering test infrastructure
 * (see FamilyOnboardingScreen.tokenSafety.test.ts's own doc comment;
 * @testing-library/react-native and react-test-renderer are installed-but-
 * unused devDependencies), so this is a plain source-text scan, not a
 * rendered-component test — it cannot and does not claim to verify actual
 * on-screen physical RTL layout at any Dynamic Type size. What it CAN
 * verify, and does: the *logical* source order the JSX places the digit
 * Text nodes and the label Text nodes in, and that both rows share the
 * same `direction: 'ltr'` layout-determinism fix so they can't drift
 * apart from each other again.
 *
 * The physical-order bug itself (hours/minutes/seconds rendering in the
 * wrong screen position at some Dynamic Type sizes but not others) was a
 * *layout* bug — Yoga resolving `flexDirection: 'row'`'s "start"/"end"
 * against an inherited/re-resolved RTL `direction` rather than an
 * explicitly pinned one — never a data-order bug, so this test also
 * guards the thing that must NOT have been touched by the fix: the
 * hours→minutes→seconds computation and JSX-argument order itself.
 */
describe('Countdown — source order (structural)', () => {
  const source: string = require('fs').readFileSync(require.resolve('../Countdown'), 'utf8');

  it('computes and interpolates hours, then minutes, then seconds, in that order', () => {
    const hoursIdx = source.indexOf('two(hours)');
    const minutesIdx = source.indexOf('two(minutes)');
    const secondsIdx = source.indexOf('two(seconds)');
    expect(hoursIdx).toBeGreaterThan(-1);
    expect(minutesIdx).toBeGreaterThan(hoursIdx);
    expect(secondsIdx).toBeGreaterThan(minutesIdx);
  });

  it('renders the שעות / דקות / שניות labels in that same hours→minutes→seconds source order', () => {
    const hoursLabelIdx = source.indexOf('שעות');
    const minutesLabelIdx = source.indexOf('דקות');
    const secondsLabelIdx = source.indexOf('שניות');
    expect(hoursLabelIdx).toBeGreaterThan(-1);
    expect(minutesLabelIdx).toBeGreaterThan(hoursLabelIdx);
    expect(secondsLabelIdx).toBeGreaterThan(minutesLabelIdx);
  });

  it('pins an explicit LTR layout direction on both the digit row and the label row, not just one', () => {
    const rowStyleMatch = source.match(/row:\s*\{[^}]*\}/);
    const labelRowStyleMatch = source.match(/labelRow:\s*\{[^}]*\}/);
    expect(rowStyleMatch?.[0]).toMatch(/direction:\s*'ltr'/);
    expect(labelRowStyleMatch?.[0]).toMatch(/direction:\s*'ltr'/);
  });
});
