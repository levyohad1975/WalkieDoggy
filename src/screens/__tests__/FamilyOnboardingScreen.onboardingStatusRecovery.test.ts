import fs from 'fs';

/**
 * FEATURE (migration 0032): get_my_family_onboarding_status() was added
 * alongside create_verified_family(), with its own migration comment naming
 * it one of only two supported client-reachable surfaces for
 * family_onboarding_requests (the other being the create-verified-family
 * Edge Function itself) -- but it had zero client call sites anywhere in
 * this repo. Without it, a device that verified its admin email and
 * submitted create while AUTO_APPROVE_NEW_FAMILIES=false (landing on the
 * static "ממתינה לאישור" screen) lost all memory of that pending request the
 * moment the app restarted, since pendingApprovalFamilyName/mode are plain
 * useState with no persistence. Recovering required redoing the full OTP
 * email-verification round trip just to find out whether a system admin had
 * since approved or rejected the request -- even though the device already
 * held a persisted, verified (non-anonymous) Supabase session the whole
 * time. This proves the screen now checks get_my_family_onboarding_status()
 * on mount and recovers both the pending and the already-approved case.
 * Source-scan convention: this repo has no render-test harness for screens.
 */
describe('FamilyOnboardingScreen recovers onboarding status on mount (structural)', () => {
  const source = fs.readFileSync(require.resolve('../FamilyOnboardingScreen'), 'utf8').replace(/\r\n/g, '\n');

  it('imports getMyFamilyOnboardingStatus from lib/verifiedAdminOnboarding', () => {
    expect(source).toMatch(/getMyFamilyOnboardingStatus/);
  });

  it('calls it inside a mount-only useEffect (empty dependency array)', () => {
    const callIdx = source.indexOf('getMyFamilyOnboardingStatus()');
    expect(callIdx).toBeGreaterThan(-1);
    const effectIdx = source.lastIndexOf('useEffect(', callIdx);
    expect(effectIdx).toBeGreaterThan(-1);
    const afterCall = source.slice(callIdx, callIdx + 800);
    expect(afterCall).toMatch(/\},\s*\[\]\s*\)/);
  });

  it('recovers an already-approved family by calling setFamilyId(), not re-showing onboarding', () => {
    const callIdx = source.indexOf('getMyFamilyOnboardingStatus()');
    const scope = source.slice(callIdx, callIdx + 800);
    const activeIdx = scope.indexOf("status.approvalStatus === 'active'");
    const setFamilyIdIdx = scope.indexOf('setFamilyId(status.familyId)');
    expect(activeIdx).toBeGreaterThan(-1);
    expect(setFamilyIdIdx).toBeGreaterThan(activeIdx);
  });

  it('recovers a still-pending family by restoring the pending screen without redoing OTP', () => {
    const callIdx = source.indexOf('getMyFamilyOnboardingStatus()');
    const scope = source.slice(callIdx, callIdx + 800);
    const pendingIdx = scope.indexOf("status.approvalStatus === 'pending'");
    const setModeIdx = scope.indexOf("setMode('create')");
    const setNameIdx = scope.indexOf('setPendingApprovalFamilyName(status.familyName)');
    expect(pendingIdx).toBeGreaterThan(-1);
    expect(setModeIdx).toBeGreaterThan(pendingIdx);
    expect(setNameIdx).toBeGreaterThan(pendingIdx);
  });

  it('swallows errors so a failed/offline check falls back to the ordinary choose screen', () => {
    const callIdx = source.indexOf('getMyFamilyOnboardingStatus()');
    const scope = source.slice(callIdx, callIdx + 1000);
    expect(scope).toMatch(/\.catch\(/);
  });
});
