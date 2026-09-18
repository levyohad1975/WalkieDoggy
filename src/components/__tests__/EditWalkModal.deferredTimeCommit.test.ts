import fs from 'fs';
import path from 'path';

/**
 * Regression guard for a real, first-time-discovered defect in
 * EditWalkModal.tsx: `handleTimeChange` used to call `onChangeTime`
 * immediately on every `TimePickerField` onChange. On iOS,
 * `@react-native-community/datetimepicker`'s `display="spinner"` mode (used
 * by `TimePickerField` on iOS) fires `onChange` continuously as the wheel
 * scrolls, not just once on a final "Done" tap (spinner mode has no Done
 * button at all) — so the very first intermediate value the wheel passed
 * through was immediately committed via `rescheduleWalk` (a real,
 * family-synced write) and the sheet was torn down (`setEditingWalkId(null)`
 * / `setEditWalkId(null)` in ScheduleScreen.tsx/HomeScreen.tsx) before the
 * user could reach their intended time.
 *
 * `RequestTimeChangeModal.tsx` and `AddUnplannedWalkModal.tsx` use the
 * identical spinner picker but only update local state on `onChange`,
 * requiring an explicit submit button before anything is committed —
 * EditWalkModal now matches that established pattern via an explicit
 * "עדכן שעה" button, gated on the time actually having changed to a valid
 * value.
 *
 * This repo has no React Native component-rendering test infrastructure
 * (see FamilyOnboardingScreen.tokenSafety.test.ts's own doc comment), so
 * this combines a source-text scan (proving `handleTimeChange` no longer
 * calls `onChangeTime` and the explicit button is wired) with re-testing the
 * same pure `timeChanged` gating condition the component uses, independent
 * of the component itself.
 */
describe('EditWalkModal — time changes are only committed via an explicit confirm, not on every picker tick', () => {
  const source = fs.readFileSync(path.resolve(__dirname, '../EditWalkModal.tsx'), 'utf8');

  it('handleTimeChange only updates local state, never calls onChangeTime directly', () => {
    const match = source.match(/const handleTimeChange = \(newTime: string\) => \{[\s\S]*?\n  \};/);
    expect(match).not.toBeNull();
    const body = match![0];
    expect(body).toMatch(/setTime\(newTime\)/);
    expect(body).not.toMatch(/onChangeTime/);
  });

  it('TimePickerField is wired to handleTimeChange, not directly to onChangeTime', () => {
    expect(source).toMatch(/<TimePickerField value=\{time\} onChange=\{handleTimeChange\}/);
  });

  it('a dedicated "עדכן שעה" button calls onChangeTime(time) explicitly, gated on timeChanged', () => {
    const index = source.indexOf('label="עדכן שעה"');
    expect(index).toBeGreaterThan(-1);
    const around = source.slice(index, index + 200);
    expect(around).toMatch(/disabled=\{!timeChanged\}/);
    expect(around).toMatch(/onPress=\{\(\) => onChangeTime\(time\)\}/);
  });

  it('timeChanged requires a valid 24-hour time that differs from the walk\'s current scheduledTime', () => {
    expect(source).toMatch(
      /const timeChanged = is24HourTime\(time\) && time !== walk\.scheduledTime;/
    );
  });

  function is24HourTime(value: string): boolean {
    return /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
  }

  function timeChanged(time: string, scheduledTime: string): boolean {
    return is24HourTime(time) && time !== scheduledTime;
  }

  it('does not treat an unchanged time as a pending commit', () => {
    expect(timeChanged('08:00', '08:00')).toBe(false);
  });

  it('treats a genuinely different valid time as a pending commit', () => {
    expect(timeChanged('08:30', '08:00')).toBe(true);
  });

  it('does not treat an intermediate invalid time (mid-scroll) as a pending commit', () => {
    expect(timeChanged('8:3', '08:00')).toBe(false);
  });
});
