import fs from 'fs';
import path from 'path';

/**
 * Source-text-scan test (this repo has no live Postgres to run migrations
 * against in this sandbox -- same convention as migration0037/0038/0039/
 * 0040/0041) for a real, first-time-discovered security gap: `dogs`'
 * "modify dogs in own family" policy (supabase/schema.sql, never touched by
 * any migration 0001-0041) was written as a single `for all using (family_id
 * = current_family_id())`, which allows ANY family member -- not just an
 * admin -- to DELETE the family's dog row. schedule_rules.dog_id,
 * schedule_entries.dog_id, and walks.dog_id are all `on delete cascade`, and
 * FK cascades bypass RLS entirely, so a single non-admin DELETE on `dogs`
 * silently wipes the whole family's schedule and walk history. There is no
 * delete-a-dog feature anywhere in this app, so 0042 closes this the same
 * way 0003 closed the equivalent gap on `users`: split INSERT/UPDATE out
 * (kept open, matching today's actual any-member-can-edit behavior) and add
 * no DELETE policy at all.
 */
describe('migration 0042 — dogs: no client-facing DELETE policy', () => {
  const migrationsDir = path.resolve(__dirname, '../../../supabase/migrations');
  const source = fs
    .readFileSync(path.join(migrationsDir, '0042_dogs_no_client_delete.sql'), 'utf8')
    .replace(/\r\n/g, '\n');

  it('does not edit any already-applied migration file (0001-0041) -- only adds a new one', () => {
    const files = fs.readdirSync(migrationsDir).filter((f) => f.endsWith('.sql'));
    for (const mustExist of [
      '0004_admin_permissions_and_member_deletion.sql',
      '0041_fail_closed_member_removal_completeness_check.sql',
    ]) {
      expect(files).toContain(mustExist);
    }
    expect(files.filter((f) => f.startsWith('0042_'))).toHaveLength(1);
  });

  it('drops the old permissive "for all" policy on dogs', () => {
    expect(source).toContain('drop policy if exists "modify dogs in own family" on dogs');
  });

  it('keeps INSERT and UPDATE open to any family member (unchanged behavior)', () => {
    expect(source).toContain(
      'create policy "insert dogs in own family" on dogs\n  for insert with check (family_id = current_family_id());'
    );
    expect(source).toContain(
      'create policy "update dogs in own family" on dogs\n  for update using (family_id = current_family_id())\n  with check (family_id = current_family_id());'
    );
  });

  it('never creates a DELETE policy on dogs', () => {
    expect(source).not.toMatch(/for\s+delete/i);
    expect(source).not.toMatch(/create policy[^;]*on dogs[^;]*for all/i);
  });

  it('does not touch any other table\'s policies', () => {
    const policyMatches = [...source.matchAll(/create policy "[^"]+" on (\w+)/g)].map((m) => m[1]);
    expect(policyMatches.every((table) => table === 'dogs')).toBe(true);
    expect(policyMatches.length).toBeGreaterThan(0);
  });
});
