import fs from 'fs';
import path from 'path';

/**
 * QA Guardian sweep (accessibility labels on non-Button Pressable elements):
 * the rule row's edit (✏️) and delete (🗑️) Pressables are emoji-only with no
 * visible text, the same shape as FamilyScreen.tsx's member edit/delete
 * icons, which already carry accessibilityRole/accessibilityLabel for
 * screen readers. This screen's rule-action icons did not. Verifies both now
 * carry a role and a distinguishing label via the source-scan convention
 * this repo uses for RN components it can't render-test directly.
 */
describe('ScheduleScreen — rule action icon accessibility', () => {
  const source = fs.readFileSync(path.resolve(__dirname, '../ScheduleScreen.tsx'), 'utf8');

  it('the edit rule Pressable has accessibilityRole="button" and a distinguishing accessibilityLabel', () => {
    const editIndex = source.indexOf('setEditingRule(r)');
    expect(editIndex).toBeGreaterThan(-1);
    const before = source.slice(Math.max(0, editIndex - 400), editIndex + 200);
    expect(before).toMatch(/accessibilityRole="button"/);
    expect(before).toMatch(/accessibilityLabel=\{`עריכת שעת טיול \$\{r\.time\}`\}/);
  });

  it('the delete rule Pressable has accessibilityRole="button" and a distinguishing accessibilityLabel', () => {
    const deleteIndex = source.indexOf('setDeleteRuleId(r.id)');
    expect(deleteIndex).toBeGreaterThan(-1);
    const around = source.slice(Math.max(0, deleteIndex - 100), deleteIndex + 300);
    expect(around).toMatch(/accessibilityRole="button"/);
    expect(around).toMatch(/accessibilityLabel=\{`מחיקת שעת טיול \$\{r\.time\}`\}/);
  });
});
