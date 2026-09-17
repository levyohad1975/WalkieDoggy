import fs from 'fs';
import path from 'path';

/**
 * Source-text-scan test (this repo has no live Postgres to run migrations
 * against in this sandbox -- same convention as migration0036/migration0037)
 * for a real, first-time-discovered security regression: migration 0033
 * ("contract/cutover phase") replaced current_family_role()/is_family_admin()
 * with bare family_auth_members-based lookups instead of layering its
 * intended families.approval_status = 'active' gate on top of 0016's
 * persona-anchored authorization model. Since set_member_role() (0016,
 * still applied) writes only users.role for the target PERSONA, while 0033's
 * versions read only the DEVICE-level family_auth_members.role, promoting/
 * demoting a member had no real server-side effect: a demoted admin whose
 * device's family_auth_members.role was still 'admin' (e.g. the original
 * family creator) kept full admin authority indefinitely, and a promoted
 * member whose device's family_auth_members.role was still 'member' (e.g.
 * anyone who joined via invite code) was never actually granted admin
 * authority server-side despite the UI showing them as Admin. 0033 also
 * dropped is_family_admin()'s active_impersonation_target() fail-closed
 * wrapper (0006), so a real admin impersonating a member resolved as admin
 * again server-side. 0038 restores the persona-anchored model (see 0016's
 * "LOST-CLAIM ADVERSARIAL WALKTHROUGH", still mirrored by
 * lostClaimAuthorization.spec.test.ts) while adding the
 * approval_status = 'active' gate 0033 actually intended, applied explicitly
 * so a still-pending family's creator (family_auth_members row exists,
 * created by create_verified_family() before any persona/approval) cannot
 * bootstrap-fallback into admin before approval.
 */
describe('migration 0038 — restores persona-anchored current_family_role()/is_family_admin(), keeping the active-family gate', () => {
  const migrationsDir = path.resolve(__dirname, '../../../supabase/migrations');
  const source = fs
    .readFileSync(
      path.join(migrationsDir, '0038_restore_persona_authorization_with_active_family_gate.sql'),
      'utf8'
    )
    .replace(/\r\n/g, '\n');

  it('does not edit any already-applied migration file (0001-0037) -- only adds a new one', () => {
    const files = fs.readdirSync(migrationsDir).filter((f) => f.endsWith('.sql'));
    for (const mustExist of [
      '0016_profile_pin_reclaim_and_qa_sandbox.sql',
      '0033_verified_family_onboarding_cutover.sql',
      '0037_deactivate_push_on_member_removal.sql',
    ]) {
      expect(files).toContain(mustExist);
    }
    expect(files.filter((f) => f.startsWith('0038_'))).toHaveLength(1);
  });

  it('does not redefine current_family_id() -- that device-level lookup already gates on approval_status correctly', () => {
    expect(source).not.toContain('function current_family_id()');
  });

  it('current_family_role() resolves the PERSONA role first, via real_current_profile_id()', () => {
    const idx = source.indexOf('create or replace function current_family_role()');
    expect(idx).toBeGreaterThan(-1);
    const nextFnIdx = source.indexOf('create or replace function is_real_family_admin');
    const block = source.slice(idx, nextFnIdx);

    expect(block).toContain('persona_id := real_current_profile_id();');
    expect(block).toContain('select role, family_id into persona_role, persona_family');
    // The persona branch must itself re-check the family is active -- it is
    // NOT enough to rely on current_family_id()'s own gate, since the
    // persona branch never calls current_family_id() at all.
    expect(block).toContain("where id = persona_family and approval_status = 'active'");
    // Bootstrap-only fallback, unchanged from 0016.
    expect(block).toContain('fam_id := current_family_id();');
    expect(block).toContain('from users where family_id = fam_id and removed_at is null');
  });

  it('is_real_family_admin() gates on the target family being active BEFORE resolving any persona/fallback role', () => {
    const idx = source.indexOf('create or replace function is_real_family_admin(target_family_id uuid)');
    expect(idx).toBeGreaterThan(-1);
    const nextFnIdx = source.indexOf('create or replace function is_family_admin');
    const block = source.slice(idx, nextFnIdx);

    const gateIdx = block.indexOf("where id = target_family_id and approval_status = 'active'");
    const personaIdx = block.indexOf('persona_id := real_current_profile_id();');
    expect(gateIdx).toBeGreaterThan(-1);
    expect(personaIdx).toBeGreaterThan(gateIdx);

    expect(block).toContain("role = 'admin'\n        and removed_at is null");
    // Bootstrap-only fallback, unchanged from 0016.
    expect(block).toContain('from users where family_id = target_family_id and removed_at is null');
    expect(block).toContain('from family_auth_members');
  });

  it('is_family_admin() restores the active_impersonation_target() fail-closed wrapper around is_real_family_admin()', () => {
    const idx = source.indexOf('create or replace function is_family_admin(target_family_id uuid)');
    expect(idx).toBeGreaterThan(-1);
    const block = source.slice(idx);

    expect(block).toContain('when active_impersonation_target() is not null then false');
    expect(block).toContain('else is_real_family_admin(target_family_id)');
  });
});
