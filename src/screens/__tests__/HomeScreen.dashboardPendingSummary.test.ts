import fs from 'fs';
import path from 'path';

/**
 * P1 real-iPhone QA (2026-10-15, 18:08): the Dashboard's "ממתינים לעדכון"
 * section used to render a full WalkRow per unresolved overdue walk —
 * months of September/October historical cards on a real family's data,
 * pushing all other Dashboard content (and the fixed bottom nav) out of
 * reach. This now renders a single compact count that links to the full,
 * date-unbounded list in the Schedule tab (see
 * ScheduleScreen.overduePendingSection.test.ts for that side).
 * Source-scan convention: this repo has no render-test harness for screens.
 */
describe('HomeScreen Dashboard "ממתינים לעדכון" compact summary (structural)', () => {
  const home = fs.readFileSync(path.join(__dirname, '..', 'HomeScreen.tsx'), 'utf8');

  it('replaces the full WalkRow list with one compact, countable summary row', () => {
    expect(home).not.toContain("import { WalkRow } from '../components/WalkRow';");
    const idx = home.indexOf("{overduePending.length > 0 ? (");
    expect(idx).toBeGreaterThan(-1);
    const block = home.slice(idx, home.indexOf('</Pressable>', idx));
    expect(block).toContain('ממתינים לעדכון · {overduePending.length}');
    expect(block).not.toContain('<WalkRow');
    expect(block).not.toContain('onMarkDone');
    expect(block).not.toContain('onMarkNotDone');
  });

  it('navigates to the Schedule tab on tap, where the full list lives', () => {
    const idx = home.indexOf("{overduePending.length > 0 ? (");
    const block = home.slice(idx, home.indexOf('</Pressable>', idx));
    expect(block).toContain("onPress={() => navigation.navigate('Schedule')}");
    expect(block).toContain('accessibilityRole="button"');
  });

  it('is visible only when there is at least one overdue pending walk (count is computed, never hardcoded)', () => {
    expect(home).toContain('{overduePending.length > 0 ? (');
    // The count that renders is the exact same memoized list Home already
    // computes (status pending, overdue, scoped to admin-or-responsible) —
    // not a second/duplicated calculation.
    expect(home).toContain('const overduePending = useMemo(');
  });
});
