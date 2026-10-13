import fs from 'fs';
import path from 'path';

/**
 * BATCH 4 (item B — dog profile completion). dogs.sex (migration 0022) had
 * no client UI anywhere — this verifies the new picker exists with the
 * three real choices (male/female/genuinely-unset), each wired as an
 * accessible, selectable chip, per the established source-scan convention
 * for RN components this repo can't render-test directly.
 */
describe('DogDetailsModal — dog sex picker (male/female/nullable fallback)', () => {
  const source = fs.readFileSync(path.resolve(__dirname, '../DogDetailsModal.tsx'), 'utf8');

  it('defines exactly three sex options: male, female, and an explicit unset/undefined choice — never forcing a guess', () => {
    expect(source).toMatch(/\{ value: 'male', label: 'זכר' \}/);
    expect(source).toMatch(/\{ value: 'female', label: 'נקבה' \}/);
    expect(source).toMatch(/\{ value: undefined, label: 'לא מוגדר' \}/);
  });

  it('each option renders as a button with accessibilityRole, selected accessibilityState, and a real label', () => {
    expect(source).toMatch(/accessibilityRole="button"\s*\n\s*accessibilityState=\{\{ selected \}\}\s*\n\s*accessibilityLabel=\{opt\.label\}/);
  });

  it('selecting an option calls onSave with only the sex patch, not a full dog rewrite', () => {
    expect(source).toMatch(/onPress=\{\(\) => onSave\(\{ sex: opt\.value \}\)\}/);
  });
});
