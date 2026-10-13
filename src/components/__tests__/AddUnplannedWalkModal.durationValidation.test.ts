import fs from 'fs';
import path from 'path';

/**
 * Regression guard for a real, first-time-discovered defect in
 * AddUnplannedWalkModal.tsx: the free-text "משך (דקות, אופציונלי)" duration
 * field fed straight into `durationMinutes: duration ? Number(duration) : undefined`
 * with no validation at all, unlike the sibling date/time fields which both
 * already gate the "שמור" button on a format check via `valid`.
 * `keyboardType="number-pad"` is only an on-screen-keyboard hint — it does
 * not block clipboard paste — so a non-integer value (e.g. "20.5") could
 * reach `walks.duration_minutes`, a Postgres `int` column. That fails every
 * retry with a class-22 (data_exception) Postgres error, which — before
 * this fix — was NOT in syncQueue.ts's `isPermanentError` allowlist, so the
 * malformed queued write would `break` the flush loop and block every later
 * queued operation for every user and every feature behind it forever,
 * exactly like the already-fixed 23xxx/42xxx/28xxx/P0xxx classes.
 *
 * Fixed with a `durationValid` check (empty stays valid, since duration is
 * optional; otherwise digits-only) folded into the existing `valid` gate.
 * This repo has no React Native component-rendering test infrastructure
 * (see FamilyOnboardingScreen.tokenSafety.test.ts's own doc comment), so
 * this combines a source-text scan (proving `durationValid` is wired into
 * `valid`) with re-implementing the same pure regex the component uses, to
 * pin the expected behavior independently.
 */
describe('AddUnplannedWalkModal — duration input validation (structural + logic)', () => {
  const source = fs.readFileSync(path.resolve(__dirname, '../AddUnplannedWalkModal.tsx'), 'utf8');

  it('defines durationValid as empty-or-digits-only', () => {
    expect(source).toMatch(
      /const durationValid = duration\.trim\(\) === '' \|\| \/\^\\d\+\$\/\.test\(duration\.trim\(\)\)/
    );
  });

  it('folds durationValid into the Save-button valid gate, alongside the existing time/date checks', () => {
    const validLine = source.match(/const valid = [^;]+;/);
    expect(validLine).not.toBeNull();
    expect(validLine![0]).toMatch(/timeIsValid\(time\)/);
    expect(validLine![0]).toMatch(/date\)/);
    expect(validLine![0]).toMatch(/durationValid/);
  });

  function durationValid(duration: string): boolean {
    return duration.trim() === '' || /^\d+$/.test(duration.trim());
  }

  it('accepts an empty duration (optional field)', () => {
    expect(durationValid('')).toBe(true);
  });

  it('accepts a plain integer duration', () => {
    expect(durationValid('20')).toBe(true);
  });

  it('rejects a fractional duration that would fail the underlying Postgres int column', () => {
    expect(durationValid('20.5')).toBe(false);
  });

  it('rejects non-numeric pasted text', () => {
    expect(durationValid('abc')).toBe(false);
  });

  it('rejects a negative duration', () => {
    expect(durationValid('-5')).toBe(false);
  });
});
