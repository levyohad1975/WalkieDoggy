import fs from 'fs';
import path from 'path';

/**
 * Source-text-scan test (no live Postgres in this sandbox — same convention
 * as migration0037/.../0049). Locks in that recurrence was added as a NEW
 * migration rather than an edit to the already-committed 0049, and that the
 * new column is a nullable, positive-only interval (a one-off record with no
 * recurrence must remain fully valid — see 0049's own due_date/completed_at
 * constraint, unaffected by this migration).
 */
describe('migration 0050 — health_tasks recurrence: additive, does not touch 0049', () => {
  const migrationsDir = path.resolve(__dirname, '../../../supabase/migrations');
  const source = fs
    .readFileSync(path.join(migrationsDir, '0050_health_task_recurrence.sql'), 'utf8')
    .replace(/\r\n/g, '\n');

  it('does not edit 0049 (or any other already-committed migration) — only adds a new one', () => {
    const files = fs.readdirSync(migrationsDir).filter((f) => f.endsWith('.sql'));
    expect(files).toContain('0049_health_grooming_foundation.sql');
    expect(files.filter((f) => f.startsWith('0050_'))).toHaveLength(1);

    const migration0049 = fs.readFileSync(path.join(migrationsDir, '0049_health_grooming_foundation.sql'), 'utf8');
    expect(migration0049).not.toContain('recurrence_interval_days');
  });

  it('adds recurrence_interval_days as a nullable, positive-only column via ALTER TABLE (additive, not a rewrite)', () => {
    expect(source).toMatch(/alter table health_tasks\s+add column if not exists recurrence_interval_days int/);
    expect(source).toMatch(/check \(recurrence_interval_days is null or recurrence_interval_days > 0\)/);
  });

  it('never touches health_tasks RLS policies or any other table', () => {
    expect(source).not.toMatch(/create policy|drop policy|enable row level security/i);
    expect(source).not.toMatch(/\balter table (?!health_tasks)\w+/i);
  });
});
