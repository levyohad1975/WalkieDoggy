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
 * isn't in the local, operational-window-limited scheduleStore.walks (see
 * this file's own inline doc comment on lastWalkIsEditable for why that
 * would otherwise happen — every scheduleStore mutation looks the walk up
 * via `get().walks.find(id)` first and no-ops if it isn't found).
 *
 * BATCH 4 REVIEW CORRECTION #2 — the Batch 4 tree had regressed this file
 * to an EARLIER draft of the cross-family fix: a bare
 * `useState<Walk | null>(null)` plus a request-generation counter and a
 * "clear on family change" effect. That draft still allowed one render
 * where familyId already reads the NEW family but serverLastResolvedWalk
 * still holds the OLD family's row (the window between the family change
 * and the clearing effect actually running) — exactly the cross-family
 * stale-display bug the final Batch 3 correction was written to close.
 * This file now asserts the FINAL approved architecture instead: the
 * fetched row is stored together with the familyId it was fetched for
 * (`{ familyId, walk }`), and `lastWalk` refuses to read it back out
 * unless that stored familyId still equals the CURRENT familyId — so
 * there is no render, ever, where a mismatched family's row can be
 * displayed, regardless of effect timing. The request-generation counter
 * is kept as a COMPLEMENTARY guard (see below) rather than removed.
 */
describe('HomeScreen — last-walk card falls back to get_last_resolved_walk() when nothing resolved today (Supabase mode)', () => {
  const source = fs
    .readFileSync(path.resolve(__dirname, '../HomeScreen.tsx'), 'utf8')
    .replace(/\r\n/g, '\n');

  it('imports fetchLastResolvedWalk (the get_last_resolved_walk() RPC wrapper) and useRef (needed for the request-generation guard)', () => {
    expect(source).toMatch(/import\s*\{\s*fetchLastResolvedWalk\s*\}\s*from\s*'\.\.\/lib\/permissionedWalks'/);
    expect(source).toMatch(/import React, \{[^}]*\buseRef\b[^}]*\} from 'react';/);
  });

  it('holds the server result in state, scoped to the familyId it was fetched for, and refreshes it on every focus (useFocusEffect)', () => {
    expect(source).toMatch(
      /const \[serverLastResolvedWalk, setServerLastResolvedWalk\] = useState<\{\s*\n\s*familyId: string;\s*\n\s*walk: Walk \| null;\s*\n\s*\} \| null>\(null\);/
    );
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
    const familyGateIdx = block.indexOf(
      'if (!serverLastResolvedWalk || serverLastResolvedWalk.familyId !== familyId) return undefined;'
    );
    const serverFallbackIdx = block.indexOf('return serverLastResolvedWalk.walk ?? undefined;');
    expect(resolvedTodayIdx).toBeGreaterThan(-1);
    expect(ifReturnIdx).toBeGreaterThan(resolvedTodayIdx);
    expect(familyGateIdx).toBeGreaterThan(ifReturnIdx);
    expect(serverFallbackIdx).toBeGreaterThan(familyGateIdx);
  });

  it('gates edit/delete affordances on the walk actually being present in the local (operational-window) walks state — an older server-only walk stays read-only rather than silently no-opping', () => {
    expect(source).toMatch(
      /const lastWalkIsEditable = !isSupabaseConfigured \|\| \(!!lastWalk && walks\.some\(\(w\) => w\.id === lastWalk\.id\)\);/
    );
    expect(source).toMatch(/const canEditLastWalk =\s*\n\s*lastWalkIsEditable &&/);
  });

  it('local/demo mode is unaffected: lastWalkIsEditable is unconditionally true there, and lastWalk still falls back to plain computeLastWalk(walks) semantics', () => {
    expect(source).toMatch(/!isSupabaseConfigured \|\| \(!!lastWalk/);
    expect(source).toMatch(/if \(!isSupabaseConfigured\) return undefined;/);
  });

  describe('cross-family stale-state fix — FINAL architecture (Batch 4 Review Correction #2)', () => {
    it('serverLastResolvedWalk carries its own familyId — never a bare Walk | null', () => {
      expect(source).toMatch(/familyId: string;\s*\n\s*walk: Walk \| null;/);
    });

    it('lastWalk NEVER reads the server fallback unless the stored familyId matches the current familyId (the actual fix — a read-time gate, not just a write-time clear)', () => {
      expect(source).toMatch(
        /if \(!serverLastResolvedWalk \|\| serverLastResolvedWalk\.familyId !== familyId\) return undefined;/
      );
      expect(source).toMatch(/return serverLastResolvedWalk\.walk \?\? undefined;/);
    });

    it('the fetch stores the family it was actually issued for, captured before the await, not re-read from familyId afterward', () => {
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

    it('refreshServerLastResolvedWalk is dependency-scoped to familyId (so a stale closure never captures an old family in a long-lived callback)', () => {
      expect(source).toMatch(/const requestedFamilyId = familyId;/);
      expect(source).toMatch(/\}, \[familyId\]\);\s*\n\s*useFocusEffect\(/);
    });

    it('lastWalk\'s memo dependency array includes familyId (the fallback must be recomputed when the viewed family changes, not just when the fetch resolves)', () => {
      expect(source).toMatch(/\}, \[walks, serverLastResolvedWalk, familyId\]\);/);
    });

    it('declares a request-generation ref, initialized once per mount (not per family) — kept as a COMPLEMENTARY guard against out-of-order same-family responses (e.g. A → B → A), not the primary cross-family protection', () => {
      expect(source).toMatch(/const lastResolvedWalkRequestIdRef = useRef\(0\);/);
      const effectIdx = source.indexOf('useEffect(() => {\n    lastResolvedWalkRequestIdRef.current += 1;');
      expect(effectIdx).toBeGreaterThan(-1);
      const effectEnd = source.indexOf('}, [familyId]);', effectIdx);
      expect(effectEnd).toBeGreaterThan(effectIdx);
    });

    it('a delayed response — from an earlier family, or an out-of-order same-family response — cannot land: the request captures its own generation before awaiting, and both the success AND failure paths bail out if the generation has since moved on', () => {
      const fnIdx = source.indexOf('const refreshServerLastResolvedWalk = useCallback(async () => {');
      expect(fnIdx).toBeGreaterThan(-1);
      const fnEnd = source.indexOf('}, [familyId]);', fnIdx);
      expect(fnEnd).toBeGreaterThan(fnIdx);
      const fnBody = source.slice(fnIdx, fnEnd);

      const requestIdCaptureIdx = fnBody.indexOf('const requestId = lastResolvedWalkRequestIdRef.current;');
      const awaitIdx = fnBody.indexOf('const walk = await fetchLastResolvedWalk();');
      expect(requestIdCaptureIdx).toBeGreaterThan(-1);
      expect(awaitIdx).toBeGreaterThan(requestIdCaptureIdx);

      // Success path: the generation is re-checked AFTER the await, before
      // the fetched row is ever applied to state.
      const successGuardIdx = fnBody.indexOf('if (lastResolvedWalkRequestIdRef.current !== requestId) return;', awaitIdx);
      const setStateIdx = fnBody.indexOf('setServerLastResolvedWalk({ familyId: requestedFamilyId, walk });');
      expect(successGuardIdx).toBeGreaterThan(awaitIdx);
      expect(setStateIdx).toBeGreaterThan(successGuardIdx);

      // Failure path: the same generation re-check exists inside the catch
      // block too — a stale request's failure must also be a no-op.
      const catchIdx = fnBody.indexOf('catch (e) {');
      expect(catchIdx).toBeGreaterThan(-1);
      const catchGuardIdx = fnBody.indexOf('if (lastResolvedWalkRequestIdRef.current !== requestId) return;', catchIdx);
      expect(catchGuardIdx).toBeGreaterThan(catchIdx);
    });

    it('Family A\'s row can never be displayed while viewing Family B, even in the render immediately after switching — no clearing effect is required for correctness, because the read path itself (lastWalk\'s memo) refuses any stored row whose familyId isn\'t the current familyId', () => {
      // There is deliberately no `setServerLastResolvedWalk(null)` write-time
      // clear left in this file anymore — the old draft's bug was trusting a
      // write-time clear to run before the next render, which isn't
      // guaranteed. The fix instead makes the READ unconditionally safe.
      expect(source).not.toMatch(/setServerLastResolvedWalk\(null\)/);
      expect(source).toMatch(
        /if \(!serverLastResolvedWalk \|\| serverLastResolvedWalk\.familyId !== familyId\) return undefined;/
      );
    });
  });
});
