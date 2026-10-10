import fs from 'fs';

/**
 * PRD §15: the notification bell's unified Inbox must also surface
 * "תזכורות חשובות" (important reminders) alongside swap/time-change
 * requests. This was blocked when the Inbox was first built (no overdue-
 * task data existed yet); Health & Grooming (0049-0050) now supplies it
 * via logic/healthTasks.ts's getImportantHealthReminders(). Source-scan
 * convention: this repo has no render-test harness for components.
 */
describe('RequestsInboxModal surfaces important Health & Grooming reminders (structural)', () => {
  const source = fs.readFileSync(require.resolve('../RequestsInboxModal'), 'utf8').replace(/\r\n/g, '\n');

  it('imports getHealthTaskLifecycle/HEALTH_TASK_CATEGORY_LABELS rather than re-deriving lifecycle/category text', () => {
    expect(source).toMatch(/import \{ getHealthTaskLifecycle, HEALTH_TASK_CATEGORY_LABELS \} from '\.\.\/logic\/healthTasks';/);
  });

  it('the section only renders when healthReminders is actually non-empty', () => {
    const idx = source.indexOf('healthReminders && healthReminders.length > 0 ?');
    expect(idx).toBeGreaterThan(-1);
  });

  it('every reminder row shows a lifecycle-appropriate badge (upcoming/due/overdue), not a single generic label', () => {
    expect(source).toMatch(/upcoming: \{ label: 'בקרוב'/);
    expect(source).toMatch(/due: \{ label: 'היום'/);
    expect(source).toMatch(/overdue: \{ label: 'באיחור'/);
  });

  it('tapping a reminder row (when the caller supplies a handler) hands off to onOpenHealthReminders — this modal never opens the Health sheet itself', () => {
    const sectionIdx = source.indexOf('sectionTitleSpaced]}>תזכורות חשובות');
    expect(sectionIdx).toBeGreaterThan(-1);
    const block = source.slice(sectionIdx, sectionIdx + 1200);
    expect(block).toMatch(/onOpenHealthReminders \? \(/);
    expect(block).toMatch(/onPress=\{onOpenHealthReminders\}/);
  });

  it('healthReminders/onOpenHealthReminders are optional props — a caller that omits them still gets the pre-existing two sections unchanged', () => {
    expect(source).toMatch(/healthReminders\?: HealthTask\[\];/);
    expect(source).toMatch(/onOpenHealthReminders\?: \(\) => void;/);
  });
});
