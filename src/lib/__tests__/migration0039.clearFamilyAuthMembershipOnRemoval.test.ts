import fs from 'fs';
import path from 'path';

/**
 * Source-text-scan test (this repo has no live Postgres to run migrations
 * against in this sandbox -- same convention as migration0036/0037/0038)
 * for a real, first-time-discovered read-access leak: admin_delete_family_
 * member() has never touched family_auth_members for the removed member's
 * device(s). current_family_id() (0002/0033) resolves purely from
 * family_auth_members.auth_user_id = auth.uid(), with no removed_at/persona
 * check of its own, and several currently-active RLS SELECT policies gate
 * purely on `family_id = current_family_id()` with no is_family_admin()/
 * removed_at check layered on top at all ("select users in own family",
 * "select rules in own family", "select entries in own family", "select own
 * family"). So a removed member's device kept indefinite read access to the
 * full member roster and the entire recurring schedule/rotation plan, since
 * its family_auth_members row was never cleared. 0039 closes this by having
 * admin_delete_family_member() delete the family_auth_members row(s) for
 * every device currently representing the removed persona (via
 * profile_auth_sessions, the multi-device-session source of truth since
 * 0020, and the legacy single-device users.auth_user_id column), scoped to
 * target_family only.
 */
describe('migration 0039 — clears family_auth_members for a removed member\'s device(s)', () => {
  const migrationsDir = path.resolve(__dirname, '../../../supabase/migrations');
  const source = fs
    .readFileSync(
      path.join(migrationsDir, '0039_clear_family_auth_membership_on_member_removal.sql'),
      'utf8'
    )
    .replace(/\r\n/g, '\n');

  it('does not edit any already-applied migration file (0001-0038) -- only adds a new one', () => {
    const files = fs.readdirSync(migrationsDir).filter((f) => f.endsWith('.sql'));
    for (const mustExist of [
      '0016_profile_pin_reclaim_and_qa_sandbox.sql',
      '0020_multi_device_profile_sessions.sql',
      '0037_deactivate_push_on_member_removal.sql',
      '0038_restore_persona_authorization_with_active_family_gate.sql',
    ]) {
      expect(files).toContain(mustExist);
    }
    expect(files.filter((f) => f.startsWith('0039_'))).toHaveLength(1);
  });

  it('preserves the 4-argument admin_delete_family_member() signature (CREATE OR REPLACE, no DROP)', () => {
    expect(source).toContain(
      'create or replace function admin_delete_family_member(\n  target_user_id uuid,\n  rule_updates jsonb default \'[]\'::jsonb,\n  entry_updates jsonb default \'[]\'::jsonb,\n  walk_updates jsonb default \'[]\'::jsonb\n)'
    );
    expect(source).not.toMatch(/drop function\s+admin_delete_family_member/i);
  });

  it('preserves every pre-existing guard from 0037\'s definition unchanged', () => {
    expect(source).toContain("raise exception 'must be authenticated';");
    expect(source).toContain("raise exception 'user not found';");
    expect(source).toContain("raise exception 'not a member of this user''s family';");
    expect(source).toContain("raise exception 'admin permission required';");
    expect(source).toContain("raise exception 'cannot remove the last admin of this family';");
    expect(source).toContain("raise exception 'invalid rotation_user_ids replacement in rule_updates';");
    expect(source).toContain("raise exception 'invalid responsible_user_id replacement in entry_updates';");
    expect(source).toContain("raise exception 'invalid responsible_user_id replacement in walk_updates';");
    expect(source).toContain('update push_tokens\n  set is_active = false');
    expect(source).toContain('update web_push_subscriptions\n  set is_active = false');
  });

  it('deletes family_auth_members for the removed persona\'s device(s), scoped to target_family, sourced from both profile_auth_sessions and the legacy users.auth_user_id column', () => {
    const delIdx = source.indexOf('delete from family_auth_members');
    expect(delIdx).toBeGreaterThan(-1);
    const removedAtIdx = source.indexOf('update users\n  set removed_at = now()');
    expect(removedAtIdx).toBeGreaterThan(delIdx);

    const block = source.slice(delIdx, removedAtIdx);
    expect(block).toContain('where family_id = target_family');
    expect(block).toContain('select auth_user_id from profile_auth_sessions where user_id = target_user_id');
    expect(block).toContain('select auth_user_id from users where id = target_user_id and auth_user_id is not null');
  });

  it('also clears the removed persona\'s own profile_auth_sessions rows', () => {
    expect(source).toContain('delete from profile_auth_sessions where user_id = target_user_id');
    const sessionsIdx = source.indexOf('delete from profile_auth_sessions where user_id = target_user_id');
    const removedAtIdx = source.indexOf('update users\n  set removed_at = now()');
    expect(sessionsIdx).toBeGreaterThan(-1);
    expect(removedAtIdx).toBeGreaterThan(sessionsIdx);
  });

  it('orders the new cleanup before removed_at is set, same convention as 0037\'s push-deactivation ordering', () => {
    const pushIdx = source.indexOf('update push_tokens');
    const famAuthIdx = source.indexOf('delete from family_auth_members');
    const sessionsIdx = source.indexOf('delete from profile_auth_sessions where user_id = target_user_id');
    const removedAtIdx = source.indexOf('update users\n  set removed_at = now()');

    expect(pushIdx).toBeGreaterThan(-1);
    expect(famAuthIdx).toBeGreaterThan(pushIdx);
    expect(sessionsIdx).toBeGreaterThan(famAuthIdx);
    expect(removedAtIdx).toBeGreaterThan(sessionsIdx);
  });
});
