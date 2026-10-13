import fs from 'fs';
import path from 'path';

/**
 * Source-text-scan test (no live Postgres in this sandbox — same convention
 * as migration0037/.../0051). Locks in the properties that matter most for
 * Phase 5 kickoff (Gamification, PRD §9): the per-user off-switch, an
 * immutable unlock ledger (dedupe-by-construction, no client DELETE — same
 * posture as dogs (0042)/health_tasks (0049)/walk_gps_sessions (0051)), and
 * that 0016's protected-column REVOKE for users is left untouched.
 */
describe('migration 0052 — gamification off-switch + achievement_unlocks: dedupe-by-construction, no client DELETE', () => {
  const migrationsDir = path.resolve(__dirname, '../../../supabase/migrations');
  const source = fs
    .readFileSync(path.join(migrationsDir, '0052_gamification_achievements.sql'), 'utf8')
    .replace(/\r\n/g, '\n');

  it('does not edit any already-applied migration file (0001-0051) — only adds a new one', () => {
    const files = fs.readdirSync(migrationsDir).filter((f) => f.endsWith('.sql'));
    for (const mustExist of ['0050_health_task_recurrence.sql', '0051_walk_gps_sessions.sql']) {
      expect(files).toContain(mustExist);
    }
    expect(files.filter((f) => f.startsWith('0052_'))).toHaveLength(1);
  });

  it('adds a per-user gamification_enabled off-switch, additive to (never replacing) 0016\'s users column-privilege grant', () => {
    expect(source).toMatch(/alter table users add column if not exists gamification_enabled boolean not null default true;/);
    expect(source).toMatch(/grant update \(gamification_enabled\) on public\.users to authenticated;/);
    // Never re-issues a blanket revoke/grant on users — that would be
    // editing 0016's own protected-column posture, not adding to it.
    expect(source).not.toMatch(/revoke update on public\.users/);
    expect(source).not.toMatch(/grant update \([^)]*role[^)]*\)/);
  });

  it('achievement_unlocks: a personal unlock must name a user, a family unlock must not (never neither, never both)', () => {
    expect(source).toMatch(/scope text not null check \(scope in \('personal', 'family'\)\)/);
    expect(source).toMatch(
      /constraint achievement_unlocks_scope_user check \(\s*\(scope = 'personal' and user_id is not null\) or \(scope = 'family' and user_id is null\)\s*\)/
    );
  });

  it('dedupe is enforced by a DB constraint (a generated column + unique), not left to client-side care', () => {
    expect(source).toMatch(
      /dedupe_key text generated always as \(achievement_key \|\| ':' \|\| coalesce\(user_id::text, ''\)\) stored/
    );
    expect(source).toMatch(/unique \(family_id, dedupe_key\)/);
  });

  it('family_id is NOT NULL — every unlock is attributed to a specific family', () => {
    expect(source).toMatch(/family_id uuid not null references families\(id\) on delete cascade/);
  });

  it('enables RLS and isolates every policy to current_family_id()', () => {
    expect(source).toContain('alter table achievement_unlocks enable row level security;');
    const policyMatches = [...source.matchAll(/create policy "[^"]+" on achievement_unlocks\n\s+for (\w+)[^;]*/g)];
    expect(policyMatches.length).toBeGreaterThanOrEqual(2);
    for (const match of policyMatches) {
      expect(match[0]).toContain('family_id = current_family_id()');
    }
  });

  it('never creates a DELETE or UPDATE policy on achievement_unlocks — an immutable ledger, matching dogs/health_tasks/walk_gps_sessions', () => {
    expect(source).not.toMatch(/on achievement_unlocks\s*\n\s*for\s+delete/i);
    expect(source).not.toMatch(/on achievement_unlocks\s*\n\s*for\s+update/i);
  });

  it('never grants a broader "for all" policy that would fold DELETE/UPDATE back in', () => {
    expect(source).not.toMatch(/create policy[^;]*on achievement_unlocks[^;]*for all/i);
  });
});
