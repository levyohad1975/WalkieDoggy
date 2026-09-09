import fs from 'fs';
import path from 'path';

/**
 * BATCH 3 CORRECTION #1/#2 (post-review, then review #2) — this repo has no
 * live Postgres to run migrations against in this sandbox (see this
 * batch's own report), so — same convention as every screen/navigation
 * "test" in this codebase (source-text-scan; see
 * SettingsScreen.switchUserFlow.test.ts's doc comment for the precedent)
 * — this file scans migration 0027's own SQL text for the specific
 * security properties the review asked for. This is a proxy for what a
 * real integration test against a live Supabase project would verify
 * end-to-end — it catches a missing check, a typo'd function name, or a
 * predicate that references the wrong thing, not a logic bug the SQL's own
 * text can't reveal. Flagged as such in this batch's own report. The
 * BEHAVIORAL side of what this SQL is supposed to do (the permission
 * matrix, the fail-closed unknown-key rule) is additionally covered, as a
 * clearly-labeled simulation, by historyStatisticsPermissionMatrix.test.ts
 * in this same directory.
 *
 * CORRECTED (review #2): re-scans for the CORRECTED model —
 *   (a) has_member_permission() validates the key FIRST via an explicit
 *       per-key `case`, with NO generic "no row -> true" fallback and NO
 *       default case that returns true — an unknown key now returns false
 *       immediately, before ever touching member_permission_overrides.
 *   (b) the walks SELECT policy no longer references has_member_permission
 *       at all — it is a permission-INDEPENDENT operational window
 *       (pending, or today, or admin). The two permissions can no longer
 *       unlock each other's data through the raw table.
 *
 * CORRECTED AGAIN (final review correction): re-scans for two further
 * fixes —
 *   (c) the operational window's "today" boundary is now
 *       current_family_local_date() (family-timezone-aware, via
 *       families.timezone from 0022), not the bare database-session
 *       `current_date` review #2 used.
 *   (d) get_last_resolved_walk() — a new, narrow, single-row RPC that
 *       restores HomeScreen's last-walk fidelity without widening the
 *       operational-window policy itself.
 */
describe('migration 0027 — server-side History/Statistics permission enforcement', () => {
  const migrationsDir = path.resolve(__dirname, '../../../supabase/migrations');
  const source = fs.readFileSync(path.join(migrationsDir, '0027_history_statistics_server_enforcement.sql'), 'utf8');

  it('does not touch any already-deployed migration file (0001-0026) — only corrects this new, not-yet-deployed one in place', () => {
    const files = fs.readdirSync(migrationsDir).filter((f) => f.endsWith('.sql'));
    expect(files).toContain('0027_history_statistics_server_enforcement.sql');
    for (const mustExist of ['0022_family_timezone_and_dog_sex.sql', '0023_member_permission_overrides.sql', '0024_system_admin_foundation.sql', '0025_walk_reminder_scheduler.sql', '0026_admin_reschedule_walk.sql']) {
      expect(files).toContain(mustExist);
    }
    // There is exactly one 0027 file — the correction replaced it in place
    // rather than adding a 0028 (explicitly permitted since 0027 was never
    // deployed).
    expect(files.filter((f) => f.startsWith('0027_'))).toHaveLength(1);
    // Batch 4 legitimately introduces migrations 0028 and later.
  });

  describe('has_member_permission() — fail-closed for unknown keys (review #2)', () => {
    const fnStart = source.indexOf('create or replace function has_member_permission(p_permission_key text)');
    const fnEnd = source.indexOf('$$ language plpgsql', fnStart);
    const fnBody = source.slice(fnStart, fnEnd);

    it('validates the key via an explicit per-key case, not a generic fallback', () => {
      expect(fnBody).toMatch(/case p_permission_key/);
      expect(fnBody).toMatch(/when 'view_history' then v_role_default := true;/);
      expect(fnBody).toMatch(/when 'view_statistics' then v_role_default := true;/);
    });

    it('an unknown key returns false immediately, in the else branch, BEFORE current_profile_id()/member_permission_overrides are ever consulted', () => {
      const elseIdx = fnBody.indexOf('else');
      const returnFalseIdx = fnBody.indexOf('return false;', elseIdx);
      const endCaseIdx = fnBody.indexOf('end case;');
      expect(elseIdx).toBeGreaterThan(-1);
      expect(returnFalseIdx).toBeGreaterThan(elseIdx);
      expect(returnFalseIdx).toBeLessThan(endCaseIdx);
      // The case statement (and its unknown-key `return false`) appears
      // BEFORE the profile lookup and the override-row lookup.
      const meAssignIdx = fnBody.indexOf('me := current_profile_id();');
      const overrideLookupIdx = fnBody.indexOf('from member_permission_overrides');
      expect(endCaseIdx).toBeLessThan(meAssignIdx);
      expect(endCaseIdx).toBeLessThan(overrideLookupIdx);
    });

    it('there is no default/generic branch that returns true for an unrecognized key anywhere in this function', () => {
      // The only unconditional `return true` in this whole function must be
      // the "no override row -> that key's own v_role_default" line, which
      // is only reachable for a key that already passed the case statement
      // above (i.e. already known) — not a bare `return true` sitting in
      // the unknown-key branch.
      const bareReturnTrueCount = (fnBody.match(/\breturn true;/g) ?? []).length;
      expect(bareReturnTrueCount).toBe(0);
      expect(fnBody).toMatch(/if v_allowed is null then\s*\n\s*return v_role_default;/);
    });

    it('no active profile (current_profile_id() is null) still fails closed for a KNOWN key', () => {
      expect(fnBody).toMatch(/if me is null then\s*\n\s*return false;/);
    });

    it('an explicit override row for the caller still wins over the role default for a known key', () => {
      expect(fnBody).toMatch(/where user_id = me and permission_key = p_permission_key;/);
      expect(fnBody).toMatch(/return v_allowed;/);
    });
  });

  describe('the walks SELECT policy is a permission-INDEPENDENT operational window (review #2)', () => {
    const policyStart = source.indexOf('create policy "select walks in own family" on walks');
    const policyEnd = source.indexOf(');', policyStart);
    const policyBody = source.slice(policyStart, policyEnd);

    it('drops and recreates the policy 0005 originally defined, rather than editing 0005', () => {
      expect(source).toMatch(/drop policy if exists "select walks in own family" on walks;/);
      expect(source).toMatch(/create policy "select walks in own family" on walks/);
    });

    it('family isolation is preserved as the outer condition, never widened', () => {
      expect(policyBody).toMatch(/family_id = current_family_id\(\)\s*\n\s*and \(/);
    });

    it('does NOT reference has_member_permission at all — neither permission can unlock the other or its own data through the raw table anymore', () => {
      expect(policyBody).not.toMatch(/has_member_permission/);
    });

    it('grants exactly the operational window: admin, pending (any date), or resolved TODAY IN THE FAMILY\'S OWN TIMEZONE — nothing wider', () => {
      expect(policyBody).toMatch(/is_family_admin\(family_id\)/);
      expect(policyBody).toMatch(/status = 'pending'/);
      // FINAL REVIEW CORRECTION: family-timezone-aware, not the bare
      // database-session current_date review #2 used.
      expect(policyBody).toMatch(/date = current_family_local_date\(\)/);
      expect(policyBody).not.toMatch(/date = current_date\b/);
      // Explicitly NOT a multi-day buffer this time.
      expect(policyBody).not.toMatch(/interval '2 days'/);
      expect(policyBody).not.toMatch(/interval/);
    });
  });

  describe('current_family_local_date() — family-timezone-aware operational date (final review correction)', () => {
    const fnStart = source.indexOf('create or replace function current_family_local_date()');
    const fnEnd = source.indexOf('$$ language sql', fnStart);
    const fnBody = source.slice(fnStart, fnEnd);

    it('exists and is defined before the walks policy that uses it', () => {
      expect(fnStart).toBeGreaterThan(-1);
      const policyIdx = source.indexOf('create policy "select walks in own family" on walks');
      expect(fnStart).toBeLessThan(policyIdx);
    });

    it('derives the timezone from families.timezone (0022) for the CALLER\'s own family only, via current_family_id() — never a client-supplied parameter', () => {
      expect(fnBody).toMatch(/from families f\s*\n\s*where f\.id = current_family_id\(\)/);
      // No parameter list at all.
      expect(source.slice(fnStart, source.indexOf('\n', fnStart))).toMatch(/current_family_local_date\(\)\s*$/);
    });

    it('converts via Postgres\'s own IANA-backed "at time zone" operator (DST-safe) — no hardcoded zone anywhere in this function', () => {
      expect(fnBody).toMatch(/now\(\) at time zone f\.timezone/);
      expect(fnBody).not.toMatch(/Asia\/Jerusalem/);
      expect(fnBody).not.toMatch(/'UTC'/);
    });

    it('is SECURITY DEFINER, matching the convention for the other family-scoping helpers in this schema', () => {
      const fnEndWithLanguage = source.indexOf('$$ language sql', fnStart);
      expect(source.slice(fnStart, fnEndWithLanguage + 100)).toMatch(/security definer/);
    });
  });

  describe('list_history_walks() / list_statistics_walks() — each gates on its OWN key only, independent of the other', () => {
    it('list_history_walks() checks view_history and never mentions view_statistics anywhere in its body', () => {
      const fnStart = source.indexOf('create or replace function list_history_walks()');
      const fnEnd = source.indexOf('$$ language plpgsql', fnStart);
      const fnBody = source.slice(fnStart, fnEnd);
      expect(fnBody).toMatch(/if not has_member_permission\('view_history'\) then\s*\n\s*raise exception 'view_history permission required';/);
      expect(fnBody).not.toMatch(/view_statistics/);
      expect(fnBody).toMatch(/return query select \* from walks where family_id = current_family_id\(\);/);
    });

    it('list_statistics_walks() checks view_statistics and never mentions view_history anywhere in its body', () => {
      const fnStart = source.indexOf('create or replace function list_statistics_walks()');
      const fnEnd = source.indexOf('$$ language plpgsql', fnStart);
      const fnBody = source.slice(fnStart, fnEnd);
      expect(fnBody).toMatch(/if not has_member_permission\('view_statistics'\) then\s*\n\s*raise exception 'view_statistics permission required';/);
      expect(fnBody).not.toMatch(/view_history/);
    });

    it('both require an active family/profile (current_family_id() non-null) before even checking the permission', () => {
      const historyFnStart = source.indexOf('create or replace function list_history_walks()');
      const historyFnEnd = source.indexOf('$$ language plpgsql', historyFnStart);
      expect(source.slice(historyFnStart, historyFnEnd)).toMatch(/if current_family_id\(\) is null then/);

      const statsFnStart = source.indexOf('create or replace function list_statistics_walks()');
      const statsFnEnd = source.indexOf('$$ language plpgsql', statsFnStart);
      expect(source.slice(statsFnStart, statsFnEnd)).toMatch(/if current_family_id\(\) is null then/);
    });

    it('both are SECURITY DEFINER', () => {
      const historyFnIdx = source.indexOf('create or replace function list_history_walks()');
      const historyFnEnd = source.indexOf('$$ language', historyFnIdx);
      expect(source.slice(historyFnIdx, historyFnEnd + 200)).toMatch(/security definer/);

      const statsFnIdx = source.indexOf('create or replace function list_statistics_walks()');
      const statsFnEnd = source.indexOf('$$ language', statsFnIdx);
      expect(source.slice(statsFnIdx, statsFnEnd + 200)).toMatch(/security definer/);
    });

    it('both have the tightened grant convention (revoke from public, grant to authenticated only)', () => {
      expect(source).toMatch(/revoke all on function list_history_walks\(\) from public;\s*\ngrant execute on function list_history_walks\(\) to authenticated;/);
      expect(source).toMatch(/revoke all on function list_statistics_walks\(\) from public;\s*\ngrant execute on function list_statistics_walks\(\) to authenticated;/);
    });

    it('neither re-scopes by a client-supplied family id — both derive it solely from current_family_id()', () => {
      const historyFnStart = source.indexOf('create or replace function list_history_walks()');
      const historyFnEnd = source.indexOf('$$ language plpgsql', historyFnStart);
      const historyFnBody = source.slice(historyFnStart, historyFnEnd);
      expect(historyFnBody).not.toMatch(/p_family_id/);
      expect(historyFnBody).toMatch(/\(\)\s*\nreturns setof walks/); // no parameters at all
    });
  });

  it('has_member_permission() itself is left at the default PUBLIC grant (no revoke/grant lines for it) — matching the established convention for internal helpers like is_family_admin()/current_family_id()', () => {
    const helperIdx = source.indexOf('create or replace function has_member_permission');
    const nextSectionIdx = source.indexOf('-- 2.', helperIdx);
    const helperSection = source.slice(helperIdx, nextSectionIdx);
    expect(helperSection).not.toMatch(/revoke all on function has_member_permission/);
    expect(helperSection).not.toMatch(/grant execute on function has_member_permission/);
  });

  describe('get_last_resolved_walk() — final review correction, item 3 (restores HomeScreen last-walk fidelity)', () => {
    const fnStart = source.indexOf('create or replace function get_last_resolved_walk()');
    const fnEnd = source.indexOf('$$ language plpgsql', fnStart);
    const fnBody = source.slice(fnStart, fnEnd);

    it('exists, takes no parameters, and returns setof walks', () => {
      expect(fnStart).toBeGreaterThan(-1);
      expect(source.slice(fnStart, fnStart + 200)).toMatch(/get_last_resolved_walk\(\)\s*\nreturns setof walks/);
    });

    it('is family-scoped via current_family_id() only — never a client-supplied family id', () => {
      expect(fnBody).toMatch(/v_family_id := current_family_id\(\);/);
      expect(fnBody).toMatch(/where w\.family_id = v_family_id/);
      expect(fnBody).not.toMatch(/p_family_id/);
    });

    it('fails closed (returns zero rows, not an error) when there is no active family/profile', () => {
      expect(fnBody).toMatch(/if v_family_id is null then\s*\n\s*return;/);
    });

    it('only considers resolved (done/skipped) walks, never pending, and never a still-future "finished" instant', () => {
      expect(fnBody).toMatch(/and w\.status in \('done', 'skipped'\)/);
      expect(fnBody).toMatch(/<= now\(\)/);
    });

    it('mirrors computeLastWalk()\'s own selection rule: completed_at when set, else the walk\'s own scheduled date+time in the family\'s timezone — most recent first, exactly one row', () => {
      expect(fnBody).toMatch(/coalesce\(\s*\n\s*w\.completed_at,\s*\n\s*\(\(w\.date::text \|\| ' ' \|\| w\.scheduled_time \|\| ':00'\)::timestamp at time zone f\.timezone\)\s*\n\s*\)/);
      expect(fnBody).toMatch(/order by coalesce\(/);
      expect(fnBody).toMatch(/desc\s*\n\s*limit 1;/);
    });

    it('is deliberately NOT gated by has_member_permission() — every family member may call it, since this is one operational-status row, not bulk/searchable history', () => {
      expect(fnBody).not.toMatch(/has_member_permission/);
    });

    it('is SECURITY DEFINER (needed to see past the operational-window policy) with the tightened grant convention', () => {
      const fnEndWithLanguage = source.indexOf('$$ language plpgsql', fnStart);
      expect(source.slice(fnStart, fnEndWithLanguage + 100)).toMatch(/security definer/);
      expect(source).toMatch(/revoke all on function get_last_resolved_walk\(\) from public;\s*\ngrant execute on function get_last_resolved_walk\(\) to authenticated;/);
    });
  });
});


