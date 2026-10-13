import fs from 'fs';
import path from 'path';

/**
 * QA sweep: every bare `<ActivityIndicator>` used as a screen/list loading
 * state had no `accessibilityLabel` at all, so a screen-reader user got no
 * announcement that content was loading (RN does not synthesize one).
 * `Button.tsx`'s own internal `ActivityIndicator` is excluded — its parent
 * `Pressable` already announces `accessibilityState.busy`, so a separate
 * label there would be redundant. Verifies every other bare
 * `<ActivityIndicator>` in the repo now carries `accessibilityLabel="טוען…"`,
 * via this repo's established source-scan convention for RN components with
 * no render-test harness.
 */
const TARGET_FILES = [
  '../AdminActivityModal.tsx',
  '../AdminAuditLogModal.tsx',
  '../../screens/SystemAdminScreen.tsx',
  '../../screens/HomeScreen.tsx',
  '../../screens/LoginScreen.tsx',
  '../../screens/StatisticsScreen.tsx',
  '../../screens/FamilyOnboardingScreen.tsx',
  '../../screens/ScheduleScreen.tsx',
  '../../screens/HistoryScreen.tsx',
];

describe('bare ActivityIndicator -> accessibilityLabel', () => {
  for (const relativeFile of TARGET_FILES) {
    it(`every <ActivityIndicator> in ${relativeFile} carries accessibilityLabel="טוען…"`, () => {
      const source = fs.readFileSync(path.resolve(__dirname, relativeFile), 'utf8');
      const matches = source.match(/<ActivityIndicator[^]*?\/>/g) ?? [];
      expect(matches.length).toBeGreaterThan(0);
      for (const tag of matches) {
        expect(tag).toContain('accessibilityLabel="טוען…"');
      }
    });
  }
});
