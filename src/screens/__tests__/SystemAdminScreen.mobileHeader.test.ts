/**
 * Structural guard (no RN rendering harness in this repo).
 *
 * Production report 2026-11-01 (iPhone): the System Admin console header put
 * the title, four links and "סגירה" on one row; on a phone the row
 * overflowed and the close button was off-screen, leaving no way out.
 */
describe('SystemAdminScreen — the close button is always reachable on a phone', () => {
  const source: string = require('fs').readFileSync(require.resolve('../SystemAdminScreen'), 'utf8');

  it('title and close share their own top row, before the links', () => {
    const top = source.indexOf('<View style={styles.headerTopRow}>');
    const close = source.indexOf('accessibilityLabel="סגירת ניהול מערכת"');
    const links = source.indexOf('<View style={styles.headerActions}>');
    expect(top).toBeGreaterThan(-1);
    expect(close).toBeGreaterThan(top);
    expect(links).toBeGreaterThan(close);
    expect(source.match(/accessibilityLabel="סגירת ניהול מערכת"/g)?.length).toBe(1);
  });

  it('the links wrap instead of pushing content off-screen', () => {
    expect(source).toMatch(/headerActions: \{[^}]*flexWrap: 'wrap'/);
    expect(source).toMatch(/closeButton: \{ flexShrink: 0/);
  });
});
