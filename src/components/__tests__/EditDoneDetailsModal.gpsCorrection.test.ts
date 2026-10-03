import fs from 'fs';

/**
 * Remaining GPS phases (PRD §7) — the correction flow's store/schema side
 * (gpsStore.correctDistance, migration 0051) was already complete but had
 * no UI entry point. EditDoneDetailsModal is where a scheduled walk's
 * completed-details already get corrected (pee/poop/note/who-walked-it),
 * so it's the natural place to add "confirm/correct the GPS distance"
 * too — same "assistive, not sole source of truth" posture as the rest of
 * this feature. Source-scan convention: this repo has no render-test
 * harness for components/modals.
 */
describe('EditDoneDetailsModal wires the GPS distance correction flow (structural)', () => {
  const source = fs.readFileSync(require.resolve('../EditDoneDetailsModal'), 'utf8').replace(/\r\n/g, '\n');

  it('imports useGpsStore and calls correctDistance, not a new parallel write path', () => {
    expect(source).toMatch(/import \{ useGpsStore \} from '\.\.\/store\/gpsStore';/);
    expect(source).toMatch(/useGpsStore\.getState\(\)\.correctDistance\(walk\.id, parsed, currentUserId\)/);
  });

  it('loads the walk\'s GPS session on open via loadSession, not a fresh fetch of its own', () => {
    const effectStart = source.indexOf('useEffect(() => {\n    if (visible && walk) {');
    expect(effectStart).toBeGreaterThan(-1);
    const effectBlock = source.slice(effectStart, effectStart + 700);
    expect(effectBlock).toMatch(/useGpsStore\.getState\(\)\.loadSession\(walk\.id\)/);
  });

  it('only shows the distance field once a real reading exists — never a blocking empty-by-default field', () => {
    expect(source).toMatch(/const showDistanceField = gpsDistanceMeters != null;/);
    const fieldIdx = source.indexOf('showDistanceField ? (');
    expect(fieldIdx).toBeGreaterThan(-1);
  });

  it('prefers the already-corrected value over the original device reading when prefilling the input', () => {
    expect(source).toMatch(/const authoritative = session\.correctedDistanceMeters \?\? session\.distanceMeters;/);
  });

  it('still shows the original device-computed reading alongside the editable field, never silently replacing it', () => {
    expect(source).toMatch(/מדידת GPS מקורית/);
    expect(source).toMatch(/formatDistanceMeters\(gpsDistanceMeters!\)/);
  });

  it('the GPS write is independent of (never blocks or is blocked by) the primary onSave', () => {
    const onPressIdx = source.indexOf('onPress={() => {');
    expect(onPressIdx).toBeGreaterThan(-1);
    const block = source.slice(onPressIdx, source.indexOf('style={styles.flex}', onPressIdx));
    // onSave(...) call happens, then the GPS correction is a separate `if` below it — not awaited inline with onSave's own call.
    expect(block.indexOf('onSave({')).toBeLessThan(block.indexOf('if (showDistanceField)'));
  });

  it('validates the distance input before ever calling correctDistance (never NaN/negative)', () => {
    expect(source).toMatch(/Number\.isFinite\(parsed\) && parsed >= 0/);
  });
});
