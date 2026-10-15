import fs from 'fs';
import path from 'path';

/**
 * P1 real-iPhone QA (2026-10-15, 18:08): the Dashboard's full "ממתינים
 * לעדכון" list was replaced with a compact count (see
 * HomeScreen.dashboardPendingSummary.test.ts) that links here. This is the
 * one place the full, date-unbounded list now lives — reusing
 * ScheduleScreen's OWN existing data (visibleWalks) and resolution path
 * (canResolveWalk / resolveWalkId+CompleteWalkModal / skip), not a second
 * data source, a second permission rule or a new screen.
 * Source-scan convention: this repo has no render-test harness for screens.
 */
describe('ScheduleScreen "ממתינים לעדכון" — the full, date-unbounded pending list (structural)', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'ScheduleScreen.tsx'), 'utf8');

  it('computes the full list from the same dog-scoped walks and the same canResolveWalk rule the day view already uses — not a second data source', () => {
    const idx = source.indexOf('const allOverduePending = useMemo(');
    expect(idx).toBeGreaterThan(-1);
    const block = source.slice(idx, source.indexOf(');', idx));
    expect(block).toContain('visibleWalks.filter(canResolveWalk)');
    expect(source).toContain('const canResolveWalk = (w: Walk): boolean =>\n    w.status === \'pending\' &&\n    isOverdue(w) &&\n    (familyRole === \'admin\' || w.responsibleUserId === effectiveUserId);');
  });

  it('renders at the very top of the screen (right after the dog selector, before the week/routine tabs) so navigating here needs no extra scroll-targeting', () => {
    const dogSelectorIdx = source.indexOf('<DogSelectorRow');
    const overdueSectionIdx = source.indexOf('testID="schedule-overdue-pending-section"');
    const tabsIdx = source.indexOf('<View style={styles.tabs}>');
    expect(dogSelectorIdx).toBeGreaterThan(-1);
    expect(overdueSectionIdx).toBeGreaterThan(dogSelectorIdx);
    expect(tabsIdx).toBeGreaterThan(overdueSectionIdx);
  });

  it('wires the same resolve/skip actions (CompleteWalkModal + skip) the day view already uses for an overdue walk, not a new mutation path', () => {
    const idx = source.indexOf('testID="schedule-overdue-pending-section"');
    const block = source.slice(idx, source.indexOf('<View style={styles.tabs}>', idx));
    expect(block).toContain('onMarkDone={() => setResolveWalkId(w.id)}');
    expect(block).toContain('onMarkNotDone={() => skip(w.id)}');
    // setResolveWalkId feeds the SAME CompleteWalkModal the day view's own
    // canResolveWalk-gated row already opens — confirmed by its single
    // definition below.
    expect(source).toContain('const resolveWalk = resolveWalkId ? walks.find((w) => w.id === resolveWalkId) : undefined;');
    expect(source).toContain('<CompleteWalkModal\n        visible={!!resolveWalk}');
  });

  it('shows the count in the header and only renders when at least one such walk exists', () => {
    expect(source).toContain('ממתינים לעדכון ({allOverduePending.length})');
    expect(source).toContain('{allOverduePending.length > 0 ? (');
  });
});
