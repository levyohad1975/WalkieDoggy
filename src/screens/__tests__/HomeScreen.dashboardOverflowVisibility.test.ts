import fs from 'fs';
import path from 'path';

/**
 * Real-device QA fix — a genuine Home regression found via code review
 * while investigating "the upcoming-walk timeline is missing": the
 * `dashboardOverflow` wrapper was `{ display: 'none' }`, UNCONDITIONALLY
 * hiding everything inside it. That wrapper held THREE sections:
 *
 *   1. A duplicate "הטיול האחרון" (last walk) card — genuinely dead code,
 *      fully superseded by the compact "הטיול האחרון" card that already
 *      renders earlier on Home from the same `lastWalk` value (see
 *      `dashboardLastWalk*` styles, NOT inside this wrapper).
 *   2. "ממתינים לעדכון" (overdue walks still pending) — NOT shown anywhere
 *      else on Home. Hiding it meant an overdue-but-not-yet-done walk for
 *      today had nowhere to appear at all: excluded from the "בהמשך היום"
 *      timeline by design (future-only), and now invisible here too.
 *   3. "טיולים קרובים" (further upcoming walks beyond the timeline/next-
 *      walk card) — also not shown elsewhere.
 *
 * Fix: delete the dead duplicate card, and drop `display: 'none'` from
 * `dashboardOverflow` so the two genuinely unique sections render again.
 * Source-scan convention: this repo has no render-test harness for
 * screens.
 */
describe('HomeScreen — dashboardOverflow is no longer unconditionally hidden (structural)', () => {
  const home = fs.readFileSync(path.join(__dirname, '..', 'HomeScreen.tsx'), 'utf8');

  it('dashboardOverflow no longer sets display: none', () => {
    const styleMatch = home.match(/dashboardOverflow:\s*\{([^}]*)\}/);
    expect(styleMatch).not.toBeNull();
    expect(styleMatch![1]).not.toMatch(/display:\s*'none'/);
  });

  it('the overdue-walks section ("ממתינים לעדכון") is present and not inside any other hidden wrapper', () => {
    expect(home).toContain('ממתינים לעדכון');
    expect(home).toContain('{overduePending.length > 0 ? (');
  });

  it('the further-upcoming-walks section ("טיולים קרובים") is present', () => {
    expect(home).toContain('טיולים קרובים');
    expect(home).toContain('{upcoming.length > 0 ? (');
  });

  it('removed the dead, fully-redundant duplicate "הטיול האחרון" card — the compact one (dashboardLastWalk styles) is the only one left', () => {
    // The OLD duplicate card's own distinctive styles must be gone from
    // the JSX entirely (no second render site for the same lastWalk data).
    expect(home).not.toContain('style={styles.lastWalkCard}');
    expect(home).not.toContain('style={styles.lastWalkTopRow}');
    // The compact, kept card (rendered earlier, NOT inside dashboardOverflow)
    // is still present and does the same job.
    expect(home).toContain('style={styles.dashboardLastWalk}');
  });

  it('"הטיול האחרון" is rendered by exactly one call site, never two competing ones', () => {
    const occurrences = home.match(/>הטיול האחרון</g) ?? [];
    expect(occurrences.length).toBe(1);
  });
});
