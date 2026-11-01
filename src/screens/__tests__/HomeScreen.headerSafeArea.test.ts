/**
 * Structural guards (no RN rendering harness in this repo).
 *
 * Production report 2026-11-01 (installed iPhone app):
 *  - The header row (mascot, bell) sat under the status bar, where iOS
 *    swallows taps, so neither the bell nor the System Admin mascot gesture
 *    responded. The web hero shell pulled itself up by the top inset while
 *    nothing above it had added that inset.
 *  - The compact countdown's three fixed 34pt boxes were wider than the
 *    Next-Walk card's countdown column, so the seconds box overflowed.
 */
describe('Home header stays below the status bar; countdown fits its column', () => {
  const fs = require('fs');
  const home: string = fs.readFileSync(require.resolve('../HomeScreen'), 'utf8');
  const countdown: string = fs.readFileSync(require.resolve('../../components/Countdown'), 'utf8');
  const card: string = fs.readFileSync(require.resolve('../../components/NextWalkCard'), 'utf8');

  it('the web hero shell does not pull up by the inset, but pads the header below it', () => {
    expect(home).not.toContain("calc(-1 * env(safe-area-inset-top, 0px))");
    expect(home).toContain("dashboardHeroShell: { marginHorizontal: -spacing.md, marginTop: Platform.OS === 'web' ? 0 : -56, paddingTop: Platform.OS === 'web' ? 'env(safe-area-inset-top, 0px)' as any : 56");
  });

  it('compact countdown boxes share the column width instead of a fixed minimum', () => {
    expect(countdown).toMatch(/compactSegment: \{[^}]*flex: 1, flexShrink: 1, minWidth: 0/);
    expect(countdown).toMatch(/compactLabel: \{[^}]*flex: 1, flexShrink: 1, minWidth: 0/);
    expect(card).toMatch(/dashboardCountdownColumn: \{ flex: 1,[^}]*minWidth: 0[^}]*overflow: 'hidden'/);
  });
});

describe('installed iPhone app — scrolled content never slides under the status bar', () => {
  const fs = require('fs');
  const path = require('path');
  const html: string = fs.readFileSync(path.join(__dirname, '../../../public/index.html'), 'utf8');

  it('draws a fixed, non-interactive strip the height of the status bar, only in standalone mode', () => {
    const rule = html.match(/html\.ios-standalone body::after \{[^}]*\}/)?.[0] ?? '';
    expect(rule).toContain('position: fixed;');
    expect(rule).toContain('height: env(safe-area-inset-top, 0px);');
    expect(rule).toContain('pointer-events: none;');
  });
});

describe('Home — starting my scheduled walk shows the whole live card', () => {
  const home: string = require('fs').readFileSync(require.resolve('../HomeScreen'), 'utf8');

  it('scrolls back to the top once when my scheduled walk turns active', () => {
    expect(home).toContain('const myActiveScheduledWalkId = nextWalk && isActiveWalk(nextWalk)');
    expect(home).toMatch(/if \(myActiveScheduledWalkId && myActiveScheduledWalkId !== priorActiveScheduledWalkIdRef\.current\) \{\n\s*scrollHomeToTopAfterSheet\(\);/);
  });

  it('repeats the scroll after the closing sheet hands focus back (web focus restore scrolls the page)', () => {
    expect(home).toContain('scrollTopTimersRef.current = [setTimeout(toTop, 350), setTimeout(toTop, 900)];');
    expect(home).toMatch(/if \(myActiveSpontaneousWalkId && !priorActiveSpontaneousWalkIdRef\.current\) \{\n\s*scrollHomeToTopAfterSheet\(\);/);
  });

  it('labels an active walk in "בהמשך היום" as in progress, not as the next walk', () => {
    expect(home).toContain("{isActiveWalk(dashboardTimelineWalks[0]) ? 'בטיול עכשיו' : 'הטיול הבא היום'}");
  });
});
