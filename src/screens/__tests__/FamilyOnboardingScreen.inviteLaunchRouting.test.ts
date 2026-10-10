import fs from 'fs';

/**
 * Family Lifecycle repair, items 1 & 2 — "A valid invite token arriving
 * through the URL must take precedence over generic onboarding and route
 * directly into the invitation flow," bypassing the broken real-device
 * sequence QA found (pwaChoice's "רגע לפני שממשיכים" 3-way choice, and
 * recover's manual admin-email/verification-code screen).
 *
 * Source-scan convention: this repo has no render-test harness for screens
 * (see FamilyOnboardingScreen.pwaNeutralChoice.test.ts's own doc comment).
 */
describe('FamilyOnboardingScreen — invite-link launch detection takes precedence over generic onboarding (structural)', () => {
  const source = fs.readFileSync(require.resolve('../FamilyOnboardingScreen'), 'utf8').replace(/\r\n/g, '\n');

  it('reads an ?invite= token from the launch URL synchronously, once, before the first render', () => {
    expect(source).toMatch(
      /const \[initialInviteToken\] = useState<string \| null>\(\(\) => \{[\s\S]*?new URLSearchParams\(window\.location\.search\)\.get\('invite'\)/
    );
  });

  it('a present invite token wins over a join code and over isInstalledWebApp — mode initializes straight into redeem, never pwaChoice or choose', () => {
    const modeInit = source.match(/useState<Mode>\(([^)]*)\);/);
    expect(modeInit).not.toBeNull();
    expect(modeInit![1].replace(/\s+/g, ' ').trim()).toBe(
      "initialInviteToken ? 'redeem' : initialJoinCode ? 'join' : isInstalledWebApp ? 'pwaChoice' : 'choose'"
    );
  });

  it('a present join code (with no invite token) also bypasses pwaChoice/choose, landing straight in join mode', () => {
    expect(source).toMatch(/const \[initialJoinCode\] = useState<string \| null>\(\(\) => \{[\s\S]*?new URLSearchParams\(window\.location\.search\)\.get\('join'\)/);
  });

  it('auto-prefills and auto-looks-up the join code on mount, but only when no invite token already claimed the launch', () => {
    const effectStart = source.indexOf('if (!initialJoinCode || initialInviteToken) return;');
    expect(effectStart).toBeGreaterThan(-1);
    const effectBlock = source.slice(effectStart, effectStart + 500);
    expect(effectBlock).toMatch(/setCode\(normalized\)/);
    expect(effectBlock).toMatch(/lookup\(normalized\)/);
  });

  it('auto-prefills and auto-inspects the token on mount, with no manual paste/typing required', () => {
    const effectStart = source.indexOf('if (!initialInviteToken) return;');
    expect(effectStart).toBeGreaterThan(-1);
    const effectBlock = source.slice(effectStart, effectStart + 600);
    expect(effectBlock).toMatch(/setRedeemInput\(initialInviteToken\)/);
    expect(effectBlock).toMatch(/inspectInvite\(initialInviteToken\)/);
  });

  it('strips the invite query param from the visible URL after capturing it, via history.replaceState (best-effort)', () => {
    const effectStart = source.indexOf('if (!initialInviteToken) return;');
    const effectBlock = source.slice(effectStart, effectStart + 900);
    expect(effectBlock).toMatch(/window\.history\?\.replaceState/);
    expect(effectBlock).toMatch(/searchParams\.delete\('invite'\)/);
  });

  it('inspectInvite accepts an override token (for the auto-detected launch flow) while still defaulting to the manual-paste input', () => {
    expect(source).toMatch(/const inspectInvite = async \(overrideInput\?: string\) => \{/);
    expect(source).toMatch(/const parsed = parseInviteInput\(overrideInput \?\? redeemInput\);/);
  });

  it('manual token/code entry remains available as a fallback — the redeemInput TextInput and its "בדיקת ההזמנה" button are unchanged for a recipient with no launch-URL token', () => {
    expect(source).toMatch(/accessibilityLabel="קישור או קוד הזמנה"/);
    expect(source).toMatch(/label=\{inspecting \? 'בודק\.\.\.' : 'בדיקת ההזמנה'\}/);
  });
});
