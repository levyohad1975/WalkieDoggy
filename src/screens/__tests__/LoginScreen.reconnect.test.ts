import fs from 'fs';

/**
 * Production 2026-11-03: a device whose session no longer belongs to its
 * family saw "אין פרופיל פעיל לבחירה" with no way out. Source-scan
 * convention: this repo has no render-test harness for screens.
 */
describe('LoginScreen never dead-ends a disconnected device', () => {
  const source = fs.readFileSync(require.resolve('../LoginScreen'), 'utf8');

  it('offers "חיבור מחדש למשפחה" on the no-profile state', () => {
    const idx = source.indexOf('title="אין פרופיל פעיל לבחירה"');
    expect(idx).toBeGreaterThan(-1);
    const block = source.slice(idx, idx + 700);
    expect(block).toContain('label="🔑 חיבור מחדש למשפחה"');
    expect(block).toContain('onPress={() => void reconnectToFamily()}');
  });
});
