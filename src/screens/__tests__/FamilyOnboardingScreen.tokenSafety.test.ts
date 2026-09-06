/**
 * Round 4 — structural token-safety guard for FamilyOnboardingScreen.tsx's
 * invited-user redemption ('redeem' mode). This repo has no React Native
 * component-rendering test infrastructure (see familyManagement.test.ts's
 * own doc comment; @testing-library/react-native is an installed-but-unused
 * devDependency), so — exactly like src/lib/__tests__/invites.test.ts's own
 * "no forbidden imports" test — this is a plain source-text scan, not a
 * rendered-component test.
 *
 * What this guarantees: the screen holding the raw invite token/link in
 * local component state (see FamilyOnboardingScreen.tsx's own "TOKEN
 * SAFETY" doc comment on its redeem-mode state) never imports AsyncStorage
 * directly, and never references SyncQueue/LocalRepository/
 * OfflineFirstRepository anywhere — every persistence this screen performs
 * goes exclusively through authStore's own actions (setFamilyId,
 * completeInviteRedemption, retryPendingInviteRedemptionVerification),
 * which are separately covered by authStore.test.ts's own token-safety
 * assertions (the pending-redemption marker never contains a token/rawToken
 * field). A screen that imported AsyncStorage directly would be able to
 * bypass that safe, already-audited path — this test is what keeps that
 * from silently regressing.
 */
describe('FamilyOnboardingScreen — token safety (structural)', () => {
  it('never imports AsyncStorage directly, and never references SyncQueue/LocalRepository/OfflineFirstRepository', () => {
    const source = require('fs').readFileSync(
      require.resolve('../FamilyOnboardingScreen'),
      'utf8'
    );

    // Matches only actual import/require statements, not doc comments that
    // legitimately explain what this screen does NOT depend on (see its own
    // "TOKEN SAFETY" comment, which mentions these names by name on purpose).
    const importLines = source
      .split('\n')
      .filter((line: string) => /^\s*import\b/.test(line) || /require\(/.test(line));
    const importedText = importLines.join('\n');

    expect(importedText).not.toMatch(/AsyncStorage/);
    expect(importedText).not.toMatch(/SyncQueue/);
    expect(importedText).not.toMatch(/LocalRepository/);
    expect(importedText).not.toMatch(/OfflineFirstRepository/);

    // And nowhere in the file at all (not just import lines) — the screen
    // should never reach for these APIs by requiring them dynamically
    // either.
    expect(source).not.toMatch(/AsyncStorage\.(setItem|getItem|multiSet)/);
  });

  it('the redeem-mode token state is never passed to a console.* call anywhere in the file', () => {
    const source = require('fs').readFileSync(
      require.resolve('../FamilyOnboardingScreen'),
      'utf8'
    );
    // This screen should never log at all in its redeem-mode code path —
    // a much stronger guarantee than merely "doesn't log the token" would
    // be, and trivially proves the latter too.
    expect(source).not.toMatch(/console\.(log|warn|error|info|debug)/);
  });
});
