import fs from 'fs';

/**
 * Phase 4 kickoff (GPS foundation, PRD §7) — HomeScreen only ever shows
 * live GPS status on the card for the walk gpsStore is ACTUALLY tracking,
 * never for a different in-progress walk elsewhere. Source-scan
 * convention: this repo has no render-test harness for screens.
 */
describe('HomeScreen wires gpsStore\'s live tracking state into NextWalkCard (structural)', () => {
  const source = fs.readFileSync(require.resolve('../HomeScreen'), 'utf8').replace(/\r\n/g, '\n');

  it('imports useGpsStore', () => {
    expect(source).toMatch(/import \{ useGpsStore \} from '\.\.\/store\/gpsStore';/);
  });

  it('only passes live distance/status through when gpsTrackingWalkId matches THIS card\'s walk', () => {
    expect(source).toMatch(/liveDistanceMeters=\{gpsTrackingWalkId === nextWalk\.id \? gpsDistanceMeters : null\}/);
    expect(source).toMatch(/gpsPointCount=\{gpsTrackingWalkId === nextWalk\.id \? gpsPointCount : null\}/);
    expect(source).toMatch(/gpsStatus=\{gpsTrackingWalkId === nextWalk\.id \? gpsPermissionStatus : null\}/);
  });

  it('starts one foreground GPS watch from the Start button gesture before the walk RPC', () => {
    const startAction = source.slice(source.indexOf('const startWalkAs ='), source.indexOf('// PRD §9 gamification — an unlocked'));
    expect(startAction).toMatch(/if \(!remoteStart\) void useGpsStore\.getState\(\)\.startTracking\(walk\)/);
    expect(startAction).toMatch(/startWalk\(walk\.id, \{[\s\S]*startGps: false/);
    expect(startAction).toMatch(/actorUserId: currentUserId[\s\S]*actualWalkerUserId[\s\S]*remoteStart/);
  });

  // P0 real-iPhone (2026-10-15): a start the server rejected (PGRST202 for
  // start_walk_v11) called stopTracking(), which PERSISTS the provisional
  // route — an orphan GPS session for an unstarted walk, or a thrown
  // "no longer owns GPS" error that left the card stuck as interrupted.
  it('discards (never persists) the provisional GPS watch when the start is not accepted', () => {
    const startAction = source.slice(source.indexOf('const startWalkAs ='), source.indexOf('// PRD §9 gamification — an unlocked'));
    expect(startAction).toMatch(/if \(!started && !remoteStart\) useGpsStore\.getState\(\)\.cancelTracking\(walk\.id\)/);
    expect(startAction).toMatch(/\}, \(\) => \{\s*if \(!remoteStart\) useGpsStore\.getState\(\)\.cancelTracking\(walk\.id\)/);
    expect(startAction).not.toMatch(/getState\(\)\.stopTracking\(/);
  });
});
