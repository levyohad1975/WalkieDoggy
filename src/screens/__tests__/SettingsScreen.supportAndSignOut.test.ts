import fs from 'fs';

/**
 * PRD §16: "Settings includes: ... support and sign-out" ("תמיכה ויציאה"),
 * and "keep a clear support channel from within the app; the final
 * support address should come from configuration, not be scattered in
 * code." Source-scan convention: this repo has no render-test harness
 * for screens.
 */
describe('SettingsScreen wires support + sign-out (structural)', () => {
  const source = fs.readFileSync(require.resolve('../SettingsScreen'), 'utf8').replace(/\r\n/g, '\n');

  it('reads the support address from EXPO_PUBLIC_SUPPORT_EMAIL, never a hardcoded address', () => {
    expect(source).toMatch(/const supportEmail = process\.env\.EXPO_PUBLIC_SUPPORT_EMAIL;/);
    expect(source).not.toMatch(/mailto:[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
  });

  it('the support action only renders once an address is actually configured', () => {
    const advancedIdx = source.indexOf('🛠️ מתקדם');
    expect(advancedIdx).toBeGreaterThan(-1);
    const block = source.slice(advancedIdx, advancedIdx + 2500);
    expect(block).toMatch(/supportEmail \? \(/);
    expect(block).toContain('✉️ פנייה לתמיכה');
  });

  it('opens the configured address via Linking.openURL with a mailto: scheme', () => {
    expect(source).toMatch(/import \{[^}]*\bLinking\b[^}]*\} from 'react-native';/);
    expect(source).toMatch(/Linking\.openURL\(`mailto:\$\{supportEmail\}`\)/);
  });

  it('device disconnect is kept in the admin-only advanced area', () => {
    const rowIdx = source.indexOf('onPress={handleSignOut}');
    expect(rowIdx).toBeGreaterThan(-1);
    const adminSectionIdx = source.indexOf("familyRole === 'admin' ? (");
    expect(rowIdx).toBeGreaterThan(adminSectionIdx);
    expect(source.slice(adminSectionIdx, rowIdx + 300)).toContain('🚪 ניתוק המכשיר');
  });

  it('sign-out requires confirmation before calling authStore.signOut()', () => {
    const fnIdx = source.indexOf('const handleSignOut = ()');
    expect(fnIdx).toBeGreaterThan(-1);
    const fn = source.slice(fnIdx, source.indexOf('};', fnIdx));
    expect(fn).toMatch(/const performSignOut = \(\) => void signOut\(\);/);
    expect(fn).toMatch(/style: 'destructive', onPress: performSignOut/);
    expect(fn).toMatch(/text: 'ביטול', style: 'cancel'/);
  });
});
