import fs from 'fs';
import path from 'path';

/**
 * QA sweep: every dynamic inline error/notice `<RtlText>` (rendered
 * conditionally in response to a user action, on a screen/modal that is
 * already mounted and already narrated — no navigation or modal-open event
 * to re-trigger screen-reader attention) had no `accessibilityRole="alert"`
 * nor `accessibilityLiveRegion="polite"`, so a screen-reader user got no
 * announcement when a new error/notice appeared. `accessibilityRole="alert"`
 * covers iOS VoiceOver; `accessibilityLiveRegion="polite"` (Android-only) is
 * added alongside it for TalkBack. Full-screen `ErrorState` replacements and
 * modal-open-time content (e.g. `DeleteUserModal`'s impact warning) are
 * intentionally excluded — the mount/open event itself already draws
 * screen-reader attention there. Verifies every targeted call site now
 * carries both attributes, via this repo's established source-scan
 * convention for RN components with no render-test harness.
 */
const TARGET_FILES: Array<[string, number]> = [
  ['../../screens/FamilyOnboardingScreen.tsx', 4],
  ['../../screens/LoginScreen.tsx', 2],
  ['../../screens/FamilyScreen.tsx', 2],
  ['../../screens/SystemAdminScreen.tsx', 4],
  ['../PinEntryModal.tsx', 1],
  ['../AdminActivityModal.tsx', 1],
  ['../InviteShareModal.tsx', 1],
  ['../AdminAuditLogModal.tsx', 1],
  ['../MemberDetailsModal.tsx', 3],
  ['../ImpersonationBanner.tsx', 1],
  ['../RuleFormModal.tsx', 1],
  ['../PinSetupModal.tsx', 1],
];

describe('dynamic error/notice RtlText -> alert role + live region', () => {
  for (const [relativeFile, expectedCount] of TARGET_FILES) {
    it(`every error/notice <RtlText> in ${relativeFile} carries accessibilityRole="alert" and accessibilityLiveRegion="polite"`, () => {
      const source = fs.readFileSync(path.resolve(__dirname, relativeFile), 'utf8');
      const matches = source.match(/<RtlText style=\{styles\.(?:error|errorText)\}[^>]*>/g) ?? [];
      expect(matches.length).toBe(expectedCount);
      for (const tag of matches) {
        expect(tag).toContain('accessibilityRole="alert"');
        expect(tag).toContain('accessibilityLiveRegion="polite"');
      }
    });
  }
});
