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
    expect(source).toMatch(/gpsPointCount\?: number \| null;/);
    expect(source).toMatch(/gpsStatus\?: 'granted' \| 'denied' \| 'unavailable' \| null;/);
  });

  it('renders the GPS state while the card is active, including before permission resolves', () => {
    const idx = source.indexOf('{isActive ? (');
    expect(idx).toBeGreaterThan(-1);
  });

  it('explains acquisition, active, denied, timeout, and interruption states and offers retry', () => {
    expect(source).toContain('gpsTrackingStatus === \'requesting\'');
    expect(source).toContain('gpsTrackingStatus === \'waiting\'');
    expect(source).toContain('gpsTrackingStatus === \'active\'');
    expect(source).toContain('gpsTrackingStatus === \'denied\'');
    expect(source).toContain('gpsTrackingStatus === \'timeout\'');
    expect(source).toContain('gpsTrackingStatus === \'unavailable\'');
    expect(source).toContain('gpsTrackingStatus === \'interrupted\'');
    expect(source).toContain('ממתין למיקום GPS ראשון');
    expect(source).toContain('לא התקבל מיקום בזמן');
    expect(source).toContain('הרשאת מיקום נדחתה');
    expect(source).toContain('נסה שוב');
  });

  it('formats the live distance via the shared formatDistanceMeters (never a hand-rolled duplicate)', () => {
    expect(source).toMatch(/import \{ formatDistanceMeters \} from '\.\.\/logic\/gpsDistance';/);
    expect(source).toMatch(/formatDistanceMeters\(liveDistanceMeters\)/);
  });
});
