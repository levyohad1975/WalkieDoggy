import fs from 'fs';

/**
 * PRD §20: "persistent queue conflicts must be visible, never silently
 * disappear." SyncQueue's getConflicts()/getQuarantined() were already
 * fully implemented and tested at the data layer but had no UI consumer —
 * this modal is that consumer. Source-scan convention: this repo has no
 * render-test harness for complex modals (see MascotFrameAnimation.test.tsx
 * for where a genuine render test was worth the setup instead).
 */
describe('SyncIssuesModal (structural)', () => {
  const source = fs.readFileSync(require.resolve('../SyncIssuesModal'), 'utf8').replace(/\r\n/g, '\n');

  it('labels every SyncOperation type in Hebrew — TypeScript\'s Record<SyncOperation[\'type\'], string> enforces completeness at compile time', () => {
    expect(source).toMatch(/const OP_LABEL: Record<SyncOperation\['type'\], string> = \{/);
  });

  it('shows both conflicts and quarantined items in their own sections, each with an empty-state message', () => {
    expect(source).toMatch(/שינויים שנדחו/);
    expect(source).toMatch(/שינויים הממתינים לבדיקה/);
    expect(source).toMatch(/אין שינויים שנדחו\./);
    expect(source).toMatch(/אין שינויים הממתינים לבדיקה\./);
  });

  it('only offers a clear/dismiss action for conflicts, never for quarantined items (no safe automated resolution exists for those)', () => {
    expect(source).toMatch(/conflicts\.length > 0 \? \(/);
    expect(source).toMatch(/onPress=\{onClearConflicts\}/);
    // No "clear quarantine" action anywhere.
    expect(source).not.toMatch(/onClearQuarantine/);
    expect(source).not.toMatch(/nקה.*הממתינים/);
  });

  it('never renders a raw technical op.type string — always looks it up via opLabel()', () => {
    expect(source).toMatch(/\{opLabel\(c\.op\)\}/);
    expect(source).toMatch(/\{opLabel\(q\.op\)\}/);
  });
});
