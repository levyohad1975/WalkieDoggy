import fs from 'fs';
import path from 'path';

/**
 * `previewRotation()` (rotation.ts) was fully implemented and unit-tested
 * but had zero production call sites: `RuleFormModal.tsx`'s rotation-order
 * picker and `ScheduleScreen.tsx`'s rule-summary row each hand-rolled their
 * own `.join(' → ')` preview instead, neither of which correctly reproduced
 * `previewRotation`'s multi-turn wraparound. Verifies, via this repo's
 * established source-scan convention for RN components with no render-test
 * harness, that this call site now uses the shared, tested helper.
 *
 * Real-device QA fix — RuleFormModal.tsx no longer has a rotation-order
 * picker at all: a scheduled walk/rule now has exactly ONE responsible
 * member (single-select), so there is nothing left to preview there — see
 * RuleFormModal.singleSelectAssignee.test.ts for that fix's own coverage.
 * ScheduleScreen.tsx's rule-summary row is untouched and still previews
 * whatever rotationUserIds a rule actually has (including a pre-existing
 * multi-member rule saved before this fix).
 */
describe('previewRotation wiring', () => {
  const cases: Array<[file: string]> = [['../../screens/ScheduleScreen.tsx']];

  it.each(cases)('%s imports previewRotation from logic/rotation', (file) => {
    const source = fs.readFileSync(path.resolve(__dirname, file), 'utf8');
    expect(source).toMatch(/import\s*\{\s*previewRotation\s*\}\s*from\s*['"].*logic\/rotation['"]/);
    expect(source).toMatch(/previewRotation\(/);
  });

  it.each(cases)('%s no longer hand-rolls the rotation-arrow join', (file) => {
    const source = fs.readFileSync(path.resolve(__dirname, file), 'utf8');
    expect(source).not.toMatch(/\.join\(' → '\)/);
  });
});
