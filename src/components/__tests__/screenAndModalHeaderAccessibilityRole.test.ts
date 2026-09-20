import fs from 'fs';
import path from 'path';

/**
 * QA sweep: every screen's and modal's primary heading `<RtlText>` (the
 * first/only title element a screen-reader user would expect to land on
 * when navigating by heading, e.g. VoiceOver's rotor or TalkBack's
 * heading-navigation gesture) had no `accessibilityRole="header"` at all —
 * RN does not infer this role from font size or layout, so these titles
 * were indistinguishable from any other text node to assistive tech.
 * Verifies every targeted heading now carries the role, via this repo's
 * established source-scan convention for RN components with no
 * render-test harness.
 */
const TARGET_FILES: Array<[string, string, number]> = [
  ['../../screens/FamilyOnboardingScreen.tsx', 'title', 6],
  ['../../screens/LoginScreen.tsx', 'title', 1],
  ['../../screens/SystemAdminScreen.tsx', 'title', 1],
  ['../../screens/SettingsScreen.tsx', 'header', 1],
  ['../../screens/SettingsScreen.tsx', 'title', 1],
  ['../../screens/FamilyScreen.tsx', 'header', 1],
  ['../../screens/StatisticsScreen.tsx', 'header', 1],
  ['../../screens/ScheduleScreen.tsx', 'header', 1],
  ['../../screens/HistoryScreen.tsx', 'header', 1],
  ['../DeleteUserModal.tsx', 'title', 1],
  ['../DogDetailsModal.tsx', 'title', 1],
  ['../AddUnplannedWalkModal.tsx', 'title', 1],
  ['../RemindersModal.tsx', 'title', 1],
  ['../PinEntryModal.tsx', 'title', 1],
  ['../UserPickerModal.tsx', 'title', 1],
  ['../CompleteWalkModal.tsx', 'title', 1],
  ['../SwapWalkPickerModal.tsx', 'title', 1],
  ['../FamilySharingModal.tsx', 'title', 1],
  ['../AdminActivityModal.tsx', 'title', 1],
  ['../InviteShareModal.tsx', 'title', 1],
  ['../ConfirmModal.tsx', 'title', 1],
  ['../AdminAuditLogModal.tsx', 'title', 1],
  ['../EditDoneDetailsModal.tsx', 'title', 1],
  ['../UserFormModal.tsx', 'title', 1],
  ['../EditWalkModal.tsx', 'title', 1],
  ['../RequestTimeChangeModal.tsx', 'title', 1],
  ['../EmptyState.tsx', 'title', 2],
  ['../RuleFormModal.tsx', 'title', 1],
  ['../PinSetupModal.tsx', 'title', 1],
  ['../RequestsInboxModal.tsx', 'title', 1],
  ['../MemberDetailsModal.tsx', 'name', 1],
];

describe('screen/modal heading RtlText -> accessibilityRole="header"', () => {
  for (const [relativeFile, styleKey, expectedCount] of TARGET_FILES) {
    it(`every heading <RtlText style={styles.${styleKey}}> in ${relativeFile} carries accessibilityRole="header"`, () => {
      const source = fs.readFileSync(path.resolve(__dirname, relativeFile), 'utf8');
      const tagPattern = new RegExp(`<RtlText style=\\{styles\\.${styleKey}\\}[^>]*>`, 'g');
      const matches = source.match(tagPattern) ?? [];
      expect(matches.length).toBe(expectedCount);
      for (const tag of matches) {
        expect(tag).toContain('accessibilityRole="header"');
      }
    });
  }
});
