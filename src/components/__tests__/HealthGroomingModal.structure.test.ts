import fs from 'fs';

/**
 * Phase 3 kickoff (Health & Grooming, PRD §10) — structural checks for the
 * per-dog journal + task list modal. Source-scan convention: this repo has
 * no render-test harness for screens/modals.
 */
describe('HealthGroomingModal (structural)', () => {
  const source = fs.readFileSync(require.resolve('../HealthGroomingModal'), 'utf8').replace(/\r\n/g, '\n');

  it('covers every PRD §10 core category in both the CATEGORIES list and CATEGORY_LABELS', () => {
    const categories = [
      'vaccination', 'parasite_prevention', 'medication', 'vet_visit', 'weight',
      'allergy', 'food', 'grooming', 'bath', 'nails', 'teeth', 'ears', 'other',
    ];
    for (const c of categories) {
      expect(source).toContain(`'${c}'`);
    }
  });

  it('splits tasks into open (no completedAt) and completed sections, sorted by due/completed date', () => {
    expect(source).toMatch(/filter\(\(t\) => !t\.completedAt\)/);
    expect(source).toMatch(/filter\(\(t\) => t\.completedAt\)/);
    expect(source).toMatch(/sort\(\(a, b\) => \(a\.dueDate \?\? ''\)\.localeCompare\(b\.dueDate \?\? ''\)\)/);
    expect(source).toMatch(/sort\(\(a, b\) => \(b\.completedAt \?\? ''\)\.localeCompare\(a\.completedAt \?\? ''\)\)/);
  });

  it('an open task row offers a dedicated "✓ בוצע" action that calls onComplete, separate from editing', () => {
    expect(source).toMatch(/void handleComplete\(t\.id\)/);
    expect(source).toContain('await onComplete(taskId)');
  });

  it('the add/edit form treats a blank due date as a completed-now log entry, a filled one as an open task', () => {
    const formStart = source.indexOf('function HealthTaskFormModal');
    expect(formStart).toBeGreaterThan(-1);
    const form = source.slice(formStart);
    expect(form).toMatch(/const logNow = !dueDate && !task\?\.completedAt;/);
    expect(form).toMatch(/completedAt: logNow \? now : task\?\.completedAt/);
  });

  it('the weight field only appears for category === \'weight\'', () => {
    const idx = source.indexOf("category === 'weight' ?");
    expect(idx).toBeGreaterThan(-1);
  });

  it('every record is scoped to dog.familyId/dog.id — never a family-wide list', () => {
    expect(source).toMatch(/familyId: dog\.familyId/);
    expect(source).toMatch(/dogId: dog\.id/);
  });

  it('never offers a delete/remove action — a health record is family history (0049), not client-erasable', () => {
    expect(source).not.toMatch(/delete|מחיק|הסר/i);
  });
});
