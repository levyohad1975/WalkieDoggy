import fs from 'fs';

const source = fs
  .readFileSync(require.resolve('../FamilyOnboardingScreen'), 'utf8')
  .replace(/\r\n/g, '\n');

describe('existing family admin recovery in a regular browser (structural)', () => {
  it('offers the existing-family recovery action from the regular browser chooser', () => {
    const start = source.indexOf("if (mode === 'choose') {");
    const end = source.indexOf("if (mode === 'create')", start);
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);

    const chooser = source.slice(start, end);
    // Owner request 2026-11-03: a quiet text link for admins, so it no longer
    // looks like the members' "join" button.
    expect(chooser).toMatch(/onPress=\{\(\) => setMode\('recover'\)\}[^\n]*accessibilityLabel="מנהלי המשפחה: כניסה עם קוד למייל"/);
    expect(chooser).toContain('label="קיבלתי קוד או קישור הצטרפות"');
    expect(chooser).not.toContain('המשפחה שלי כבר קיימת');
    expect(chooser).not.toContain('הצטרפות למשפחה קיימת');
  });

  it('recovery requests an OTP without Auth signup and reuses verified-family checks', () => {
    const recoveryStart = source.indexOf("if (mode === 'recover') {");
    const recoveryEnd = source.indexOf("if (mode === startMode && pendingInviteRedemption)", recoveryStart);
    expect(recoveryStart).toBeGreaterThan(-1);
    expect(recoveryEnd).toBeGreaterThan(recoveryStart);

    const recovery = source.slice(recoveryStart, recoveryEnd);
    expect(recovery).toMatch(/onPress=\{\(\) => sendAdminVerification\(false\)\}/);

    const handlerStart = source.indexOf('const recoverExistingFamily = async () =>');
    const handlerEnd = source.indexOf('const submitCreate = async () =>', handlerStart);
    expect(handlerStart).toBeGreaterThan(-1);
    const handler = source.slice(handlerStart, handlerEnd);
    expect(handler).toMatch(/verifyAdminEmailOtp\(adminEmail, verificationCode\)/);
    expect(handler).toMatch(/getMyFamilyOnboardingStatus\(\)/);
    expect(handler).not.toMatch(/joinFamily|ensureAnonymousSession/);
  });
});

describe('illustrated welcome built from approved brand assets (owner request 2026-11-03)', () => {
  it('uses the Walkie park background, the wordmark and the official mascot, with real buttons', () => {
    const start = source.indexOf("if (mode === 'choose') {");
    const chooser = source.slice(start, source.indexOf("if (mode === 'create')", start));
    expect(chooser).toContain('source={DEFAULT_DOG_BACKGROUND.source!}');
    expect(chooser).toContain("require('../../assets/walkie-doggy-link-wordmark-transparent.png')");
    expect(chooser).toContain('<WalkieMascot state="ready" size={mascotSize} accessibilityLabel="הקמע הרשמי של Walkie Doggy" />');
    expect(chooser).toContain('<Button label="יצירת משפחה חדשה"');
    // The retired artwork with a non-mascot dog stays out (MASCOT_SPEC.md).
    expect(chooser).not.toMatch(/onboarding-welcome-(?:final|wink)|onboarding-hero/);
  });
});
