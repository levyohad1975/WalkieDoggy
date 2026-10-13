import fs from 'fs';
import path from 'path';

/**
 * Source-text-scan test (this repo has no live Postgres to run migrations
 * against in this sandbox — same convention as migration0037-0042/0049-0052)
 * for the P0 real-device QA bug: pressing "הצטרפות" (Join) after a
 * successfully-inspected invite always failed client-side verification,
 * even though redeem_family_invite() itself raised no exception.
 *
 * Root cause: real_current_profile_id() has resolved EXCLUSIVELY from
 * profile_auth_sessions since migration 0020 (never from users.auth_user_id
 * directly), but redeem_family_invite() (0008, pgcrypto-qualified in 0009)
 * predates 0020 and was never updated to write that table — every
 * redemption since 0020 shipped succeeded server-side while leaving the
 * claim permanently invisible to whoami()/current_profile_id()/every RLS
 * policy and RPC authorization check that resolves through it.
 *
 * See migration 0101's own header comment for the full analysis; these
 * tests assert the fix is actually present in the migration file, and that
 * it does not edit any already-applied migration.
 */
describe('migration 0101 — redeem_family_invite() writes profile_auth_sessions; whoami() self-heals and exposes family_id', () => {
  const migrationsDir = path.resolve(__dirname, '../../../supabase/migrations');
  const source = fs
    .readFileSync(path.join(migrationsDir, '0101_fix_redeem_invite_profile_session.sql'), 'utf8')
    .replace(/\r\n/g, '\n');

  it('does not edit any already-applied migration file — only adds a new one', () => {
    const files = fs.readdirSync(migrationsDir).filter((f) => f.endsWith('.sql'));
    for (const mustExist of [
      '0008_family_invites.sql',
      '0009_family_invites_pgcrypto_fix.sql',
      '0020_multi_device_profile_sessions.sql',
      '0044_system_admin_hidden_observer.sql',
      '0100_reset_generated_schedule_entries.sql',
    ]) {
      expect(files).toContain(mustExist);
    }
    expect(files.filter((f) => f.startsWith('0101_'))).toHaveLength(1);
  });

  it('redeem_family_invite() now upserts profile_auth_sessions, mirroring claim_family_profile()\'s own insert shape', () => {
    expect(source).toMatch(
      /insert into profile_auth_sessions \(auth_user_id, family_id, user_id, updated_at\)\s*\n\s*values \(auth\.uid\(\), inv\.family_id, inv\.target_user_id, now\(\)\)/
    );
  });

  it('the profile_auth_sessions write is guarded by a fail-closed collision check before it runs', () => {
    const insertIdx = source.indexOf('insert into profile_auth_sessions (auth_user_id, family_id, user_id, updated_at)\n  values (auth.uid(), inv.family_id, inv.target_user_id, now())');
    const guardIdx = source.indexOf('select 1 from profile_auth_sessions');
    expect(guardIdx).toBeGreaterThan(-1);
    expect(insertIdx).toBeGreaterThan(guardIdx);
    expect(source).toMatch(/where user_id = inv\.target_user_id\s*\n\s*and auth_user_id <> auth\.uid\(\)/);
  });

  it('the profile_auth_sessions write happens AFTER the existing users.auth_user_id guarded claim succeeds (v_updated_count check), not before', () => {
    const claimCheckIdx = source.indexOf('if v_updated_count = 0 then');
    const sessionInsertIdx = source.indexOf('insert into profile_auth_sessions (auth_user_id, family_id, user_id, updated_at)\n  values (auth.uid(), inv.family_id, inv.target_user_id, now())');
    expect(claimCheckIdx).toBeGreaterThan(-1);
    expect(sessionInsertIdx).toBeGreaterThan(claimCheckIdx);
  });

  it('every pre-existing authorization guard in redeem_family_invite() is still present, byte-for-byte, unweakened', () => {
    for (const guard of [
      "raise exception 'invite not found';",
      "raise exception 'invite was revoked';",
      "raise exception 'invite already used';",
      "raise exception 'invite expired';",
      "raise exception 'target profile is not available for this invite';",
      "raise exception 'account already belongs to a different family';",
      "raise exception 'account already has a claimed profile';",
    ]) {
      expect(source).toContain(guard);
    }
  });

  it('whoami() is dropped before being recreated (its return signature changed — added family_id)', () => {
    expect(source).toMatch(/drop function if exists whoami\(\);/);
    expect(source).toMatch(/family_id uuid,\s*\n\s*family_role text,/);
  });

  it('whoami() self-heals a dangling pre-0101 claim: backfills profile_auth_sessions from users.auth_user_id when no session row exists yet', () => {
    expect(source).toMatch(/not exists \(\s*\n\s*select 1 from profile_auth_sessions where auth_user_id = auth\.uid\(\)\s*\n\s*\)/);
    expect(source).toMatch(/from users u\s*\n\s*where u\.auth_user_id = auth\.uid\(\)/);
    expect(source).toMatch(/on conflict \(auth_user_id\) do nothing;/);
  });

  it('whoami() is volatile now (it writes), not stable — the self-heal insert requires this', () => {
    const whoamiStart = source.indexOf('create or replace function whoami()');
    const whoamiEnd = source.indexOf('redeem_family_invite(p_token text)', whoamiStart);
    const whoamiBody = source.slice(whoamiStart, whoamiEnd);
    expect(whoamiBody).toMatch(/\$\$ language plpgsql volatile security definer/);
  });

  it('whoami() still returns every pre-existing column, in addition to the new family_id', () => {
    const whoamiStart = source.indexOf('create or replace function whoami()');
    const whoamiEnd = source.indexOf('redeem_family_invite(p_token text)', whoamiStart);
    const whoamiBody = source.slice(whoamiStart, whoamiEnd);
    for (const col of ['profile_id uuid', 'real_profile_id uuid', 'family_role text', 'is_impersonating boolean', 'impersonated_user_id uuid']) {
      expect(whoamiBody).toContain(col);
    }
  });
});
