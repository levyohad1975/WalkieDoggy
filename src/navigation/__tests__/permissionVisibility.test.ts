import fs from 'fs';
import path from 'path';

/**
 * BATCH 3 (Task 4 — navigation visibility). Same source-text-scan
 * convention as this directory's existing tabBarRtlContract.test.ts (and
 * every other screen-level "test" in this repo — see
 * SettingsScreen.switchUserFlow.test.ts's doc comment: there is no React
 * Native component-rendering test infrastructure here). Proves that the
 * History/Statistics tabs are conditionally rendered from the centralized
 * permission resolver (logic/permissions.ts), not from an ad-hoc inline
 * role check — the actual "override, else role default" logic itself is
 * covered by logic/__tests__/permissions.test.ts.
 *
 * CORRECTED (Batch 3 final review correction, item 4): RootNavigator used
 * to call the plain, fail-OPEN-while-loading canViewHistory()/
 * canViewStatistics() resolvers directly, which resolve to the role
 * default (true) whenever permissionOverrides is still `[]` — including
 * while it simply hasn't loaded yet. That could transiently show a tab as
 * allowed for a member whose real override denies them. This now scans for
 * the fail-closed canAccessHistoryScreen()/canAccessStatisticsScreen() gate
 * — the SAME functions HistoryScreen.tsx/StatisticsScreen.tsx already use
 * at the screen boundary — driven by the existing permissionOverridesStatus
 * signal from familyStore, not a new mechanism invented for navigation.
 */
describe('RootNavigator — History/Statistics tab visibility (permission-gated, fail-closed)', () => {
  const source = fs.readFileSync(path.resolve(__dirname, '../RootNavigator.tsx'), 'utf8');

  it('imports the fail-closed screen-access gates rather than the plain (fail-open-while-loading) resolvers', () => {
    expect(source).toMatch(/import\\s*\\{[\\s\\S]*canAccessHistoryScreen,[\\s\\S]*canAccessStatisticsScreen,[\\s\\S]*canAccessSettingsScreen[\\s\\S]*\\}\\s*from\s*'\.\.\/logic\/permissions'/);
    expect(source).not.toMatch(/import\s*\{\s*canViewHistory/);
  });

  it('reads permissionOverridesStatus from familyStore — the existing PermissionLoadStatus signal, not an invented one', () => {
    expect(source).toMatch(/const permissionOverridesStatus = useFamilyStore\(\(s\) => s\.permissionOverridesStatus\);/);
  });

  it('does not mount the History route until access is verified', () => {
    expect(source).toMatch(/\{canSeeHistoryTab \? <Tab\.Screen name="History" component=\{HistoryScreen\} \/> : null\}/);
    expect(source).toMatch(/canSeeHistoryTab = canAccessHistoryScreen\(effectiveUserId, permissionOverrides, permissionOverridesStatus\)/);
  });

  it('does not mount the Statistics route until access is verified', () => {
    expect(source).toMatch(/\{canSeeStatisticsTab \? <Tab\.Screen name="Statistics" component=\{StatisticsScreen\} \/> : null\}/);
    expect(source).toMatch(/canSeeStatisticsTab = canAccessStatisticsScreen\(effectiveUserId, permissionOverrides, permissionOverridesStatus\)/);
  });

  it('uses the EFFECTIVE user id (respects impersonation/Test Mode), not the real one', () => {
    expect(source).toMatch(/const effectiveUserId = useEffectiveUserId\(\);/);
  });

  it('keeps core tabs mounted and permission-gates Settings while preserving an active protected tab during refresh', () => {
    expect(source).toMatch(/<Tab\.Screen name="Home" component=\{HomeScreen\} \/>/);
    expect(source).toMatch(/<Tab\.Screen name="Schedule" component=\{ScheduleScreen\} \/>/);
    expect(source).toMatch(/<Tab\.Screen name="Family" component=\{FamilyScreen\} \/>/);
    expect(source).toMatch(/canSeeSettingsTab/);
    expect(source).toContain("activeTabName === 'History'");
    expect(source).toContain("activeTabName === 'Statistics'");
    expect(source).toContain("activeTabName === 'Settings'");
  });
});

