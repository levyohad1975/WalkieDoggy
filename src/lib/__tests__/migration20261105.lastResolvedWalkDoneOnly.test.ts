import fs from 'fs';
import path from 'path';

/**
 * Owner request 2026-11-05: the Home "last walk" card must show the last walk
 * actually PERFORMED (done), never a skipped one — a skipped walk means the dog
 * did not go out. This migration narrows get_last_resolved_walk()'s fallback
 * from done/skipped to done only; the client's computeLastWalk() matches.
 */
const migration = fs.readFileSync(
  path.resolve(__dirname, '../../../supabase/migrations/20261105190000_last_resolved_walk_done_only.sql'),
  'utf8',
);

describe('get_last_resolved_walk() narrowed to performed walks', () => {
  it('recreates the function selecting only done walks', () => {
    expect(migration).toMatch(/create or replace function get_last_resolved_walk\(\)\s*\nreturns setof walks/);
    expect(migration).toMatch(/and w\.status = 'done'/);
    expect(migration).not.toMatch(/status in \('done', 'skipped'\)/);
  });

  it('keeps the family scope, fail-closed guard and single-row limit', () => {
    expect(migration).toContain("v_family_id := current_family_id();");
    expect(migration).toMatch(/if v_family_id is null then\s*\n\s*return;/);
    expect(migration).toMatch(/limit 1;/);
    expect(migration).toMatch(/security definer set search_path = public/);
  });

  it('preserves the hardened grants (authenticated only)', () => {
    expect(migration).toMatch(/revoke all on function get_last_resolved_walk\(\) from public, anon;/);
    expect(migration).toMatch(/grant execute on function get_last_resolved_walk\(\) to authenticated;/);
  });
});
