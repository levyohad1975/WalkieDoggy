import fs from 'fs';
import path from 'path';

/**
 * QA Guardian sweep (accessibility labels on non-Button Pressable elements):
 * WalkRow.tsx's onMarkDone/onMarkNotDone "resolve chip" Pressables (the
 * ✓ בוצע / ✕ לא בוצע quick-resolution controls for an overdue walk) carried
 * no accessibilityRole/accessibilityLabel, unlike the sibling quick-toggle
 * Pressables in the same file (pee/poop, `accessibilityRole="checkbox"` +
 * `accessibilityLabel`) just above them. Verifies each resolve chip now
 * carries both, via the source-scan convention this repo uses for RN
 * components it can't render-test directly.
 */
describe('WalkRow resolve chip Pressables — accessibility role/label', () => {
  const source = fs.readFileSync(path.resolve(__dirname, '../WalkRow.tsx'), 'utf8');

  it.each([
    ['onMarkDone', 'resolveChipDone'],
    ['onMarkNotDone', 'resolveChipNotDone'],
  ])('%s resolve chip has accessibilityRole="button" and a non-empty accessibilityLabel', (_prop, styleName) => {
    const index = source.indexOf(`styles.${styleName}`);
    expect(index).toBeGreaterThan(-1);
    const around = source.slice(index, index + 300);
    expect(around).toMatch(/accessibilityRole="button"/);
    expect(around).toMatch(/accessibilityLabel=/);
    expect(around).not.toMatch(/accessibilityLabel=(""|\{\s*\})/);
  });
});

describe('WalkRow completed-history performer', () => {
  const source = fs.readFileSync(path.resolve(__dirname, '../WalkRow.tsx'), 'utf8');
  it('uses completedBy for a completed compact history row while preserving the scheduled assignment', () => {
    expect(source).toMatch(/historyCompact && walk\.status === 'done' && completedBy \? completedBy : responsible/);
    expect(source).toContain('displayedWalker?.name');
  });
});
