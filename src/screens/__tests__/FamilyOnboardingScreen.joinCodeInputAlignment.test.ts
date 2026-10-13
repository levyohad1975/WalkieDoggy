/**
 * Regression guard for a real inconsistency found in
 * FamilyOnboardingScreen.tsx's 'join' mode: the "קוד הזמנה" invite-code
 * field accepts the same alphanumeric, mixed letters/digits invite code
 * (supabase/migrations/0002_invite_codes_and_family_membership.sql's
 * generate_invite_code(), alphabet 'ABCDEFGHJKMNPQRSTUVWXYZ23456789') as
 * this file's own 'redeem' mode paste field (see
 * FamilyOnboardingScreen.redeemInputAlignment.test.ts) and as
 * FamilySharingModal.tsx's displayed invite code — both already styled
 * for LTR content via `styles.ltrInput` — yet this field used only
 * `styles.codeInput` (font size/weight/letter-spacing) with no
 * writingDirection override, the one remaining call site of this
 * already-established fix pattern in the codebase.
 *
 * This repo has no React Native component-rendering test infrastructure
 * (see FamilyOnboardingScreen.tokenSafety.test.ts's own doc comment), so —
 * consistent with that file's own approach — this is a plain source-text
 * scan, not a rendered-component test.
 */
describe('FamilyOnboardingScreen — join-code input LTR alignment (structural)', () => {
  it('styles the invite-code field for LTR content, matching the redeem field and FamilySharingModal\'s own invite-code convention', () => {
    const source = require('fs').readFileSync(require.resolve('../FamilyOnboardingScreen'), 'utf8');

    const codeInputBlockMatch = source.match(
      /value=\{code\}[\s\S]*?\/>/
    );
    expect(codeInputBlockMatch).not.toBeNull();
    const codeInputBlock = codeInputBlockMatch![0];

    expect(codeInputBlock).toMatch(/styles\.ltrInput/);
    expect(codeInputBlock).toMatch(/styles\.codeInput/);

    expect(source).toMatch(/ltrInput:\s*\{\s*writingDirection:\s*'ltr'\s*\}/);
  });
});
