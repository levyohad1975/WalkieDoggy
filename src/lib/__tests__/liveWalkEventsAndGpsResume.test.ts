import fs from 'fs';
import path from 'path';

/**
 * Field report 2026-11-04 (real iPhone, Production): a walker's GPS stopped
 * two minutes into the walk when iOS closed the home-screen app, nothing
 * restarted it after reopening, and the family saw none of the pee taps until
 * "סיים טיול". Structural checks, like the rest of this repo's screen tests.
 */
const read = (relative: string) =>
  fs.readFileSync(path.resolve(__dirname, relative), 'utf8').replace(/\r\n/g, '\n');

describe('record_walk_event_counts_v1 migration', () => {
  const migration = read('../../../supabase/migrations/20261104120000_live_walk_event_counts.sql');

  it('is additive: one function, no table, column, policy or delete changes', () => {
    expect(migration).toMatch(/create or replace function public\.record_walk_event_counts_v1/i);
    expect(migration).not.toMatch(/alter table|create table|create policy|drop |delete\s+from/i);
  });

  it('only lets the actual walker update their own in-progress walk in their family', () => {
    expect(migration).toMatch(/family_id = public\.current_family_id\(\)/i);
    expect(migration).toMatch(/w\.status <> 'in_progress'/i);
    expect(migration).toMatch(/coalesce\(w\.actual_walker_user_id, w\.responsible_user_id\) is distinct from actor/i);
    expect(migration).toMatch(/security definer/i);
    expect(migration).toMatch(/set search_path = pg_catalog, public/i);
  });

  it('writes absolute, bounded counts and nothing else', () => {
    expect(migration).toMatch(/p_pee_count < 0 or p_poop_count < 0 or p_pee_count > 100 or p_poop_count > 100/i);
    expect(migration).toMatch(/set pee_count = p_pee_count,\s*poop_count = p_poop_count\s*where id = w\.id/i);
    expect(migration).not.toMatch(/had_pee\s*=|status\s*=\s*'done'|completed_at\s*=/i);
  });

  it('is callable by signed-in members only', () => {
    expect(migration).toMatch(/revoke all on function public\.record_walk_event_counts_v1\(uuid, integer, integer\) from public, anon;/i);
    expect(migration).toMatch(/grant execute on function public\.record_walk_event_counts_v1\(uuid, integer, integer\) to authenticated;/i);
  });
});

describe('Home publishes live walk events and resumes GPS after relaunch', () => {
  const home = read('../../screens/HomeScreen.tsx');
  const gpsStore = read('../../store/gpsStore.ts');

  it('publishes running totals only from the actual walker of an active walk', () => {
    expect(home).toMatch(/if \(!walk \|\| !isActiveWalk\(walk\) \|\| \(walk\.actualWalkerUserId \?\? walk\.responsibleUserId\) !== currentUserId\) return;/);
    expect(home).toMatch(/repository\.recordWalkEventCountsV1\(walkId, counts\)/);
    expect(home).toMatch(/persistWalkEvents\(walkId, next\);\n\s*publishWalkEvents\(walkId, next\);/);
  });

  it('shows other devices the server totals so a remote finish keeps the walker\'s taps', () => {
    expect(home).toMatch(/Math\.max\(local\.pee, server\.pee\)/);
    expect(home).toMatch(/if \(!local\) return server \?\? \{ pee: 0, poop: 0 \};/);
  });

  it('resumes only a walk this device was tracking, for its walker, once, unless location is denied', () => {
    expect(home).toMatch(/\(entry\.actualWalkerUserId \?\? entry\.responsibleUserId\) === currentUserId/);
    expect(home).toMatch(/wasTrackingGpsOnThisDevice\(entry\.id\)/);
    expect(home).toMatch(/autoResumedGpsWalkIds\.current\.add\(walk\.id\)/);
    // 2026-11-11: iPhone reports "prompt" after location was allowed, so
    // only an explicit "denied" blocks the resume.
    expect(home).toMatch(/isGeolocationNotDenied\(\)\.then\(\(allowed\) => \{\n\s*if \(!allowed \|\| useGpsStore\.getState\(\)\.trackingWalkId\) return;/);
  });

  it('restarts the watch and renews the lease when the app returns to the front after a gap (2026-11-11)', () => {
    expect(home).toMatch(/AppState\.addEventListener\('change', \(state\) => \{\n\s*if \(state !== 'active'\) return;/);
    expect(home).toMatch(/if \(Date\.now\(\) - lastFixAt < GPS_FOREGROUND_STALE_MS\) return;/);
    expect(home).toMatch(/useGpsStore\.setState\(\{ trackingStatus: 'interrupted' \}\);\n\s*void activateGpsForWalk\(walk\);/);
  });

  it('marks the device on lease acquisition and clears it on every stop or cancel', () => {
    expect(gpsStore).toMatch(/recordGpsLifecycle\('lease_acquired'[^\n]*\n\s*markGpsTrackingOnThisDevice\(walk\.id\);/);
    expect(gpsStore).toMatch(/cancelTracking: \(walkId, reason\) => \{\n[^\n]*\n\s*clearGpsTrackingMarker\(walkId\);/);
    expect(gpsStore).toMatch(/stopTracking: async \(walk, userId, reason, detail\) => \{[\s\S]{0,200}clearGpsTrackingMarker\(walk\.id\);/);
  });
});
