import fs from 'fs';

/**
 * Owner request 2026-11-03 (replaces the four-button neutral "pwaChoice"
 * screen, whose "המשפחה שלי כבר קיימת" and "הצטרפות למשפחה קיימת" looked
 * alike and confused family members): opening the home-screen shortcut
 * with no family starts on ONE clear screen — join with a code or link,
 * with a paste button — and only two quiet text links below it, for the
 * family admin's email sign-in and for creating a new family.
 * Source-scan convention: this repo has no render-test harness for screens.
 */
describe('FamilyOnboardingScreen starts the home-screen shortcut on the join screen (structural)', () => {
  const source = fs.readFileSync(require.resolve('../FamilyOnboardingScreen'), 'utf8').replace(/\r\n/g, '\n');

  it('the installed web app starts on join; a browser starts on the welcome screen', () => {
    expect(source).toContain("const startMode: Mode = isInstalledWebApp ? 'join' : 'choose';");
    expect(source).not.toContain('pwaChoice');
  });

  it('the join screen offers paste, accepts a personal invite link too, and links to admin sign-in and create', () => {
    const joinStart = source.indexOf('// mode === \'join\'');
    expect(joinStart).toBeGreaterThan(-1);
    const join = source.slice(joinStart);
    expect(join).toContain('label="📋 הדבקה" onPress={() => void pasteJoinText()}');
    expect(join).toContain("onPress={() => setMode('recover')}");
    expect(join).toContain("onPress={() => setMode('create')}");
    expect(source).toMatch(/if \(\/\[\?&\]invite=\/\.test\(value\) && parseInviteInput\(value\)\) \{\s*setRedeemInput\(value\);\s*setMode\('redeem'\);/);
  });

  it('every "back to start" action returns to this device\'s start screen', () => {
    expect(source).not.toMatch(/setMode\(isInstalledWebApp \?/);
    expect((source.match(/setMode\(startMode\)/g) ?? []).length).toBeGreaterThan(3);
  });
});
