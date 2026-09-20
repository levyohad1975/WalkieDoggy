import fs from 'fs';
import path from 'path';

/**
 * BATCH 3 (Task 4 — navigation visibility, requirement: "If a user reaches
 * a protected screen through stale navigation/deep-link/state restoration,
 * the screen/action must still enforce the permission"). Same source-text-
 * scan convention as SettingsScreen.switchUserFlow.test.ts (this repo has
 * no React Native component-rendering test infrastructure).
 *
 * CORRECTED (Batch 3 correction #1, post-review): the original version of
 * this test only proved a CLIENT render guard existed — the review
 * correctly flagged that this alone is not server-side enforcement (the
 * underlying data fetch was never permission-scoped).
 *
 * CORRECTED AGAIN (Batch 3 correction #2, review #2): correction #1's
 * version proved the screen CALLED fetchHistoryWalks() as an allow/deny
 * probe, but the review flagged that its resolved rows were then discarded
 * — the screen kept rendering from the unrestricted scheduleStore.walks.
 * This version proves the RPC's rows are the actual, live display/
 * calculation dataset:
 *   1. the screen calls the fail-closed canAccessHistoryScreen() gate (not
 *      the plain, fail-open-while-loading canViewHistory());
 *   2. the screen holds fetchHistoryWalks()'s resolved rows in state
 *      (historyDataset) rather than discarding them;
 *   3. sourceWalks — the variable every downstream computation in this file
 *      reads from — is historyDataset in Supabase mode, not scheduleStore's
 *      raw walks;
 *   4. the screen refreshes that dataset via useFocusEffect (cross-screen/
 *      cross-device staleness) AND immediately after each of its own
 *      mutations (same-screen freshness), so History never falls back to
 *      unrestricted raw historical access just to stay reactive;
 *   5. the render guard blocks on both the client gate and the server
 *      access status, before the main return.
 * The resolver/fail-closed logic itself is covered by
 * logic/__tests__/permissions.test.ts; the RPC's own server-side permission
 * check and the underlying migration's RLS model are covered by
 * lib/__tests__/permissionedWalks.test.ts,
 * lib/__tests__/migration0027.serverEnforcement.test.ts, and
 * lib/__tests__/historyStatisticsPermissionMatrix.test.ts.
 */
describe('HistoryScreen — enforces view_history itself, not just via hidden navigation', () => {
  const source = fs.readFileSync(path.resolve(__dirname, '../HistoryScreen.tsx'), 'utf8');

  it('imports the fail-closed screen-access gate rather than the plain (fail-open-while-loading) resolver', () => {
    expect(source).toMatch(/import\s*\{\s*canAccessHistoryScreen\s*\}\s*from\s*'\.\.\/logic\/permissions'/);
  });

  it('imports the server-authoritative RPC wrapper and calls it', () => {
    expect(source).toMatch(/import\s*\{\s*fetchHistoryWalks\s*\}\s*from\s*'\.\.\/lib\/permissionedWalks'/);
    expect(source).toMatch(/fetchHistoryWalks\(\)/);
  });

  it('reads permissionOverrides AND permissionOverridesStatus from familyStore', () => {
    expect(source).toMatch(/const \{[\s\S]{0,300}permissionOverrides[\s\S]{0,10}permissionOverridesStatus[\s\S]{0,10}\} = useFamilyStore\(\)/);
  });

  it('holds fetchHistoryWalks()\'s resolved rows in state as the actual dataset, rather than discarding them as a bare allow/deny probe', () => {
    expect(source).toMatch(/const \[historyDataset, setHistoryDataset\] = useState<Walk\[\]>\(\[\]\)/);
    expect(source).toMatch(/const rows = await fetchHistoryWalks\(\);\s*\n\s*setHistoryDataset\(rows\);/);
  });

  it('every downstream computation reads from sourceWalks (historyDataset in Supabase mode), not the raw scheduleStore walks', () => {
    expect(source).toMatch(/const sourceWalks = isSupabaseConfigured \? historyDataset : walks;/);
    // The computed views this screen renders from are all keyed off
    // sourceWalks, not the raw `walks` destructured from useScheduleStore().
    expect(source).toMatch(/sourceWalks\.filter\(\(w\) => w\.date >= weekAgo/);
    expect(source).toMatch(/\[\.\.\.sourceWalks\]\s*\n\s*\.filter\(\(w\) => isWalkEligibleForHistory\(w\)\)/);
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

  it('refreshes the permissioned dataset on focus (useFocusEffect) and immediately after each of this screen\'s own mutations, rather than falling back to unrestricted raw access for reactivity', () => {
    expect(source).toMatch(/import\s*\{\s*useFocusEffect\s*\}\s*from\s*'@react-navigation\/native'/);
    expect(source).toMatch(/useFocusEffect\(\s*\n\s*useCallback\(\(\) => \{\s*\n\s*void refreshHistoryDataset\(\);/);
    // Each of this screen's own mutation handlers (skip, markDone,
    // editDoneDetails, editUnplannedWalk, deleteUnplannedWalk) refreshes the
    // dataset immediately after the mutation resolves.
    const refreshCount = (source.match(/await refreshHistoryDataset\(\);/g) ?? []).length;
    expect(refreshCount).toBeGreaterThanOrEqual(5);
  });

  it('renders a blocked state instead of the real content when EITHER the client gate or the server check denies access, BEFORE the main return', () => {
    const guardIdx = source.indexOf(
      '!canAccessHistoryScreen(effectiveUserId, permissionOverrides, permissionOverridesStatus) ||'
    );
    expect(guardIdx).toBeGreaterThan(-1);
    const mainReturnIdx = source.indexOf("<RtlText style={styles.header}");
    expect(mainReturnIdx).toBeGreaterThan(-1);
    expect(guardIdx).toBeLessThan(mainReturnIdx);
  });

  it('the server check defaults to blocking (\'checking\', not \'granted\') in Supabase mode, so an in-flight verification never transiently allows access', () => {
    expect(source).toMatch(/useState<'checking' \| 'granted' \| 'denied'>\(\s*isSupabaseConfigured \? 'checking' : 'granted'\s*\)/);
  });

  it('tracks whether access was ever granted, so a background refocus revalidation does not blank an already-authorized user\'s data', () => {
    expect(source).toMatch(/const hasEverGrantedRef = useRef\(false\);/);
    // Set on every path that lands 'granted' (local/demo mode + the
    // Supabase success path), and reset on the real 'denied' path — never
    // just left stale from a prior visit.
    expect(source).toMatch(/setHistoryAccessStatus\('granted'\);\s*\n\s*hasEverGrantedRef\.current = true;/);
    expect(source).toMatch(/setHistoryAccessStatus\('denied'\);\s*\n\s*hasEverGrantedRef\.current = false;/);
  });

  it('the access gate treats an in-flight refocus revalidation of an already-granted user as still-allowed, not as a fresh denial', () => {
    const guardIdx = source.indexOf(
      '!canAccessHistoryScreen(effectiveUserId, permissionOverrides, permissionOverridesStatus) ||'
    );
    expect(guardIdx).toBeGreaterThan(-1);
    const guardClauseEnd = source.indexOf(') {', guardIdx);
    const guardClause = source.slice(guardIdx, guardClauseEnd);
    expect(guardClause).toContain("historyAccessStatus !== 'granted'");
    expect(guardClause).toContain("historyAccessStatus === 'checking' && hasEverGrantedRef.current");
    const mainReturnIdx = source.indexOf('<RtlText style={styles.header}');
    expect(mainReturnIdx).toBeGreaterThan(guardClauseEnd);
  });

  it('"סיכום שבועי" (weekly summary) uses a 6-day-back cutoff, matching statistics.ts\'s filterWalksByPeriod() inclusive-of-today convention (start of day 6 ago through today = 7 calendar days) — not 7-day-back, which would silently widen it to an 8-day window', () => {
    expect(source).toMatch(/const weekAgo = useMemo\(\(\) => localDateOnly\(new Date\(Date\.now\(\) - 6 \* 86400000\)\), \[\]\);/);
  });
});
