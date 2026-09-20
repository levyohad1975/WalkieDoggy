import fs from 'fs';
import path from 'path';

/**
 * QA Guardian follow-up (accessibilityHint-on-destructive-actions, category
 * (a)): the app's five `variant="danger"` Buttons are already gated by a
 * native `Alert.alert` or a custom `ConfirmModal`/self-contained confirm
 * screen that announces the warning, so this is a lower-priority nice-to-have
 * (unlike category (b)'s zero-warning actions, e.g.
 * requestsInboxRejectAccessibilityHint.test.ts) — but none previously carried
 * an accessibilityHint at all. Verifies each now has a non-empty one, via
 * this repo's established source-scan convention for RN components with no
 * render-test harness.
 */
describe('danger-variant Button accessibilityHint', () => {
  const cases: Array<[file: string, marker: string]> = [
    ['../EditWalkModal.tsx', 'בטל את הטיול הזה'],
    ['../EditDoneDetailsModal.tsx', '🗑️ מחיקת הטיול'],
    ['../InviteShareModal.tsx', 'בטל הזמנה'],
    ['../AddUnplannedWalkModal.tsx', 'מחק טיול זה'],
    ['../DeleteUserModal.tsx', 'מחק'],
  ];

  it.each(cases)('%s: the danger Button labeled "%s" has a non-empty accessibilityHint', (file, marker) => {
    const source = fs.readFileSync(path.resolve(__dirname, file), 'utf8');
    const labelIndex = source.indexOf(`label="${marker}"`);
    expect(labelIndex).toBeGreaterThan(-1);
    const buttonStart = source.lastIndexOf('<Button', labelIndex);
    const buttonEnd = source.indexOf('/>', labelIndex);
    const around = source.slice(buttonStart, buttonEnd);
    expect(around).toMatch(/variant="danger"/);
    expect(around).toMatch(/accessibilityHint="[^"]+"/);
  });
});
