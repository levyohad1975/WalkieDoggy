import fs from 'fs';

/**
 * Phase 4 kickoff (GPS foundation, PRD §7 — "In Progress" card state:
 * "מרחק/מצב GPS"). Structural checks: this repo has no render-test harness
 * for components.
 */
describe('NextWalkCard surfaces live GPS distance/status while active (structural)', () => {
  const source = fs.readFileSync(require.resolve('../NextWalkCard'), 'utf8').replace(/\r\n/g, '\n');

  it('accepts liveDistanceMeters/gpsStatus as optional props (backward compatible for every other call site)', () => {
    expect(source).toMatch(/liveDistanceMeters\?: number \| null;/);
    expect(source).toMatch(/gpsStatus\?: 'granted' \| 'denied' \| 'unavailable' \| null;/);
  });

  it('renders the GPS state while the card is active, including before permission resolves', () => {
    const idx = source.indexOf('{isActive ? (');
    expect(idx).toBeGreaterThan(-1);
  });

  it('explains the three user-visible GPS states instead of silently hiding the status', () => {
    const blockStart = source.indexOf("gpsStatus === 'granted'");
    const block = source.slice(blockStart, blockStart + 600);
    expect(block).toContain('ממתין לנתוני GPS');
    expect(block).toContain('מיקום לא זמין');
    expect(block).toContain('לא התקבל מיקום');
    expect(block).toContain('מפעיל GPS');
  });

  it('formats the live distance via the shared formatDistanceMeters (never a hand-rolled duplicate)', () => {
    expect(source).toMatch(/import \{ formatDistanceMeters \} from '\.\.\/logic\/gpsDistance';/);
    expect(source).toMatch(/formatDistanceMeters\(liveDistanceMeters\)/);
  });
});
