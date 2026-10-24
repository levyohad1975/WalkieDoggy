import fs from 'fs';
import path from 'path';

/**
 * P0 real-iPhone QA (2026-10-15, 18:06): the Dashboard could render scrolled
 * partway down — most visibly, the active-walk card inserted right after
 * starting a spontaneous walk sat above the visible viewport, forcing a
 * manual scroll up. Root cause: a bottom-tab screen stays mounted across
 * tab switches, so the ScrollView kept whatever offset a previous visit
 * left it at, and nothing ever reset it on focus or on starting a walk.
 * Source-scan convention: this repo has no render-test harness for screens.
 */
describe('HomeScreen Dashboard scroll position (structural)', () => {
  const home = fs.readFileSync(path.join(__dirname, '..', 'HomeScreen.tsx'), 'utf8');

  it('attaches a ref to the Dashboard ScrollView', () => {
    expect(home).toContain('const scrollViewRef = useRef<ScrollView>(null);');
    expect(home).toMatch(/<ScrollView\s*\n\s*ref=\{scrollViewRef\}/);
  });

  it('resets to the top on every focus (initial navigation AND returning from another tab) — not on every rerender', () => {
    const idx = home.indexOf('const scrollViewRef = useRef<ScrollView>(null);');
    const block = home.slice(idx, home.indexOf('const usersById = useMemo('));
    expect(block).toMatch(/useFocusEffect\(\s*\n\s*useCallback\(\(\) => \{\s*\n\s*scrollViewRef\.current\?\.scrollTo\(\{ y: 0, animated: false \}\);\s*\n\s*\}, \[\]\)\s*\n\s*\);/);
  });

  it('brings a newly-started spontaneous walk\'s active card into view, keyed ONLY on the appear transition (false -> true), never on a GPS/timer rerender while it stays active', () => {
    const idx = home.indexOf('const myActiveSpontaneousWalkId = useMemo(');
    expect(idx).toBeGreaterThan(-1);
    const block = home.slice(idx, home.indexOf('// The Family Admin review action'));
    expect(block).toContain('.find((walk) => (walk.actualWalkerUserId ?? walk.responsibleUserId) === currentUserId)?.id ?? null');
    expect(block).toContain('const priorActiveSpontaneousWalkIdRef = useRef<string | null>(null);');
    expect(block).toMatch(/if \(myActiveSpontaneousWalkId && !priorActiveSpontaneousWalkIdRef\.current\) \{\s*\n\s*scrollViewRef\.current\?\.scrollTo\(\{ y: 0, animated: true \}\);\s*\n\s*\}/);
    expect(block).toContain('priorActiveSpontaneousWalkIdRef.current = myActiveSpontaneousWalkId;');
    expect(block).toMatch(/\}, \[myActiveSpontaneousWalkId\]\);/);
    // Never keyed on minute-tick/GPS state — would fire a scroll on every
    // timer tick or GPS status change while the walk stays active.
    expect(block).not.toMatch(/\[myActiveSpontaneousWalkId,\s*(minuteTick|gpsTrackingStatus|gpsTrackingWalkId)/);
  });
});
