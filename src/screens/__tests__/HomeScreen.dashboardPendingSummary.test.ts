import fs from 'fs';
import path from 'path';

// Approved iPhone QA: overdue actions live exclusively in Schedule.
// Home must not show a redundant summary with a different count.
describe('HomeScreen Dashboard excludes redundant pending summary', () => {
  const home = fs.readFileSync(path.join(__dirname, '..', 'HomeScreen.tsx'), 'utf8');

  it('does not show a pending-update count or a second overdue walk list', () => {
    expect(home).not.toContain('>ממתינים לעדכון');
    expect(home).not.toContain('overduePending');
    expect(home).not.toContain('dashboardPendingSummary');
    expect(home).not.toContain('<WalkRow');
  });

  it('keeps the full daily timeline and its Schedule navigation', () => {
    expect(home).toContain('dashboardTimelineWalks.map');
    expect(home).toContain('בהמשך היום');
    expect(home).toContain('accessibilityLabel="פתיחת המשך הטיולים של היום בלוח הזמנים"');
  });
});
