import fs from 'fs';
import path from 'path';

/**
 * UX improvement 2026-11-06 (owner request): the History list now shows a
 * per-walk pee/poop indicator so the family can see, at a glance, which walks
 * the dog actually relieved itself on — directly serving "how long since she
 * last went out for needs". Only for a performed (done) walk, only the events
 * that occurred, and never truncated by the timing line. Verified via the
 * source-scan convention this repo uses for RN components it can't render-test.
 */
describe('WalkRow — per-walk pee/poop indicator in History', () => {
  const source = fs.readFileSync(path.resolve(__dirname, '../WalkRow.tsx'), 'utf8');

  it('derives counts only for a performed walk in compact history, via getWalkEventCounts', () => {
    expect(source).toContain("import { getWalkEventCounts } from '../logic/walkEventCounts'");
    expect(source).toMatch(
      /const historyEvents = historyCompact && walk\.status === 'done' \? getWalkEventCounts\(walk\) : null;/,
    );
    expect(source).toMatch(/historyEvents\.pee > 0 \|\| historyEvents\.poop > 0/);
  });

  it('renders each emoji only when its count is positive (zero shown by absence)', () => {
    expect(source).toMatch(/historyEvents\.pee > 0 \?[\s\S]*?\{`\$\{historyEvents\.pee\} 💧`\}/);
    expect(source).toMatch(/historyEvents\.poop > 0 \?[\s\S]*?\{`\$\{historyEvents\.poop\} 💩`\}/);
  });

  it('labels the counts for screen readers in Hebrew', () => {
    expect(source).toMatch(/accessibilityLabel=\{`\$\{historyEvents\.pee\} פיפי`\}/);
    expect(source).toMatch(/accessibilityLabel=\{`\$\{historyEvents\.poop\} קקי`\}/);
  });

  it('shares a row where the timing text flexes/ellipsizes and the counts keep a fixed, non-truncating slot', () => {
    expect(source).toContain('historyMetaRow');
    // timing text flexes
    expect(source).toMatch(/historyTimingLineFlex: \{ flex: 1/);
    // counts never shrink
    expect(source).toMatch(/eventCounts: \{[\s\S]*?flexShrink: 0/);
  });
});
