import fs from 'fs';

/**
 * Phase 3 (Health & Grooming, PRD §10) — Home surfaces overdue/due-soon
 * Health & Grooming items WITHOUT cluttering the primary walk experience:
 * a single slim pill, rendered only when there's genuinely something to
 * flag, that hands off to Settings' Health sheet rather than growing a
 * second list on this screen. Source-scan convention: this repo has no
 * render-test harness for screens.
 */
describe('HomeScreen surfaces a Health & Grooming summary badge (structural)', () => {
  const source = fs.readFileSync(require.resolve('../HomeScreen'), 'utf8').replace(/\r\n/g, '\n');

  it('loads this dog\'s health tasks eagerly (not lazily behind a modal, unlike Settings) whenever the active dog changes', () => {
    expect(source).toMatch(/if \(dog\) void loadHealthTasks\(dog\.id\);/);
    expect(source).toMatch(/\}, \[dog\?\.id, loadHealthTasks\]\);/);
  });

  it('computes the summary via the shared summarizeHealthTasksForHome (never re-implements the overdue/due-soon math)', () => {
    expect(source).toMatch(/import \{ getImportantHealthReminders, summarizeHealthTasksForHome \} from '\.\.\/logic\/healthTasks';/);
    expect(source).toMatch(/summarizeHealthTasksForHome\(healthTasks\)/);
  });

  it('renders the pill only when there is something to show (overdue + due-soon > 0)', () => {
    const idx = source.indexOf('healthSummary.overdueCount + healthSummary.dueSoonCount > 0 ?');
    expect(idx).toBeGreaterThan(-1);
  });

  it('tapping the pill requests the cross-tab open signal, then navigates to the Settings tab', () => {
    const blockStart = source.indexOf('healthSummaryPill');
    const block = source.slice(blockStart, blockStart + 800);
    expect(block).toMatch(/requestOpenHealthModal\(\);/);
    expect(block).toMatch(/navigation\.navigate\('Settings'\);/);
  });

  it('never renders a second full task list here — only the one-line pill text', () => {
    const blockStart = source.indexOf('healthSummary.overdueCount + healthSummary.dueSoonCount > 0 ?');
    const blockEnd = source.indexOf('nextWalkLift', blockStart);
    const block = source.slice(blockStart, blockEnd);
    expect(block).not.toMatch(/\.map\(/);
  });
});
