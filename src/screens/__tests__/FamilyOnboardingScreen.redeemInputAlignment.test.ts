/**
 * QA Guardian sweep (first pass over the applicant-facing onboarding
 * screens' RTL behavior — prior sweeps on this campaign only covered the
 * System Admin side, see EXECUTION_STATE.md) — regression guard for a real
 * inconsistency found in FamilyOnboardingScreen.tsx's 'redeem' mode: the
 * "יש לי הזמנה" paste field accepts either the full
 * `dogwalkfamily://invite/<token>` link (built by
 * logic/familyInvites.ts's buildInviteLinkText()) or the raw opaque token
 * (logic/familyInvites.ts's parseInviteInput()) — both LTR content — yet was
 * styled `textAlign="right"` with no writingDirection override, unlike this
 * app's own established convention for the exact same link content
 * (components/InviteShareModal.tsx's `linkText` style: `textAlign: 'left',
 * writingDirection: 'ltr'`).
 *
 * This repo has no React Native component-rendering test infrastructure
 * (see FamilyOnboardingScreen.tokenSafety.test.ts's own doc comment), so —
 * consistent with that file's own approach — this is a plain source-text
 * scan, not a rendered-component test.
 */
describe('FamilyOnboardingScreen — redeem-input LTR alignment (structural)', () => {
  it('styles the invite link/token paste field for LTR content, matching InviteShareModal\'s link convention', () => {
    const source = require('fs').readFileSync(require.resolve('../FamilyOnboardingScreen'), 'utf8');

    const redeemInputBlockMatch = source.match(
      /value=\{redeemInput\}[\s\S]*?\/>/
    );
    expect(redeemInputBlockMatch).not.toBeNull();
    const redeemInputBlock = redeemInputBlockMatch![0];

    expect(redeemInputBlock).toMatch(/textAlign="left"/);
    expect(redeemInputBlock).toMatch(/styles\.ltrInput/);
    expect(redeemInputBlock).not.toMatch(/textAlign="right"/);

    expect(source).toMatch(/ltrInput:\s*\{\s*writingDirection:\s*'ltr'\s*\}/);
  });
});
