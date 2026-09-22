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

  it('only ever renders the GPS line while the card is active (isActive)', () => {
    const idx = source.indexOf("isActive && (gpsStatus === 'granted' || gpsStatus === 'denied')");
    expect(idx).toBeGreaterThan(-1);
  });

  it('silently skips an "unavailable" status — never a persistent, non-actionable warning line', () => {
    const blockStart = source.indexOf("isActive && (gpsStatus === 'granted'");
    const block = source.slice(blockStart, blockStart + 400);
    expect(block).not.toMatch(/unavailable/);
  });

  it('formats the live distance via the shared formatDistanceMeters (never a hand-rolled duplicate)', () => {
    expect(source).toMatch(/import \{ formatDistanceMeters \} from '\.\.\/logic\/gpsDistance';/);
    expect(source).toMatch(/formatDistanceMeters\(liveDistanceMeters\)/);
  });
});
