import fs from 'fs';
import path from 'path';

/**
 * BATCH 3 (Task 4) — see HistoryScreen.permissionGate.test.ts's identical
 * doc comment for the full reasoning and testing-convention note.
 * CORRECTED (Batch 3 correction #1, post-review) and CORRECTED AGAIN
 * (Batch 3 correction #2, review #2) — see that same file's updated doc
 * comment. This screen has no mutations of its own, so its only reactivity
 * source is useFocusEffect (refetch on every return to this tab).
 */
describe('StatisticsScreen — enforces view_statistics itself, not just via hidden navigation', () => {
  const source = fs.readFileSync(path.resolve(__dirname, '../StatisticsScreen.tsx'), 'utf8');

  it('imports the fail-closed screen-access gate rather than the plain (fail-open-while-loading) resolver', () => {
    expect(source).toMatch(/import\s*\{\s*canAccessStatisticsScreen\s*\}\s*from\s*'\.\.\/logic\/permissions'/);
  });

  it('imports the server-authoritative RPC wrapper and calls it', () => {
    expect(source).toMatch(/import\s*\{\s*fetchStatisticsWalks\s*\}\s*from\s*'\.\.\/lib\/permissionedWalks'/);
    expect(source).toMatch(/fetchStatisticsWalks\(\)/);
  });

  it('reads the effective user id and permissionOverrides/permissionOverridesStatus', () => {
    expect(source).toMatch(/const effectiveUserId = useEffectiveUserId\(\);/);
    expect(source).toMatch(/const \{[\s\S]{0,300}permissionOverrides[\s\S]{0,10}permissionOverridesStatus[\s\S]{0,10}\} = useFamilyStore\(\)/);
  });

  it('holds fetchStatisticsWalks()\'s resolved rows in state as the actual dataset, rather than discarding them as a bare allow/deny probe', () => {
    expect(source).toMatch(/const \[statisticsDataset, setStatisticsDataset\] = useState<Walk\[\]>\(\[\]\)/);
    expect(source).toMatch(/const rows = await fetchStatisticsWalks\(\);\s*\n\s*setStatisticsDataset\(rows\);/);
  });

  it('every downstream computation reads from sourceWalks (statisticsDataset in Supabase mode), not the raw scheduleStore walks', () => {
    expect(source).toMatch(/const sourceWalks = isSupabaseConfigured \? statisticsDataset : walks;/);
    expect(source).toMatch(/const periodWalks = useMemo\(\(\) => filterWalksByPeriod\(sourceWalks, period\), \[sourceWalks, period\]\);/);
    // Bare `walks` (not `sourceWalks`) should only remain in the
    // useScheduleStore() destructure itself and the sourceWalks fallback
    // expression — never as a second, competing data source downstream.
    // Comments are stripped first (same convention as
    // SettingsScreen.switchUserFlow.test.ts) so prose mentioning "walks" in
    // doc comments doesn't count as a code reference.
    const codeOnly = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    const bareWalksUses = codeOnly.match(/\bwalks\b/g) ?? [];
    expect(bareWalksUses.length).toBeLessThanOrEqual(2);
  });

  it('refreshes the permissioned dataset on focus (useFocusEffect) — this screen has no mutations of its own, so focus refetch is its only reactivity source', () => {
    expect(source).toMatch(/import\s*\{\s*useFocusEffect\s*\}\s*from\s*'@react-navigation\/native'/);
    expect(source).toMatch(/useFocusEffect\(\s*\n\s*useCallback\(\(\) => \{\s*\n\s*void refreshStatisticsDataset\(\);/);
  });

  it('renders a blocked state instead of the real content when EITHER the client gate or the server check denies access, BEFORE the main return', () => {
    const guardIdx = source.indexOf(
      '!canAccessStatisticsScreen(effectiveUserId, permissionOverrides, permissionOverridesStatus) ||'
    );
    expect(guardIdx).toBeGreaterThan(-1);
    const mainReturnIdx = source.indexOf('📈 סטטיסטיקה');
    expect(mainReturnIdx).toBeGreaterThan(-1);
    expect(guardIdx).toBeLessThan(mainReturnIdx);
  });

  it('the server check defaults to blocking (\'checking\', not \'granted\') in Supabase mode, so an in-flight verification never transiently allows access', () => {
    expect(source).toMatch(/useState<'checking' \| 'granted' \| 'denied'>\(\s*isSupabaseConfigured \? 'checking' : 'granted'\s*\)/);
  });
});
