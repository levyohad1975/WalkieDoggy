import fs from 'fs';
import path from 'path';

/**
 * `previewRotation()` (rotation.ts) was fully implemented and unit-tested
 * but had zero production call sites: `RuleFormModal.tsx`'s rotation-order
 * picker and `ScheduleScreen.tsx`'s rule-summary row each hand-rolled their
 * own `.join(' → ')` preview instead, neither of which correctly reproduced
 * `previewRotation`'s multi-turn wraparound. Verifies, via this repo's
 * established source-scan convention for RN components with no render-test
 * harness, that both call sites now use the shared, tested helper.
 */
describe('previewRotation wiring', () => {
  const cases: Array<[file: string]> = [['../../components/RuleFormModal.tsx'], ['../../screens/ScheduleScreen.tsx']];

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
