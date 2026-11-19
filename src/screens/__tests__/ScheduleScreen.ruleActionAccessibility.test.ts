import fs from 'fs';
import path from 'path';

/**
 * Owner request 2026-11-09: the routine is a weekly grid (RoutineGrid) instead
 * of rule rows with ✏️/🗑️ icons. Every editable cell and time label is a
 * button with a label a screen reader can speak (day, time, who walks).
 */
describe('ScheduleScreen — routine grid accessibility', () => {
  const screen = fs.readFileSync(path.resolve(__dirname, '../ScheduleScreen.tsx'), 'utf8');
  const grid = fs.readFileSync(path.resolve(__dirname, '../../components/RoutineGrid.tsx'), 'utf8');

  it('ScheduleScreen shows the routine as the grid, editable by admins only', () => {
    expect(screen).toContain('<RoutineGrid');
    expect(screen).toContain("canEdit={familyRole === 'admin'}");
  });

  it('each cell says the day, the time and who walks', () => {
    // 2026-11-10: a cell with an open routine change request says so too.
    expect(grid).toContain("accessibilityLabel={`יום ${DAY_LONG_LABELS[day]} ${row.time}: ${cellName(c)}${requestCells.has(`${day}|${row.time}`) ? ' (יש בקשה פתוחה)' : ''}`}");
    expect(grid).toContain("accessibilityRole={canEdit ? 'button' : undefined}");
  });

  it('each time label is a button to change or remove that row', () => {
    expect(grid).toContain('accessibilityLabel={canEdit ? `שינוי או מחיקה של שעת ${row.time}` : row.time}');
  });
});
