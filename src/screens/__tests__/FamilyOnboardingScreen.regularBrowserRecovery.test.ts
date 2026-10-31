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
    expect(chooser).toMatch(/label="המשפחה שלי כבר קיימת"[^\n]*setMode\('recover'\)/);
  });

  it('recovery requests an OTP without Auth signup and reuses verified-family checks', () => {
    const recoveryStart = source.indexOf("if (mode === 'recover') {");
    const recoveryEnd = source.indexOf("if (mode === 'choose' && pendingInviteRedemption)", recoveryStart);
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
