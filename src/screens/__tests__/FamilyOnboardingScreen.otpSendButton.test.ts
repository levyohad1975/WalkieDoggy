/**
 * Structural regression guard (this repo has no React Native rendering test
 * infrastructure; see FamilyOnboardingScreen.tokenSafety.test.ts).
 *
 * Production 2026-11-01: the "שליחת קוד אימות" buttons used
 * `onPress={sendAdminVerification}`. The press event then arrived as the
 * handler's `shouldCreateUser` argument and was serialized into the OTP
 * request body; JSON.stringify of that cyclic React/DOM event threw before
 * any request was sent, so the user only saw a generic error and no OTP
 * request ever reached Supabase Auth.
 */
describe('FamilyOnboardingScreen — OTP send buttons never forward the press event', () => {
  const source: string = require('fs').readFileSync(
    require.resolve('../FamilyOnboardingScreen'),
    'utf8'
  );

  it('never passes sendAdminVerification directly as an onPress handler', () => {
    expect(source).not.toMatch(/onPress=\{\s*sendAdminVerification\s*\}/);
  });

  it('calls sendAdminVerification only with an explicit boolean', () => {
    const calls = source.match(/sendAdminVerification\(([^)]*)\)/g) ?? [];
    expect(calls.length).toBeGreaterThan(0);
    for (const call of calls) {
      expect(call).toMatch(/^sendAdminVerification\((true|false)\)$/);
    }
  });

  it('coerces the create-user flag to a strict boolean before requesting the OTP', () => {
    expect(source).toContain('const createUser = shouldCreateUser !== false;');
    expect(source).toContain('requestAdminEmailVerification(adminEmail, createUser, diagnostics)');
  });
});
