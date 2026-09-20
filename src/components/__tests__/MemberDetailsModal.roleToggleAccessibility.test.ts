import fs from 'fs';
import path from 'path';

/**
 * QA Guardian sweep (accessibility labels on non-Button Pressable elements):
 * the role-toggle chips ("בן משפחה"/"מנהל") behave like a radio group but
 * lacked accessibilityRole="radio"/accessibilityState, unlike the identical
 * single-select-chip pattern in DeleteUserModal.tsx/EditDoneDetailsModal.tsx.
 * Verifies both chips now carry the same radio role/state via the
 * source-scan convention this repo uses for RN components it can't
 * render-test directly.
 */
describe('MemberDetailsModal — role toggle chip accessibility', () => {
  const source = fs.readFileSync(path.resolve(__dirname, '../MemberDetailsModal.tsx'), 'utf8');

  it('the "member" role chip has accessibilityRole="radio" and accessibilityState selected on role === member', () => {
    const index = source.indexOf("setPendingRole('member')");
    expect(index).toBeGreaterThan(-1);
    const around = source.slice(index, index + 600);
    expect(around).toMatch(/accessibilityRole="radio"/);
    expect(around).toMatch(/accessibilityState=\{\{ selected: role === 'member' \}\}/);
  });

  it('the "admin" role chip has accessibilityRole="radio" and accessibilityState selected on role === admin', () => {
    const index = source.indexOf("setPendingRole('admin')");
    expect(index).toBeGreaterThan(-1);
    const around = source.slice(index, index + 400);
    expect(around).toMatch(/accessibilityRole="radio"/);
    expect(around).toMatch(/accessibilityState=\{\{ selected: role === 'admin' \}\}/);
  });
});
