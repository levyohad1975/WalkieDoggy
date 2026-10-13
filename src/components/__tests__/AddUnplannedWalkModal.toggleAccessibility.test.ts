import fs from 'fs';
import path from 'path';

/**
 * QA Guardian sweep (accessibility labels on non-Button Pressable elements):
 * the pee/poop emoji toggles here had no accessibilityRole/State/Label,
 * unlike the identical pattern in CompleteWalkModal.tsx (already fixed as
 * a Batch 4 item), which mirrors WalkRow.tsx's own quick-toggle convention.
 * Verifies both toggles now match that established pattern.
 */
describe('AddUnplannedWalkModal — pee/poop toggle accessibility', () => {
  const source = fs.readFileSync(path.resolve(__dirname, '../AddUnplannedWalkModal.tsx'), 'utf8');

  it('the pee toggle has accessibilityRole="checkbox", accessibilityState bound to hadPee, and a Hebrew label', () => {
    const index = source.indexOf('setHadPee((v) => !v)');
    expect(index).toBeGreaterThan(-1);
    const around = source.slice(index, index + 300);
    expect(around).toMatch(/accessibilityRole="checkbox"/);
    expect(around).toMatch(/accessibilityState=\{\{\s*checked:\s*hadPee\s*\}\}/);
    expect(around).toMatch(/accessibilityLabel="סימון פיפי בטיול"/);
  });

  it('the poop toggle has accessibilityRole="checkbox", accessibilityState bound to hadPoop, and a Hebrew label', () => {
    const index = source.indexOf('setHadPoop((v) => !v)');
    expect(index).toBeGreaterThan(-1);
    const around = source.slice(index, index + 300);
    expect(around).toMatch(/accessibilityRole="checkbox"/);
    expect(around).toMatch(/accessibilityState=\{\{\s*checked:\s*hadPoop\s*\}\}/);
    expect(around).toMatch(/accessibilityLabel="סימון קקי בטיול"/);
  });
});
