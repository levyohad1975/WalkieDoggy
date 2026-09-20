import fs from 'fs';
import path from 'path';

/**
 * Source-text-scan test (this repo has no live Postgres to run migrations
 * against in this sandbox -- same convention as migration0036/0037/0038/0039)
 * for a real, first-time-discovered security/data-integrity bug: neither
 * join_family() (0002/0003/0033) nor redeem_family_invite()'s (0008/0009)
 * own "account already belongs to a different family" collision guard
 * actually caught a caller whose real family_auth_members membership was in
 * a still-pending or already-rejected family. redeem_family_invite()'s guard
 * resolved the caller's existing family via current_family_id(), which
 * (since 0033) only resolves families with approval_status = 'active' -- so
 * for a pending/rejected member it silently read null and never fired.
 * join_family() never had an equivalent guard at all. Since
 * family_auth_members.auth_user_id is the primary key (one row per auth
 * identity), both functions' `on conflict (auth_user_id) do update set
 * family_id = excluded.family_id` silently overwrote the caller's real
 * membership, permanently orphaning whatever family they actually belonged
 * to (e.g. a verified admin's own just-created, still-pending family) with
 * no confirmation, warning, or audit trail -- reachable via
 * FamilyOnboardingScreen.tsx's pending/rejected "חזרה" button, which returns
 * to the plain choose screen and its join flow. 0040 closes this by
 * resolving the caller's existing membership directly against
 * family_auth_members in both functions, never through current_family_id().
 */
describe('migration 0040 — prevents cross-family family_auth_members overwrite for a pending/rejected member', () => {
  const migrationsDir = path.resolve(__dirname, '../../../supabase/migrations');
  const source = fs
    .readFileSync(
      path.join(migrationsDir, '0040_prevent_cross_family_membership_overwrite.sql'),
      'utf8'
    )
    .replace(/\r\n/g, '\n');

  it('does not edit any already-applied migration file (0001-0039) -- only adds a new one', () => {
    const files = fs.readdirSync(migrationsDir).filter((f) => f.endsWith('.sql'));
    for (const mustExist of [
      '0002_invite_codes_and_family_membership.sql',
      '0009_family_invites_pgcrypto_fix.sql',
      '0033_verified_family_onboarding_cutover.sql',
      '0039_clear_family_auth_membership_on_member_removal.sql',
    ]) {
      expect(files).toContain(mustExist);
    }
    expect(files.filter((f) => f.startsWith('0040_'))).toHaveLength(1);
  });

  it('preserves the join_family(text) and redeem_family_invite(p_token text) signatures (CREATE OR REPLACE, no DROP)', () => {
    expect(source).toContain('create or replace function join_family(code text)');
    expect(source).toContain('create or replace function redeem_family_invite(p_token text)');
    expect(source).not.toMatch(/drop function\s+join_family/i);
    expect(source).not.toMatch(/drop function\s+redeem_family_invite/i);
  });

  it('join_family() rejects a caller whose existing family_auth_members row points at a different family, resolved directly (not via current_family_id())', () => {
    const fnStart = source.indexOf('create or replace function join_family(code text)');
    const fnEnd = source.indexOf('create or replace function redeem_family_invite');
    expect(fnStart).toBeGreaterThan(-1);
    expect(fnEnd).toBeGreaterThan(fnStart);
    const body = source.slice(fnStart, fnEnd);

    expect(body).toContain(
      'select family_id into v_caller_family\n  from family_auth_members\n  where auth_user_id = auth.uid();'
    );
    expect(body).not.toContain('v_caller_family := current_family_id()');
    expect(body).toContain(
      "if v_caller_family is not null and v_caller_family is distinct from v_family_id then\n    raise exception 'account already belongs to a different family';"
    );

    const guardIdx = body.indexOf("raise exception 'account already belongs to a different family'");
    const insertIdx = body.indexOf('insert into family_auth_members');
    expect(guardIdx).toBeGreaterThan(-1);
    expect(insertIdx).toBeGreaterThan(guardIdx);
  });

  it('redeem_family_invite() resolves the caller\'s existing membership directly against family_auth_members instead of current_family_id()', () => {
    const fnStart = source.indexOf('create or replace function redeem_family_invite');
    expect(fnStart).toBeGreaterThan(-1);
    const body = source.slice(fnStart);

    expect(body).not.toContain('v_caller_family := current_family_id()');
    expect(body).toContain(
      'select family_id into v_caller_family\n  from family_auth_members\n  where auth_user_id = auth.uid();'
    );
    expect(body).toContain(
      "if v_caller_family is not null and v_caller_family is distinct from inv.family_id then\n    raise exception 'account already belongs to a different family';"
    );
  });

  it('preserves every other pre-existing guard in redeem_family_invite() unchanged', () => {
    expect(source).toContain("raise exception 'must be authenticated';");
    expect(source).toContain("raise exception 'invite not found';");
    expect(source).toContain("raise exception 'invite was revoked';");
    expect(source).toContain("raise exception 'invite already used';");
    expect(source).toContain("raise exception 'invite expired';");
    expect(source).toContain("raise exception 'target profile is not available for this invite';");
    expect(source).toContain("raise exception 'account already has a claimed profile';");
  });

  it('preserves join_family()\'s existing "keep admin if already admin of the same family" upsert shape', () => {
    expect(source).toContain(
      "role = case\n      when family_auth_members.family_id = excluded.family_id\n       and family_auth_members.role = 'admin'\n      then 'admin' else 'member' end;"
    );
  });
});
