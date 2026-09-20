import fs from 'fs';
import path from 'path';

/**
 * QA Guardian sweep — regression guard for a real inconsistency found in
 * FamilySharingModal.tsx: the displayed invite code (always drawn from
 * generate_invite_code()'s plain Latin-letter/digit alphabet — see
 * supabase/migrations/0002_invite_codes_and_family_membership.sql — inherently
 * LTR content) was rendered via `<RtlText style={styles.codeText}>` with no
 * writingDirection/textAlign override, so it silently inherited RtlText's
 * default `textAlign: 'right', writingDirection: 'rtl'`. This is the same bug
 * class already fixed once in FamilyOnboardingScreen.tsx's redeem-input field
 * (see FamilyOnboardingScreen.redeemInputAlignment.test.ts) and contradicts
 * both RtlText.tsx's own doc comment (which names "PINs" as an example
 * needing an override) and InviteShareModal.tsx's sibling `linkText`
 * convention (`textAlign: 'left', writingDirection: 'ltr'`) for the same kind
 * of invite content.
 *
 * This repo has no React Native component-rendering test infrastructure, so —
 * consistent with this file's own FamilySharingModal.copyFeedback.test.ts —
 * this is a plain source-text scan, not a rendered-component test.
 */
describe('FamilySharingModal — invite code LTR alignment (structural)', () => {
  const source = fs.readFileSync(path.resolve(__dirname, '../FamilySharingModal.tsx'), 'utf8');

  it('styles the invite code text for LTR content, matching InviteShareModal\'s link convention', () => {
    expect(source).toMatch(/<RtlText style=\{\[styles\.codeText, styles\.ltrText\]\} selectable>/);
    expect(source).toMatch(/ltrText:\s*\{\s*textAlign:\s*'center',\s*writingDirection:\s*'ltr'\s*\}/);
  });
});
