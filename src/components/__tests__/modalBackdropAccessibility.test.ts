import fs from 'fs';
import path from 'path';

/**
 * QA Guardian sweep (accessibility labels on non-Button Pressable elements):
 * every sheet-modal's tap-outside-to-dismiss backdrop is a full-screen
 * `Pressable` with `onPress={onClose}`/`onPress={onCancel}` but, before this
 * fix, carried no accessibilityRole/accessibilityLabel — unlike the already-
 * correct pattern in WalkCompletionCelebration.tsx/ReminderMascotPrompt.tsx
 * (`accessibilityRole="button"` + a descriptive `accessibilityLabel`). A
 * screen-reader user swiping through the modal would land on a large
 * unlabeled interactive element. Verifies each backdrop `Pressable` now
 * carries both, via the source-scan convention this repo uses for RN
 * components it can't render-test directly.
 */
describe('Modal backdrop Pressables — accessibility role/label', () => {
  const componentsDir = path.resolve(__dirname, '..');

  const files = [
    'UserPickerModal.tsx',
    'CompleteWalkModal.tsx',
    'RemindersModal.tsx',
    'AddUnplannedWalkModal.tsx',
    'DogDetailsModal.tsx',
    'RequestsInboxModal.tsx',
    'RuleFormModal.tsx',
    'RequestTimeChangeModal.tsx',
    'MemberDetailsModal.tsx',
    'EditWalkModal.tsx',
    'UserFormModal.tsx',
    'EditDoneDetailsModal.tsx',
    'AdminAuditLogModal.tsx',
    'InviteShareModal.tsx',
    'AdminActivityModal.tsx',
    'FamilySharingModal.tsx',
    'SwapWalkPickerModal.tsx',
  ];

  it.each(files)('%s backdrop Pressable has accessibilityRole="button" and a non-empty accessibilityLabel', (file) => {
    const source = fs.readFileSync(path.join(componentsDir, file), 'utf8');
    const index = source.indexOf('styles.backdrop}');
    expect(index).toBeGreaterThan(-1);
    const around = source.slice(index, index + 400);
    expect(around).toMatch(/accessibilityRole="button"/);
    expect(around).toMatch(/accessibilityLabel=/);
    expect(around).not.toMatch(/accessibilityLabel=(""|\{\s*\})/);
  });
});
