import fs from 'fs';

/**
 * Phase 3 kickoff (Health & Grooming, PRD §10) — structural checks for the
 * per-dog journal + task list modal. Source-scan convention: this repo has
 * no render-test harness for screens/modals.
 */
describe('HealthGroomingModal (structural)', () => {
  const source = fs.readFileSync(require.resolve('../HealthGroomingModal'), 'utf8').replace(/\r\n/g, '\n');

  it('uses the focused appointment categories while keeping shared health labels', () => {
    expect(source).toMatch(/HEALTH_TASK_CATEGORY_LABELS as CATEGORY_LABELS/);
    expect(source).toContain("const APPOINTMENT_CATEGORIES: HealthTaskCategory[] = ['vet_visit', 'grooming']");
  });

  it('shows a lifecycle badge (upcoming/due/overdue) on every open task row via getHealthTaskLifecycle', () => {
    expect(source).toMatch(/import \{ .*getHealthTaskLifecycle.* \} from '\.\.\/logic\/healthTasks';/);
    expect(source).toContain('const lifecycle = getHealthTaskLifecycle(t)');
  });

  it('offers an optional responsible-member picker (including a "ללא" / none option) in the add/edit form', () => {
    const formStart = source.indexOf('function HealthTaskFormModal');
    const form = source.slice(formStart);
    expect(form).toMatch(/setResponsibleUserId\(undefined\)/);
    expect(form).toMatch(/users\.filter\(\(u\) => !u\.removedAt\)\.map/);
  });

  it('offers an optional recurrence-interval field, validated as a positive integer', () => {
    const formStart = source.indexOf('function HealthTaskFormModal');
    const form = source.slice(formStart);
    expect(form).toMatch(/recurrenceDays/);
    expect(form).toMatch(/!Number\.isInteger\(parsedRecurrence\) \|\| \(parsedRecurrence as number\) <= 0/);
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

  it('offers the approved multi-select veterinary purposes and an optional custom purpose', () => {
    expect(source).toContain("'חיסון כלבת'");
    expect(source).toContain("'חיסון משושה'");
    expect(source).toContain("'תילוע'");
    expect(source).toContain("'תולעת הפארק'");
    expect(source).toContain("'פרעושים/קרציות'");
    expect(source).toContain("'בדיקות/מעבדה'");
    expect(source).toMatch(/accessibilityRole="checkbox"/);
    expect(source).toMatch(/vetPurposes\.includes\('אחר'\)/);
  });

  it('every record is scoped to dog.familyId/dog.id — never a family-wide list', () => {
    expect(source).toMatch(/familyId: dog\.familyId/);
    expect(source).toMatch(/dogId: dog\.id/);
  });

  it('offers deletion only for an existing open task and requires confirmation', () => {
    expect(source).toContain('task && !task.completedAt');
    expect(source).toContain('label="מחיקת משימה"');
    expect(source).toContain("Alert.alert('מחיקת משימה'");
    expect(source).toContain('onDelete(task.id)');
  });
});
