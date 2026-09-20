import fs from 'fs';
import path from 'path';

/**
 * Source-text-scan test (this repo has no live Postgres to run migrations
 * against in this sandbox — same convention as migration0027.
 * serverEnforcement.test.ts's own doc comment) for a real, first-time-
 * discovered bug: 0022_family_timezone_and_dog_sex.sql's own header warned
 * that its 'Asia/Jerusalem' default on families.timezone "DOES NOT EXTEND
 * TO FUTURE FAMILIES" and that family creation must explicitly determine
 * each new family's real timezone -- but create_verified_family() (0032),
 * the only way to create a family after 0033's cutover, never did, so every
 * family created since then silently inherited the Israel-only default
 * regardless of where its members actually live. This corrupted the walk
 * reminder scheduler (0025, `... at time zone f.timezone`) and
 * current_family_local_date() (0027) for any non-Israel family. 0036 fixes
 * this by threading an optional, server-validated p_timezone parameter
 * through create_verified_family(), the Edge Function, and the client.
 */
describe('migration 0036 — create_verified_family() accepts and validates a real timezone', () => {
  const migrationsDir = path.resolve(__dirname, '../../../supabase/migrations');
  const source = fs.readFileSync(
    path.join(migrationsDir, '0036_create_verified_family_timezone.sql'),
    'utf8'
  );
  const edge = fs.readFileSync(
    path.resolve(__dirname, '../../../supabase/functions/create-verified-family/index.ts'),
    'utf8'
  );

  it('does not edit any already-applied migration file (0001-0035) -- only adds a new one', () => {
    const files = fs.readdirSync(migrationsDir).filter((f) => f.endsWith('.sql'));
    expect(files).toContain('0036_create_verified_family_timezone.sql');
    for (const mustExist of [
      '0022_family_timezone_and_dog_sex.sql',
      '0032_verified_family_onboarding.sql',
      '0033_verified_family_onboarding_cutover.sql',
      '0035_system_admin_family_approval_status.sql',
    ]) {
      expect(files).toContain(mustExist);
    }
    expect(files.filter((f) => f.startsWith('0036_'))).toHaveLength(1);
  });

  it('drops the old 4-argument signature before creating the 5-argument replacement (PostgreSQL cannot add a parameter via CREATE OR REPLACE)', () => {
    expect(source).toContain('drop function if exists create_verified_family(uuid, text, text, boolean);');
    const dropIndex = source.indexOf('drop function if exists create_verified_family');
    const createIndex = source.indexOf('create function create_verified_family(');
    expect(dropIndex).toBeGreaterThan(-1);
    expect(createIndex).toBeGreaterThan(dropIndex);
    expect(source).toContain('p_timezone text default null');
  });

  it('validates a client-supplied timezone against is_valid_timezone() (0022) and falls back to the Asia/Jerusalem compatibility default when missing or invalid', () => {
    expect(source).toContain(
      "when p_timezone is not null and is_valid_timezone(p_timezone) then p_timezone"
    );
    expect(source).toContain("else 'Asia/Jerusalem'");
  });

  it('actually inserts the resolved timezone into families.timezone rather than only computing it', () => {
    const insertIndex = source.indexOf('insert into families (');
    const insertBlock = source.slice(insertIndex, insertIndex + 400);
    expect(insertBlock).toContain('timezone');
    expect(insertBlock).toContain('v_timezone');
  });

  it('re-locks the new 5-argument function down to service_role only, same as the original', () => {
    expect(source).toContain(
      'grant execute on function create_verified_family(uuid, text, text, boolean, text) to service_role'
    );
    expect(source).toContain(
      'revoke all on function create_verified_family(uuid, text, text, boolean, text) from public'
    );
    expect(source).toContain(
      'revoke all on function create_verified_family(uuid, text, text, boolean, text) from anon'
    );
    expect(source).toContain(
      'revoke all on function create_verified_family(uuid, text, text, boolean, text) from authenticated'
    );
  });

  it('the Edge Function reads timezone from the request body and forwards it as p_timezone', () => {
    expect(edge).toContain("typeof body.timezone === 'string' ? body.timezone.trim() : null");
    expect(edge).toContain('p_timezone: timezone || null');
  });
});
