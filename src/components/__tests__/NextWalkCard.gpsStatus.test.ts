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

  it('renders a server-persisted remote GPS session and its route without depending on this device\'s gpsStore watch', () => {
    expect(source).toMatch(/remoteGpsSession\?: WalkGpsSession \| null;/);
    expect(source).toMatch(/remoteGpsSession && remoteGpsSession\.pointCount > 0/);
    expect(source).toContain('GPS פעיל במכשיר המטייל/ת');
    expect(source).toMatch(/liveRoutePoints \?\? remoteGpsSession\?\.routePoints \?\? \[\]/);
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

/**
 * Real-iPhone P0 (2026-10-15): the timer ran, the card said "מפעיל GPS…" and
 * the map waited for a first fix forever, with location allowed. That text
 * was the fall-through for "this device holds no GPS session for the shown
 * active walk" (PWA relaunched mid-walk, duplicate active walk shown, remote
 * start): nothing was actually starting and no action was offered.
 */
describe('NextWalkCard — active walk with no GPS session on this device (structural)', () => {
  const card = fs.readFileSync(require.resolve('../NextWalkCard'), 'utf8').replace(/\r\n/g, '\n');
  const home = fs.readFileSync(require.resolve('../../screens/HomeScreen'), 'utf8').replace(/\r\n/g, '\n');

  it('states the real condition before any tracking status, and offers an explicit activation tap to the walker', () => {
    const statusStart = card.indexOf(': gpsNotTrackedHere === \'walker_here\'');
    expect(statusStart).toBeGreaterThan(-1);
    expect(statusStart).toBeLessThan(card.indexOf('gpsTrackingStatus === \'requesting\''));
    expect(card).toContain('GPS לא פעיל במכשיר הזה');
    expect(card).toContain('ה-GPS נאסף במכשיר של מי שיוצא/ת לטיול');
    expect(card).toMatch(/onRetryGps && gpsNotTrackedHere === 'walker_here' \? \(\s*<Pressable onPress=\{onRetryGps\}/);
    expect(card).toContain('הפעל GPS');
  });

  it('Home derives it from the tracked walk id and the actual walker, never from a different walk', () => {
    expect(home).toMatch(/gpsNotTrackedHere=\{\s*isActiveWalk\(nextWalk\) && gpsTrackingWalkId !== nextWalk\.id\s*\?\s*\(\(nextWalk\.actualWalkerUserId \?\? nextWalk\.responsibleUserId\) === currentUserId \? 'walker_here' : 'elsewhere'\)\s*:\s*null\s*\}/);
    // The transfer dialog is only for an interrupted session of THIS walk.
    expect(home).toContain("if (gpsTrackingWalkId === nextWalk.id && gpsTrackingStatus === 'interrupted') {");
  });
});
