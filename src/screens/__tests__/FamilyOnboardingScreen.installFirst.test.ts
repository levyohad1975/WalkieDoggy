import fs from 'fs';

/**
 * Owner report 2026-11-03: on iPhone, the home-screen shortcut keeps storage
 * separate from Safari and from in-app browsers, so a member who joined in
 * the browser found the shortcut signed out. A join/invite link opened in an
 * iPhone browser (not the shortcut) now first explains how to save the app
 * to the home screen and copies the code; joining in the browser stays
 * possible as a secondary choice.
 */
describe('FamilyOnboardingScreen — install first on iPhone (structural)', () => {
  const source = fs.readFileSync(require.resolve('../FamilyOnboardingScreen'), 'utf8').replace(/\r\n/g, '\n');

  it('only an iPhone/iPad browser that is not the installed app, arriving with a link', () => {
    expect(source).toContain("const [installFirst] = useState(() => Boolean(initialInviteToken || initialJoinCode) && isIosBrowserNotInstalled(isInstalledWebApp));");
    expect(source).toMatch(/function isIosBrowserNotInstalled\(installed: boolean\): boolean \{\s*if \(Platform\.OS !== 'web' \|\| installed/);
  });

  it('keeps the link in the address while on that screen, so a saved shortcut can carry it', () => {
    expect(source).toContain("if (!installFirst && typeof window !== 'undefined' && window.history?.replaceState) {");
    expect((source.match(/if \(!installFirst && typeof window/g) ?? []).length).toBe(2);
  });

  it('shows the three steps, copies the code, and still allows joining in the browser', () => {
    const start = source.indexOf("if (mode === 'installFirst') {");
    const end = source.indexOf("if (mode === 'recover') {");
    expect(start).toBeGreaterThan(-1);
    const block = source.slice(start, end);
    expect(block).toContain('הוספה למסך הבית');
    expect(block).toContain('navigator.clipboard.writeText(shareText)');
    expect(block).toContain("onPress={() => setMode(initialInviteToken ? 'redeem' : 'join')}");
  });
});
