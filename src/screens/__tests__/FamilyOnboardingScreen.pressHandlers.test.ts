/**
 * Structural guard (no RN rendering harness in this repo).
 *
 * Production report 2026-11-01: "חיפוש משפחה" and "בדיקת ההזמנה" did
 * nothing on real phones. Both buttons passed the handler directly
 * (`onPress={lookup}`), so the press event arrived as the optional
 * code/link argument and `.trim()` on it threw before any request was sent
 * (same class of bug as the OTP send button, commit 97a638e).
 */
describe('FamilyOnboardingScreen — press handlers never receive the press event as input', () => {
  const source: string = require('fs').readFileSync(require.resolve('../FamilyOnboardingScreen'), 'utf8');

  it('the family-code search and invite check wrap their handlers', () => {
    expect(source).not.toContain('onPress={lookup}');
    expect(source).not.toContain('onPress={inspectInvite}');
    expect(source).toContain('onPress={() => { void lookup(); }}');
    expect(source).toContain('onPress={() => { void inspectInvite(); }}');
  });

  it('no handler with an optional first argument is passed straight to onPress', () => {
    const optionalArgHandlers = [...source.matchAll(/const (\w+) = (?:useCallback\()?(?:async )?\(\w+\?:/g)].map((m) => m[1]);
    for (const name of optionalArgHandlers) {
      expect(source).not.toMatch(new RegExp(`on(?:Press|SubmitEditing|LongPress)=\\{${name}\\}`));
    }
  });
});
