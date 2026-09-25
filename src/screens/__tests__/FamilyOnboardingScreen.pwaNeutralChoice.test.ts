import fs from 'fs';

/**
 * FIX (Phase 1B): an installed-PWA launch (standalone display-mode / iOS
 * navigator.standalone) is ambiguous -- it's exactly as true for a
 * returning device reopening the home-screen icon as for a brand-new
 * install that just added the icon during setup. There is no reliable
 * synchronous client-side signal to distinguish them (even a brand-new
 * device already has an anonymous Supabase session by the time this
 * screen renders). The screen previously defaulted every installed-PWA
 * launch straight into 'recover' mode, silently assuming "returning" for
 * every case including first-time installs -- flagged in the Phase 1A
 * Integration Evidence Report as a real, untested UX misfire and
 * explicitly deferred rather than risking a blind rewrite of this
 * security/UX-sensitive onboarding logic.
 *
 * This proves the fix: an installed-PWA launch now lands on a neutral
 * 'pwaChoice' screen offering three equal-weight options -- "המשפחה שלי
 * כבר קיימת" (recover), "יש לי הזמנה" (redeem), "יצירת משפחה חדשה"
 * (create) -- and every "back" action from the flows it leads into
 * returns to that same neutral screen for a PWA device, never assuming
 * the generic (non-PWA) two-hotspot choose screen.
 * Source-scan convention: this repo has no render-test harness for screens.
 */
describe('FamilyOnboardingScreen offers a neutral choice for installed-PWA launches (structural)', () => {
  const source = fs.readFileSync(require.resolve('../FamilyOnboardingScreen'), 'utf8').replace(/\r\n/g, '\n');

  it('defaults an installed-PWA launch to pwaChoice, not recover', () => {
    expect(source).toMatch(/useState<Mode>\(isInstalledWebApp \? 'pwaChoice' : 'choose'\)/);
  });

  it('renders a pwaChoice branch offering all three onward modes', () => {
    const blockStart = source.indexOf("mode === 'pwaChoice'");
    const blockEnd = source.indexOf("mode === 'recover'");
    expect(blockStart).toBeGreaterThan(-1);
    expect(blockEnd).toBeGreaterThan(blockStart);
    const block = source.slice(blockStart, blockEnd);
    expect(block).toMatch(/setMode\('recover'\)/);
    expect(block).toMatch(/setMode\('redeem'\)/);
    expect(block).toMatch(/setMode\('create'\)/);
    // Neutral: no option should read as the assumed/default path -- all
    // three are the same button variant.
    expect(block.match(/variant="secondary"/g)?.length).toBe(3);
  });

  it('every "back to start" action is PWA-aware, not a hardcoded choose', () => {
    const backActions = source.match(/setMode\(('choose'|isInstalledWebApp \? 'pwaChoice' : 'choose')\)/g) ?? [];
    expect(backActions.length).toBeGreaterThan(0);
    for (const action of backActions) {
      expect(action).toBe("setMode(isInstalledWebApp ? 'pwaChoice' : 'choose')");
    }
  });
});
