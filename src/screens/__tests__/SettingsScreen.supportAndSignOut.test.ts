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

  it('"✉️ פנייה לתמיכה" opens the in-app "כתבו לנו" form, never the mail app (owner request 2026-11-02)', () => {
    expect(source).not.toMatch(/mailto:/);
    expect(source).not.toMatch(/\bLinking\b/);
    expect(source).toContain('<Button label="✉️ פנייה לתמיכה" variant="secondary" onPress={handleContactSupport} style={styles.addButton} />');
    const fnIdx = source.indexOf('const handleContactSupport = () => {');
    expect(fnIdx).toBeGreaterThan(-1);
    const fn = source.slice(fnIdx, source.indexOf('};', fnIdx));
    expect(fn).toContain('setManagementVisible(false);');
    expect(fn).toContain("setHelpCenterView('contact');");
    expect(fn).toContain('setHelpCenterVisible(true);');
    expect(source).toContain('<HelpCenterModal visible={helpCenterVisible} initialView={helpCenterView}');
  });

  it('the help window opens on the requested view', () => {
    const modal = fs.readFileSync(require.resolve('../../components/HelpCenterModal'), 'utf8');
    expect(modal).toContain("export function HelpCenterModal({ visible, onClose, initialView = 'faq' }: HelpCenterModalProps) {");
    expect(modal).toContain('setView(initialView);');
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
