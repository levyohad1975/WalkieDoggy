import fs from 'fs';
import path from 'path';

/**
 * Field report 2026-11-06: a 4-day-old unresolved walk still showed the big
 * ✓בוצע/✕לא בוצע resolution buttons in History. canResolveWalk now also
 * requires the walk to be from today or yesterday (family-local); older overdue
 * walks stay a ✕ record with no action. Verified via the source-scan
 * convention this repo uses for screens it can't render-test directly.
 */
describe('HistoryScreen — resolution buttons limited to recent overdue walks', () => {
  const source = fs.readFileSync(path.resolve(__dirname, '../HistoryScreen.tsx'), 'utf8');

  it('computes a yesterday (family-local) cutoff for resolvability', () => {
    expect(source).toMatch(
      /const resolvableSinceIso = familyDateOnly\(new Date\(Date\.now\(\) - 86400000\), family\?\.timezone\)/,
    );
  });

  it('canResolveWalk gates on that cutoff in addition to overdue + permission', () => {
    expect(source).toMatch(/const canResolveWalk = \(w: Walk\) =>[\s\S]*?w\.status === 'pending'/);
    expect(source).toMatch(/const canResolveWalk = \(w: Walk\) =>[\s\S]*?isOverdue\(w\)/);
    expect(source).toMatch(/const canResolveWalk = \(w: Walk\) =>[\s\S]*?w\.date >= resolvableSinceIso/);
    expect(source).toMatch(
      /const canResolveWalk = \(w: Walk\) =>[\s\S]*?effectiveRole === 'admin' \|\| w\.responsibleUserId === effectiveUserId/,
    );
  });
});
