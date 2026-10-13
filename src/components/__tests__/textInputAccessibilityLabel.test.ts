import fs from 'fs';
import path from 'path';

/**
 * QA Guardian sweep (accessibility labels on form TextInputs): every
 * `TextInput` in the app relied only on a visible `placeholder` and/or an
 * adjacent `RtlText` label — neither is read reliably as the accessible
 * name by screen readers (Android TalkBack in particular does not fall back
 * to `placeholder`, and RN has no `accessibilityLabelledBy` linking a
 * sibling `Text` to an input). Before this fix, every `TextInput` in the
 * app had no `accessibilityLabel`, unlike the already-correct pattern for
 * `Pressable`/`Button` elements (see modalBackdropAccessibility.test.ts,
 * MemberDetailsModal.roleToggleAccessibility.test.ts). Verifies every
 * `<TextInput` call site across these files now carries a non-empty
 * `accessibilityLabel`, via the source-scan convention this repo uses for
 * RN components it can't render-test directly.
 */
describe('TextInput — accessibilityLabel', () => {
  const srcDir = path.resolve(__dirname, '../..');

  const files = [
    'components/PinEntryModal.tsx',
    'components/PinSetupModal.tsx',
    'components/RuleFormModal.tsx',
    'components/CompleteWalkModal.tsx',
    'components/AddUnplannedWalkModal.tsx',
    'components/DogDetailsModal.tsx',
    'components/EditDoneDetailsModal.tsx',
    'components/UserFormModal.tsx',
    'screens/FamilyOnboardingScreen.tsx',
    'screens/SystemAdminScreen.tsx',
  ];

  it.each(files)('every <TextInput in %s has a non-empty accessibilityLabel', (file) => {
    const source = fs.readFileSync(path.join(srcDir, file), 'utf8');
    const openTagIndices: number[] = [];
    let searchFrom = 0;
    for (;;) {
      const idx = source.indexOf('<TextInput', searchFrom);
      if (idx === -1) break;
      openTagIndices.push(idx);
      searchFrom = idx + 1;
    }
    expect(openTagIndices.length).toBeGreaterThan(0);

    for (const idx of openTagIndices) {
      const closeIdx = source.indexOf('/>', idx);
      expect(closeIdx).toBeGreaterThan(idx);
      const tagSource = source.slice(idx, closeIdx);
      expect(tagSource).toMatch(/accessibilityLabel=/);
      expect(tagSource).not.toMatch(/accessibilityLabel=(""|\{\s*\})/);
    }
  });
});
