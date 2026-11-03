/**
 * Structural guard (no RN rendering harness in this repo).
 *
 * Production feedback 2026-11-01: after a spontaneous walk with pee counted
 * three times, the Home "הטיול האחרון" card looked unmarked — the 💧 emoji is
 * pale by nature, so full opacity vs. 0.28 was not a visible difference, and
 * the count was not shown at all.
 */
describe('HomeScreen — last walk pee/poop markers', () => {
  const source: string = require('fs').readFileSync(require.resolve('../HomeScreen'), 'utf8');

  it('treats a recorded count as a marked need even if the boolean flag is missing', () => {
    expect(source).toContain('const lastWalkHadPee = !!lastWalk?.hadPee || lastWalkPeeCount > 0;');
    expect(source).toContain('const lastWalkHadPoop = !!lastWalk?.hadPoop || lastWalkPoopCount > 0;');
  });

  it('highlights a marked need with a tinted chip, not opacity alone', () => {
    expect(source).toContain('lastWalkHadPee && styles.dashboardLastWalkNeedActivePee');
    expect(source).toContain('lastWalkHadPoop && styles.dashboardLastWalkNeedActivePoop');
    expect(source).toMatch(/dashboardLastWalkNeedActivePee: \{[^}]*backgroundColor: colors\.statusCurrentBg/);
    expect(source).toMatch(/dashboardLastWalkNeedActivePoop: \{[^}]*backgroundColor: colors\.statusSkippedBg/);
  });

  it('shows the count when a need happened more than once and announces it', () => {
    expect(source).toContain('{lastWalkPeeCount > 1 ? <RtlText style={styles.dashboardLastWalkNeedCount}>{lastWalkPeeCount}</RtlText> : null}');
    expect(source).toContain('{lastWalkPoopCount > 1 ? <RtlText style={styles.dashboardLastWalkNeedCount}>{lastWalkPoopCount}</RtlText> : null}');
    expect(source).toContain('`סימון פיפי בטיול האחרון, ${lastWalkPeeCount} פעמים`');
  });
});

describe('HomeScreen — last walk pee/poop spacing', () => {
  const source: string = require('fs').readFileSync(require.resolve('../HomeScreen'), 'utf8');

  it('leaves a clear gap between the two 26pt chips, and the mascot lane avoids them', () => {
    expect(source).toContain("dashboardLastWalkNeeds: { position: 'absolute', right: 0, top: 4, width: 70, height: 44,");
    expect(source).toContain("dashboardLastWalkNeedButton: { width: 26, height: 44,");
    expect(source).toContain("dashboardLastWalkMascotLane: { position: 'absolute', left: 32, right: 72,");
  });
});
