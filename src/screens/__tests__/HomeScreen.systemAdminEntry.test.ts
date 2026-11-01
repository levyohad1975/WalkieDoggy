/**
 * Structural guard (no RN rendering harness in this repo).
 *
 * Production report 2026-11-01: a verified System Admin (am_i_system_admin
 * returned true) could not open the console from the header dog on the
 * installed iPhone app. iOS treats tap pairs as a zoom gesture and swallows
 * their clicks, so three quick taps rarely all registered within 700ms.
 */
describe('HomeScreen — System Admin entry from the header dog', () => {
  const fs = require('fs');
  const path = require('path');
  const source: string = fs.readFileSync(require.resolve('../HomeScreen'), 'utf8');
  const html: string = fs.readFileSync(path.join(__dirname, '../../../public/index.html'), 'utf8');

  it('keeps the triple tap with a forgiving window', () => {
    expect(source).toContain('if (mascotTapCountRef.current >= 3) {');
    expect(source).toMatch(/mascotTapTimerRef\.current = null;\n\s*\}, 1200\);/);
  });

  it('opens the console on a long press, for System Admins only', () => {
    expect(source).toContain('onLongPress={isSystemAdmin ? handleHeaderMascotLongPress : undefined}');
    expect(source).toMatch(/handleHeaderMascotLongPress = useCallback\(\(\) => \{\n\s*if \(!isSystemAdmin\) return;[\s\S]*?requestOpenSystemAdmin\(\);/);
  });

  it('non-admins still get the dog profile on a single tap', () => {
    expect(source).toMatch(/if \(!isSystemAdmin\) \{\n\s*setDogProfileVisible\(true\);\n\s*return;/);
  });

  it('disables iOS double-tap zoom so repeated taps reach the app', () => {
    expect(html).toMatch(/html,\s*body \{[^}]*touch-action: manipulation;/);
    expect(html).toMatch(/\[role="button"\] \{[^}]*touch-action: manipulation;/);
  });
});
