import fs from 'fs';
import path from 'path';

/**
 * QA Guardian follow-up (accessibilityHint-on-destructive-actions, category
 * (a)): the two remaining variant="secondary"/icon-only remnants deliberately
 * deferred by the prior cycle's dangerButtonAccessibilityHint.test.ts sweep
 * (not variant="danger", so outside that grep's boundary, but each still
 * triggers a confirmation step — FamilySharingModal.tsx's "החלפת קוד" Button
 * opens Alert.alert via SettingsScreen.tsx's confirmRegenerateInviteCode, and
 * ScheduleScreen.tsx's 🗑️ delete-rule Pressable opens ConfirmModal). Verifies
 * each now has a non-empty accessibilityHint, via this repo's established
 * source-scan convention for RN components with no render-test harness.
 */
describe('secondary/icon destructive-action accessibilityHint', () => {
  it('FamilySharingModal.tsx: the "החלפת קוד" Button has a non-empty accessibilityHint', () => {
    const source = fs.readFileSync(path.resolve(__dirname, '../FamilySharingModal.tsx'), 'utf8');
    const labelIndex = source.indexOf("label={regenerating ? 'מחליף קוד...' : 'החלפת קוד'}");
    expect(labelIndex).toBeGreaterThan(-1);
    const buttonStart = source.lastIndexOf('<Button', labelIndex);
    const buttonEnd = source.indexOf('/>', labelIndex);
    const around = source.slice(buttonStart, buttonEnd);
    expect(around).toMatch(/accessibilityHint="[^"]+"/);
  });

  it('ScheduleScreen.tsx: the 🗑️ delete-rule Pressable has a non-empty accessibilityHint', () => {
    const source = fs.readFileSync(path.resolve(__dirname, '../../screens/ScheduleScreen.tsx'), 'utf8');
    const labelIndex = source.indexOf('accessibilityLabel={`מחיקת שעת טיול ${r.time}`}');
    expect(labelIndex).toBeGreaterThan(-1);
    const pressableStart = source.lastIndexOf('<Pressable', labelIndex);
    const pressableEnd = source.indexOf('>', labelIndex);
    const around = source.slice(pressableStart, pressableEnd);
    expect(around).toMatch(/onPress={\(\) => setDeleteRuleId\(r\.id\)}/);
    expect(around).toMatch(/accessibilityHint="[^"]+"/);
  });
});
