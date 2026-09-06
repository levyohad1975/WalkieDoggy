/**
 * Round 5A — structural token-safety guard for InviteShareModal.tsx's QR
 * rendering addition. Same convention as
 * src/screens/__tests__/FamilyOnboardingScreen.tokenSafety.test.ts and
 * src/lib/__tests__/invites.test.ts's own "no forbidden imports" test: this
 * repo has no React Native component-rendering test infrastructure (see
 * those files' own doc comments), so this is a plain source-text scan, not
 * a rendered-component test.
 *
 * What this guarantees, specifically for the Round 5A QR addition:
 *  - the QR value is derived from the SAME `link` computed for Copy/Share
 *    (buildInviteLinkText(invite.rawToken)) — no second/parallel token or
 *    link representation is introduced;
 *  - the component never imports AsyncStorage directly, and never
 *    references SyncQueue/LocalRepository/OfflineFirstRepository or the
 *    Zustand store — the QR is rendered from local component-derived state
 *    only, exactly like the existing Copy/Share/revoke logic;
 *  - the component never logs (console.*) anywhere, so the QR value (or
 *    the raw token it is built from) can never reach a log call;
 *  - no image-saving/file-system/Photos/screenshot API is referenced —
 *    the QR is display-only, matching the approved design's explicit
 *    prohibition on persisting a QR image.
 */
describe('InviteShareModal — QR token safety (structural)', () => {
  function readSource(): string {
    return require('fs').readFileSync(require.resolve('../InviteShareModal'), 'utf8');
  }

  /**
   * Round 5A fix — the two assertions below originally scanned the RAW file
   * text, which counts this file's own doc comments (e.g. "...opaque-token
   * form (buildInviteLinkText())..." and "...no Platform.OS branching...")
   * as if they were executable code, producing false-positive failures once
   * those explanatory comments existed. This strips block comments and
   * line comments before those two assertions run, so they prove
   * the intended property against executable code only. This is a
   * pragmatic stripper, not a full TS/JSX tokenizer — safe here because
   * InviteShareModal.tsx's own string/template literals never contain a
   * `//` or `/*` sequence (verified by inspection; the invite link prefix
   * itself, e.g. `dogwalkfamily://invite/`, lives in logic/familyInvites.ts,
   * not in this file). The other tests in this suite intentionally keep
   * scanning raw source, matching this repo's established convention.
   */
  function stripComments(source: string): string {
    return source
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .split('\n')
      .map((line) => line.replace(/\/\/.*$/, ''))
      .join('\n');
  }

  it('there is exactly one executable canonical link construction, and QR/Copy/Share all consume that same variable (no second link/token source)', () => {
    const code = stripComments(readSource());

    // Exactly one executable call site for buildInviteLinkText.
    const buildCalls = code.match(/buildInviteLinkText\(/g) ?? [];
    expect(buildCalls.length).toBe(1);

    // That one call assigns the canonical `link` variable exactly as designed.
    expect(code).toMatch(/const link = buildInviteLinkText\(invite\.rawToken\);/);

    // QR, Copy, and Share all consume that same `link` variable — no
    // QR-specific or otherwise second token/link builder exists.
    expect(code).toMatch(/<QRCode[^>]*\bvalue=\{link\}/);
    expect(code).toMatch(/Clipboard\.setStringAsync\(link\)/);
    expect(code).toMatch(/\$\{link\}/); // Share.share's message template literal
  });

  it('never imports AsyncStorage directly, and never references SyncQueue/LocalRepository/OfflineFirstRepository/zustand', () => {
    const source = readSource();
    const importLines = source
      .split('\n')
      .filter((line: string) => /^\s*import\b/.test(line) || /require\(/.test(line));
    const importedText = importLines.join('\n');

    expect(importedText).not.toMatch(/AsyncStorage/);
    expect(importedText).not.toMatch(/SyncQueue/);
    expect(importedText).not.toMatch(/LocalRepository/);
    expect(importedText).not.toMatch(/OfflineFirstRepository/);
    expect(importedText).not.toMatch(/zustand/i);
    expect(source).not.toMatch(/AsyncStorage\.(setItem|getItem|multiSet)/);
  });

  it('never calls console.* anywhere in the file', () => {
    const source = readSource();
    expect(source).not.toMatch(/console\.(log|warn|error|info|debug)/);
  });

  it('never references any image-saving, filesystem, Photos, or screenshot API', () => {
    const source = readSource();
    expect(source).not.toMatch(/expo-file-system/i);
    expect(source).not.toMatch(/expo-media-library/i);
    expect(source).not.toMatch(/CameraRoll/);
    expect(source).not.toMatch(/captureRef/);
    expect(source).not.toMatch(/toDataURL/);
  });

  it('does not branch on Platform.OS anywhere in the executable code (platform-neutral QR rendering)', () => {
    const code = stripComments(readSource());
    expect(code).not.toMatch(/Platform\.OS/);
    // Stronger than the OS-branch check alone: Platform itself is never
    // even imported from react-native in executable code.
    expect(code).not.toMatch(/from ['"]react-native['"][^;]*\bPlatform\b/);
  });

  it('the QR payload prop never receives a token_hash, family id, target user id, role, auth id, or expiry field directly', () => {
    const source = readSource();
    // The only prop resembling a payload is value={link}; guard against a
    // future accidental widening to an object/JSON payload instead of the
    // canonical opaque link string.
    expect(source).not.toMatch(/<QRCode[^>]*\bvalue=\{[^}]*(tokenHash|token_hash|familyId|targetUserId|role|authUserId|expiresAt)[^}]*\}/);
  });
});
