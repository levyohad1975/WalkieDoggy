/**
 * NARROW CLIENT-FLOW FIX — structural guard for SettingsScreen.tsx's
 * "החלף משתמש" control flow. This repo has no React Native
 * component-rendering test infrastructure (see
 * FamilyOnboardingScreen.tokenSafety.test.ts's own doc comment;
 * @testing-library/react-native is an installed-but-unused devDependency),
 * so — same convention — this is a plain source-text scan of
 * SettingsScreen.tsx, not a rendered-component test. The actual RPC-call
 * behavior of signInWithPin()/claim_family_profile_with_pin() itself
 * (including the wrong-PIN-leaves-old-claim-untouched and successful-switch
 * guarantees) is exercised for real, with mocked RPCs, in
 * authStore.test.ts's "familyRole refresh after a claim" describe block —
 * this file only proves SettingsScreen actually WIRES UP that already-
 * correct store logic the right way: the fix required by this pass was a
 * CONTROL-FLOW bug (which function gets called when, and under what
 * condition the PIN modal opens), not a change to claim_family_profile_with_pin()
 * itself, so a source-shape guard is the right kind of guarantee here.
 *
 * THE BUG THIS GUARDS AGAINST REGRESSING: "החלף משתמש" used to call
 * authStore.signOut() immediately on tap, then rely on LoginScreen's plain
 * signIn()/claim_family_profile() (routing to PIN only on the specific
 * 'already claimed by another device' error string) — which left a
 * same-device switch able to hit a raw unique-constraint failure with no
 * path to the PIN flow, AND dropped the user out to a signed-out
 * LoginScreen state even on Cancel/failure. The fix: "החלף משתמש" now opens
 * a target picker and ALWAYS routes straight to PIN verification
 * (signInWithPin -> claim_family_profile_with_pin(), the already-atomic RPC
 * from the last pass) for ANY chosen target, and never calls signOut() at
 * all.
 */
describe('SettingsScreen — "החלף משתמש" control flow (structural)', () => {
  const source = require('fs').readFileSync(require.resolve('../SettingsScreen'), 'utf8');

  function extractFunctionBody(fnStartMarker: string): string {
    const startIdx = source.indexOf(fnStartMarker);
    expect(startIdx).toBeGreaterThan(-1);
    // Grab a generous window after the marker — enough to contain the whole
    // function body for every function this file inspects, without needing
    // a real brace-matching parser for a plain text-scan test.
    return source.slice(startIdx, startIdx + 1500);
  }

  it('handleSwitchUser never calls signOut()', () => {
    const body = extractFunctionBody('const handleSwitchUser = ()');
    // Only as far as the next top-level const declaration, so this check
    // stays scoped to handleSwitchUser itself and doesn't accidentally
    // inspect unrelated code below it.
    const scoped = body.slice(0, body.indexOf('const handleSwitchUserPinSubmit'));
    expect(scoped).not.toMatch(/signOut\s*\(/);
  });

  it('the file no longer calls signOut() anywhere in actual code (comments aside)', () => {
    // The whole point of this pass's fix: "switch user" must never sign out
    // locally before a switch is verified. Doc comments in this file
    // legitimately mention signOut() BY NAME to explain the OLD, now-fixed
    // bug (see handleSwitchUser's own doc comment) — so this strips
    // // line comments and /* */ block comments first, then asserts no
    // actual `signOut(` CALL remains anywhere in the executable code,
    // which is the real guarantee: nothing in this screen reaches for it.
    const withoutComments = source
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');
    expect(withoutComments).not.toMatch(/\bsignOut\s*\(/);
  });

  it('handleSwitchUser only opens the target picker — no direct RPC/claim call of its own', () => {
    const body = extractFunctionBody('const handleSwitchUser = ()');
    const scoped = body.slice(0, body.indexOf('const handleSwitchUserPinSubmit'));
    expect(scoped).toMatch(/setSwitchUserPickerVisible\(true\)/);
    expect(scoped).not.toMatch(/signIn(WithPin)?\s*\(/);
  });

  it('the switch-target picker\'s onSelect routes straight to the PIN step, never attempting a plain claim first', () => {
    const startIdx = source.indexOf('<UserPickerModal');
    expect(startIdx).toBeGreaterThan(-1);
    const block = source.slice(startIdx, startIdx + 800);
    expect(block).toMatch(/onSelect=\{[\s\S]*?setSwitchTargetUserId\(userId\)/);
    // Must NOT call signIn (the plain, non-PIN claim path) anywhere in this
    // picker's onSelect handler — every chosen target goes through PIN.
    const onSelectHandler = block.slice(block.indexOf('onSelect='), block.indexOf('onClose='));
    expect(onSelectHandler).not.toMatch(/\bsignIn\(/);
  });

  it('handleSwitchUserPinSubmit calls signInWithPin (the atomic, PIN-verified claim transfer), not plain signIn', () => {
    const startIdx = source.indexOf('const handleSwitchUserPinSubmit = async (pin: string)');
    expect(startIdx).toBeGreaterThan(-1);
    // This function is short — end it at its own closing "};" (the first
    // one after the marker), so the scope can't accidentally spill into
    // unrelated code below.
    const endIdx = source.indexOf('};', startIdx);
    const scoped = source.slice(startIdx, endIdx);
    expect(scoped).toMatch(/signInWithPin\(switchTargetUserId, pin\)/);
    expect(scoped).not.toMatch(/\bsignIn\(switchTargetUserId/);
  });

  it('the switch-user PinEntryModal\'s onCancel only clears local picker state — no store action, no signOut', () => {
    const idx = source.indexOf('visible={switchTargetUserId !== null}');
    expect(idx).toBeGreaterThan(-1);
    const block = source.slice(idx, idx + 400);
    expect(block).toMatch(/onCancel=\{\(\) => setSwitchTargetUserId\(null\)\}/);
  });
});

