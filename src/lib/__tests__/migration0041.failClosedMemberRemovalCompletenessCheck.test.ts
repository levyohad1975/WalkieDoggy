import fs from 'fs';
import path from 'path';

/**
 * Source-text-scan test (this repo has no live Postgres to run migrations
 * against in this sandbox -- same convention as migration0037/0038/0039/0040)
 * for a real, first-time-discovered data-integrity gap: admin_delete_family_
 * member() (0004/0007/0016/0037/0039, the definition this migration
 * replaces) fully TRUSTED the client-supplied rule_updates/entry_updates/
 * walk_updates JSON arrays to be the COMPLETE set of reassignments needed,
 * with no server-side check that every live schedule_rules/schedule_entries/
 * walks row still referencing target_user_id was actually covered. The
 * client computes that payload (planUserRemoval() in
 * src/logic/familyManagement.ts) from useScheduleStore's in-memory cache,
 * which can go stale (only refreshed via an explicit load() or a
 * best-effort, debounced Realtime subscription that can silently miss
 * updates) -- so a stale cache could leave a live row permanently pointing
 * at a just-removed, unreclaimable persona. 0041 closes this with a
 * fail-closed completeness check before the destructive steps run.
 */
describe('migration 0041 — fail-closed completeness check on admin_delete_family_member()', () => {
  const migrationsDir = path.resolve(__dirname, '../../../supabase/migrations');
  const source = fs
    .readFileSync(
      path.join(migrationsDir, '0041_fail_closed_member_removal_completeness_check.sql'),
      'utf8'
    )
    .replace(/\r\n/g, '\n');

  it('does not edit any already-applied migration file (0001-0040) -- only adds a new one', () => {
    const files = fs.readdirSync(migrationsDir).filter((f) => f.endsWith('.sql'));
    for (const mustExist of [
      '0037_deactivate_push_on_member_removal.sql',
      '0039_clear_family_auth_membership_on_member_removal.sql',
      '0040_prevent_cross_family_membership_overwrite.sql',
    ]) {
      expect(files).toContain(mustExist);
    }
    expect(files.filter((f) => f.startsWith('0041_'))).toHaveLength(1);
  });

  it('preserves the 4-argument admin_delete_family_member() signature (CREATE OR REPLACE, no DROP)', () => {
    expect(source).toContain(
      'create or replace function admin_delete_family_member(\n  target_user_id uuid,\n  rule_updates jsonb default \'[]\'::jsonb,\n  entry_updates jsonb default \'[]\'::jsonb,\n  walk_updates jsonb default \'[]\'::jsonb\n)'
    );
    expect(source).not.toMatch(/drop function\s+admin_delete_family_member/i);
  });

  it('preserves every pre-existing guard from 0039\'s definition unchanged', () => {
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
    expect(source).toContain('delete from family_auth_members');
    expect(source).toContain('delete from profile_auth_sessions where user_id = target_user_id');
  });

  it('checks for a stale schedule_rules row still referencing target_user_id, regardless of `active`', () => {
    const idx = source.indexOf("raise exception 'stale rotation data");
    expect(idx).toBeGreaterThan(-1);
    const block = source.slice(Math.max(0, idx - 300), idx);
    expect(block).toContain('from schedule_rules');
    expect(block).toContain('where family_id = target_family');
    expect(block).toContain('target_user_id = any (rotation_user_ids)');
    expect(block).not.toContain('and active');
  });

  it('checks for a stale schedule_entries row scoped to date >= the family\'s own local date, via current_family_local_date()', () => {
    const idx = source.indexOf("raise exception 'stale schedule data");
    expect(idx).toBeGreaterThan(-1);
    const block = source.slice(Math.max(0, idx - 300), idx);
    expect(block).toContain('from schedule_entries');
    expect(block).toContain('where family_id = target_family');
    expect(block).toContain('responsible_user_id = target_user_id');
    expect(block).toContain('date >= current_family_local_date()');
  });

  it('checks for a stale pending walk with no date filter, matching planUserRemoval\'s own deliberate no-date-exclusion choice', () => {
    const idx = source.indexOf("raise exception 'stale walk data");
    expect(idx).toBeGreaterThan(-1);
    const scheduleCheckIdx = source.indexOf("raise exception 'stale schedule data");
    const block = source.slice(scheduleCheckIdx, idx);
    expect(block).toContain('from walks');
    expect(block).toContain('where family_id = target_family');
    expect(block).toContain('responsible_user_id = target_user_id');
    expect(block).toContain("status = 'pending'");
    expect(block).not.toMatch(/date\s*[<>=]/);
  });

  it('orders all three completeness checks after the update loops and before the destructive steps (push deactivation, family_auth_members/profile_auth_sessions cleanup, removed_at)', () => {
    const walkUpdateLoopIdx = source.indexOf('update walks\n    set responsible_user_id');
    const rotationCheckIdx = source.indexOf("raise exception 'stale rotation data");
    const scheduleCheckIdx = source.indexOf("raise exception 'stale schedule data");
    const walkCheckIdx = source.indexOf("raise exception 'stale walk data");
    const pushIdx = source.indexOf('update push_tokens');
    const famAuthIdx = source.indexOf('delete from family_auth_members');
    const removedAtIdx = source.indexOf('update users\n  set removed_at = now()');

    expect(walkUpdateLoopIdx).toBeGreaterThan(-1);
    expect(rotationCheckIdx).toBeGreaterThan(walkUpdateLoopIdx);
    expect(scheduleCheckIdx).toBeGreaterThan(rotationCheckIdx);
    expect(walkCheckIdx).toBeGreaterThan(scheduleCheckIdx);
    expect(pushIdx).toBeGreaterThan(walkCheckIdx);
    expect(famAuthIdx).toBeGreaterThan(pushIdx);
    expect(removedAtIdx).toBeGreaterThan(famAuthIdx);
  });
});
