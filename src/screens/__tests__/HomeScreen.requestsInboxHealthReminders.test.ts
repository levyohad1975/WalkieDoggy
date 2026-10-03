import fs from 'fs';
import path from 'path';

/**
 * PRD §15 — HomeScreen wires the "תזכורות חשובות" inbox section to the
 * same active-dog health tasks the Home summary pill already reads.
 * Source-scan convention: this repo has no render-test harness for
 * screens.
 */
describe('HomeScreen passes important health reminders into RequestsInboxModal (structural)', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'HomeScreen.tsx'), 'utf8').replace(/\r\n/g, '\n');

  it('computes healthReminders via getImportantHealthReminders(healthTasks), not a re-derived list', () => {
    expect(source).toMatch(/import \{ getImportantHealthReminders, summarizeHealthTasksForHome \} from '\.\.\/logic\/healthTasks';/);
    expect(source).toMatch(/const healthReminders = useMemo\(\(\) => getImportantHealthReminders\(healthTasks\), \[healthTasks\]\);/);
  });

  it('passes healthReminders, dogName, and a handler into RequestsInboxModal', () => {
    const idx = source.indexOf('<RequestsInboxModal');
    expect(idx).toBeGreaterThan(-1);
    const block = source.slice(idx, idx + 700);
    expect(block).toMatch(/healthReminders=\{healthReminders\}/);
    expect(block).toMatch(/dogName=\{dog\?\.name\}/);
    expect(block).toMatch(/onOpenHealthReminders=\{/);
  });

  it('opening a health reminder from the inbox closes the inbox and reuses the SAME navigation as the Home summary pill (requestOpenHealthModal + navigate to Settings)', () => {
    const idx = source.indexOf('onOpenHealthReminders={() => {');
    expect(idx).toBeGreaterThan(-1);
    const block = source.slice(idx, idx + 200);
    expect(block).toMatch(/setRequestsInboxVisible\(false\);/);
    expect(block).toMatch(/requestOpenHealthModal\(\);/);
    expect(block).toMatch(/navigation\.navigate\('Settings'\);/);
  });
});
