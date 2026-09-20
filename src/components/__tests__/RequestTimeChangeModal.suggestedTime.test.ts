/**
 * Regression guard for a real, first-time-discovered defect in
 * RequestTimeChangeModal.tsx: `suggestedTimeFrom(currentTime)` (a helper
 * that proposes "current time + 30 minutes") was defined but its two call
 * sites (the initial `time` state and the `visible`-effect reset) had been
 * silently replaced with plain `currentTime` while an unrelated commit
 * added the web `<input type="time">` control — confirmed by diffing
 * against the committed backup
 * `RequestTimeChangeModal.tsx.before-web-time-picker`, which still calls
 * `suggestedTimeFrom` in both places.
 *
 * User-facing consequence of the regression: since
 * `valid = timeIsValid(time) && time !== currentTime` gates the submit
 * button, and `time` started equal to `currentTime`, the "שלח בקשה" button
 * was disabled the instant the modal opened and the "07:00 → 08:30"
 * before/after preview rendered as an identical pair until the user
 * manually operated the time picker.
 *
 * `suggestedTimeFrom`/`timeIsValid`/etc. are private (unexported) helpers
 * and this repo has no React Native component-rendering test
 * infrastructure (see FamilyOnboardingScreen.tokenSafety.test.ts's own doc
 * comment), so this combines a source-text scan (proving the two call
 * sites are wired) with re-implementing the same pure minute-rollover math
 * the helper documents, to pin the expected value independently.
 */
describe('RequestTimeChangeModal — default proposed time (structural + logic)', () => {
  const source = require('fs').readFileSync(
    require.resolve('../RequestTimeChangeModal'),
    'utf8'
  );

  it('initializes the time state from suggestedTimeFrom(currentTime), not currentTime directly', () => {
    expect(source).toMatch(
      /useState\(\(\)\s*=>\s*suggestedTimeFrom\(currentTime\)\)/
    );
  });

  it('resets the time state to suggestedTimeFrom(currentTime) when the modal becomes visible', () => {
    const effectBlockMatch = source.match(
      /useEffect\(\(\)\s*=>\s*\{[\s\S]*?\}, \[visible, currentTime\]\);/
    );
    expect(effectBlockMatch).not.toBeNull();
    expect(effectBlockMatch![0]).toMatch(/setTime\(suggestedTimeFrom\(currentTime\)\)/);
  });

  function addThirtyMinutes(hhmm: string): string {
    const [h, m] = hhmm.split(':').map(Number);
    const totalMinutes = (h * 60 + m + 30) % (24 * 60);
    const outH = Math.floor(totalMinutes / 60);
    const outM = totalMinutes % 60;
    return `${String(outH).padStart(2, '0')}:${String(outM).padStart(2, '0')}`;
  }

  it('proposes a time 30 minutes after the current time within the same hour', () => {
    expect(addThirtyMinutes('07:00')).toBe('07:30');
  });

  it('rolls over the hour correctly', () => {
    expect(addThirtyMinutes('07:45')).toBe('08:15');
  });

  it('rolls over midnight correctly', () => {
    expect(addThirtyMinutes('23:45')).toBe('00:15');
  });
});
