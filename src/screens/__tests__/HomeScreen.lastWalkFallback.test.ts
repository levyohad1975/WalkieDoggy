import fs from 'fs';
import path from 'path';

/**
 * BATCH 3 FINAL REVIEW CORRECTION, item 3 — same source-text-scan
 * convention as every other screen-level "test" in this repo (see
 * SettingsScreen.switchUserFlow.test.ts's doc comment: there is no React
 * Native component-rendering test infrastructure here).
 *
 * Proves HomeScreen's "last walk" card is restored to its pre-0027
 * fidelity in Supabase mode (can show a walk resolved before today) via
 * get_last_resolved_walk() (migration 0027) / fetchLastResolvedWalk()
 * (src/lib/permissionedWalks.ts), WITHOUT reopening bulk raw historical
 * access and WITHOUT letting edit/delete silently no-op on a walk that
 * isn't in the local, operational-window-limited scheduleStore.walks.
 *
 * BATCH 4 REVIEW CORRECTION #2 — the fetched row is stored together with
 * the familyId it was fetched for, and `lastWalk` refuses to read it back
 * unless that stored familyId still equals the CURRENT familyId. The
 * request-generation counter remains a complementary same-family guard.
 */
describe('HomeScreen — last-walk card falls back to get_last_resolved_walk() when nothing resolved today (Supabase mode)', () => {
  // Git may check this file out with CRLF on the Windows self-hosted runner.
  // Normalize only line endings so source-contract assertions are identical
  // on Windows and Linux; no application behavior is weakened or skipped.
  const source = fs.readFileSync(path.resolve(__dirname, '../HomeScreen.tsx'), 'utf8').replace(/\r\n/g, '\n');

  it('imports fetchLastResolvedWalk (the get_last_resolved_walk() RPC wrapper) and useRef (needed for the request-generation guard)', () => {
    expect(source).toMatch(/import\s*\{\s*fetchLastResolvedWalk\s*\}\s*from\s*'\.\.\/lib\/permissionedWalks'/);
    expect(source).toMatch(/import React, \{[^}]*\buseRef\b[^}]*\} from 'react';/);
  });

  it('holds the server result in state, scoped to the familyId it was fetched for, and refreshes it on every focus (useFocusEffect)', () => {
    expect(source).toMatch(/const \[serverLastResolvedWalk, setServerLastResolvedWalk\] = useState<\{\s*\n\s*familyId: string;\s*\n\s*walk: Walk \| null;\s*\n\s*\} \| null>\(null\);/);
    expect(source).toMatch(/const walk = await fetchLastResolvedWalk\(\);/);
    expect(source).toMatch(/useFocusEffect\(\s*\n\s*useCallback\(\(\) => \{\s*\n\s*void refreshServerLastResolvedWalk\(\);/);
  });

  it('prefers a walk resolved TODAY (computeLastWalk(walks)) over the server fallback, never the reverse', () => {
    const lastWalkIdx = source.indexOf('const lastWalk = useMemo(() => {');
    expect(lastWalkIdx).toBeGreaterThan(-1);
    const lastWalkBlockEnd = source.indexOf('}, [walks, serverLastResolvedWalk, familyId]);', lastWalkIdx);
    expect(lastWalkBlockEnd).toBeGreaterThan(lastWalkIdx);
    const block = source.slice(lastWalkIdx, lastWalkBlockEnd);
    const resolvedTodayIdx = block.indexOf('const resolvedToday = computeLastWalk(walks);');
    const ifReturnIdx = block.indexOf('if (resolvedToday) return resolvedToday;');
    const familyGateIdx = block.indexOf('if (!serverLastResolvedWalk || serverLastResolvedWalk.familyId !== familyId) return undefined;');
    const serverFallbackIdx = block.indexOf('return serverLastResolvedWalk.walk ?? undefined;');
    expect(resolvedTodayIdx).toBeGreaterThan(-1);
    expect(ifReturnIdx).toBeGreaterThan(resolvedTodayIdx);
    expect(familyGateIdx).toBeGreaterThan(ifReturnIdx);
    expect(serverFallbackIdx).toBeGreaterThan(familyGateIdx);
  });

  it('gates edit/delete affordances on the walk actually being present in the local walks state', () => {
    expect(source).toMatch(/const lastWalkIsEditable = !isSupabaseConfigured \|\| \(!!lastWalk && walks\.some\(\(w\) => w\.id === lastWalk\.id\)\);/);
    expect(source).toMatch(/const canEditLastWalk =\s*\n\s*lastWalkIsEditable &&/);
  });

  it('local/demo mode is unaffected', () => {
    expect(source).toMatch(/!isSupabaseConfigured \|\| \(!!lastWalk/);
    expect(source).toMatch(/if \(!isSupabaseConfigured\) return undefined;/);
  });

  describe('cross-family stale-state fix — FINAL architecture (Batch 4 Review Correction #2)', () => {
    it('serverLastResolvedWalk carries its own familyId — never a bare Walk | null', () => {
      expect(source).toMatch(/familyId: string;\s*\n\s*walk: Walk \| null;/);
    });

    it('lastWalk NEVER reads the server fallback unless the stored familyId matches the current familyId', () => {
      expect(source).toMatch(/if \(!serverLastResolvedWalk \|\| serverLastResolvedWalk\.familyId !== familyId\) return undefined;/);
      expect(source).toMatch(/return serverLastResolvedWalk\.walk \?\? undefined;/);
    });

    it('the fetch stores the family it was actually issued for, captured before the await', () => {
      const fnIdx = source.indexOf('const refreshServerLastResolvedWalk = useCallback(async () => {');
      expect(fnIdx).toBeGreaterThan(-1);
      const fnEnd = source.indexOf('}, [familyId]);', fnIdx);
      expect(fnEnd).toBeGreaterThan(fnIdx);
      const fnBody = source.slice(fnIdx, fnEnd);
      const captureIdx = fnBody.indexOf('const requestedFamilyId = familyId;');
      const awaitIdx = fnBody.indexOf('const walk = await fetchLastResolvedWalk();');
      const setStateIdx = fnBody.indexOf('setServerLastResolvedWalk({ familyId: requestedFamilyId, walk });');
      expect(captureIdx).toBeGreaterThan(-1);
      expect(awaitIdx).toBeGreaterThan(captureIdx);
      expect(setStateIdx).toBeGreaterThan(awaitIdx);
    });

    it('refreshServerLastResolvedWalk is dependency-scoped to familyId', () => {
      expect(source).toMatch(/const requestedFamilyId = familyId;/);
      expect(source).toMatch(/\}, \[familyId\]\);\s*\n\s*useFocusEffect\(/);
    });

    it("lastWalk's memo dependency array includes familyId", () => {
      expect(source).toMatch(/\}, \[walks, serverLastResolvedWalk, familyId\]\);/);
    });

    it('declares a request-generation ref, initialized once per mount, and bumps it on family change', () => {
      expect(source).toMatch(/const lastResolvedWalkRequestIdRef = useRef\(0\);/);
      const effectIdx = source.indexOf('useEffect(() => {\n    lastResolvedWalkRequestIdRef.current += 1;');
      expect(effectIdx).toBeGreaterThan(-1);
      const effectEnd = source.indexOf('}, [familyId]);', effectIdx);
      expect(effectEnd).toBeGreaterThan(effectIdx);
    });

    it('a delayed response cannot land after its request generation becomes stale', () => {
      const fnIdx = source.indexOf('const refreshServerLastResolvedWalk = useCallback(async () => {');
      expect(fnIdx).toBeGreaterThan(-1);
      const fnEnd = source.indexOf('}, [familyId]);', fnIdx);
      expect(fnEnd).toBeGreaterThan(fnIdx);
      const fnBody = source.slice(fnIdx, fnEnd);
      const requestIdCaptureIdx = fnBody.indexOf('const requestId = lastResolvedWalkRequestIdRef.current;');
      const awaitIdx = fnBody.indexOf('const walk = await fetchLastResolvedWalk();');
      expect(requestIdCaptureIdx).toBeGreaterThan(-1);
      expect(awaitIdx).toBeGreaterThan(requestIdCaptureIdx);
      const successGuardIdx = fnBody.indexOf('if (lastResolvedWalkRequestIdRef.current !== requestId) return;', awaitIdx);
      const setStateIdx = fnBody.indexOf('setServerLastResolvedWalk({ familyId: requestedFamilyId, walk });');
      expect(successGuardIdx).toBeGreaterThan(awaitIdx);
      expect(setStateIdx).toBeGreaterThan(successGuardIdx);
      const catchIdx = fnBody.indexOf('catch (e) {');
      expect(catchIdx).toBeGreaterThan(-1);
      const catchGuardIdx = fnBody.indexOf('if (lastResolvedWalkRequestIdRef.current !== requestId) return;', catchIdx);
      expect(catchGuardIdx).toBeGreaterThan(catchIdx);
    });

    it("Family A's row can never be displayed while viewing Family B", () => {
      expect(source).not.toMatch(/setServerLastResolvedWalk\(null\)/);
      expect(source).toMatch(/if \(!serverLastResolvedWalk \|\| serverLastResolvedWalk\.familyId !== familyId\) return undefined;/);
    });
  });
});
