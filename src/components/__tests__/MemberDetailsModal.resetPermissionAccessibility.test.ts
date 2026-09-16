import fs from 'fs';
import path from 'path';

/**
 * QA Guardian follow-up (accessibilityHint-on-destructive-actions, category
 * (b), item 2): the "איפוס" (reset a permission override) Pressable fires
 * immediately on tap with no accessibilityRole/accessibilityLabel at all,
 * unlike the identical resolve-chip pattern already fixed in WalkRow.tsx.
 * Verifies the reset Pressable now carries accessibilityRole="button" and a
 * non-empty accessibilityLabel.
 */
describe('MemberDetailsModal — permission reset Pressable accessibility', () => {
  const source = fs.readFileSync(path.resolve(__dirname, '../MemberDetailsModal.tsx'), 'utf8');

  it('the reset Pressable has accessibilityRole="button" and a non-empty accessibilityLabel', () => {
    const index = source.indexOf('handleResetPermission(key)');
    expect(index).toBeGreaterThan(-1);
    const around = source.slice(index, index + 200);
    expect(around).toMatch(/accessibilityRole="button"/);
    expect(around).toMatch(/accessibilityLabel=\{`[^`]+`\}/);
  });
});
