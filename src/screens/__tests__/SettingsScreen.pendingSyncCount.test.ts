import fs from 'fs';

/**
 * PRD §25's "sync pending" state (how many writes made on this device are
 * still queued, not yet reached the server) — repository.pendingSyncCount()
 * was already built and unit-tested at the data layer
 * (offlineFirstRepository.test.ts) but had zero UI consumer anywhere.
 * Source-scan convention: this repo has no render-test harness for screens.
 */
describe('SettingsScreen surfaces pending-sync count (structural)', () => {
  const source = fs.readFileSync(require.resolve('../SettingsScreen'), 'utf8').replace(/\r\n/g, '\n');

  it('fetches pendingSyncCount on every focus, alongside the existing conflict/quarantine checks', () => {
    const idx = source.indexOf('repository.pendingSyncCount?.()');
    expect(idx).toBeGreaterThan(-1);
    const before = source.slice(Math.max(0, idx - 400), idx);
    expect(before).toMatch(/useFocusEffect\(/);
    expect(before).toContain('repository.getSyncConflicts?.()');
  });

  it('the row only renders when there is genuinely something still syncing, and is never a tappable Pressable', () => {
    const rowIdx = source.indexOf('{pendingSyncCount > 0 ? (');
    expect(rowIdx).toBeGreaterThan(-1);
    const block = source.slice(rowIdx, rowIdx + 800);
    expect(block).toMatch(/<View style=\{styles\.hubRow\}/);
    expect(block).not.toContain('<Pressable');
    expect(block).toContain('{pendingSyncCount} שינויים ממתינים לסנכרון עם השרת');
  });
});
