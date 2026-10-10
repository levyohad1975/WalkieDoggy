import fs from 'fs';
import path from 'path';

/**
 * Source-text-scan test (this repo has no live Postgres to run migrations
 * against in this sandbox — same convention as migration0037/.../0042) for
 * the Phase 3 (Health & Grooming, PRD §10) data foundation: `health_tasks`.
 * Locks in the properties that matter most: built multi-dog-first (dog_id
 * NOT NULL, no dogs-per-family assumption anywhere), family-isolated via
 * the same current_family_id() every other table uses, and — matching the
 * `dogs` posture this migration explicitly follows (0042) — no client-
 * facing DELETE policy, since a health record is family history that
 * should never be silently erasable.
 */
describe('migration 0049 — health_tasks: multi-dog-first foundation, no client DELETE', () => {
  const migrationsDir = path.resolve(__dirname, '../../../supabase/migrations');
  const source = fs
    .readFileSync(path.join(migrationsDir, '0049_health_grooming_foundation.sql'), 'utf8')
    .replace(/\r\n/g, '\n');

  it('does not edit any already-applied migration file (0001-0048) — only adds a new one', () => {
    const files = fs.readdirSync(migrationsDir).filter((f) => f.endsWith('.sql'));
    for (const mustExist of ['0042_dogs_no_client_delete.sql', '0048_walk_lifecycle.sql']) {
      expect(files).toContain(mustExist);
    }
    expect(files.filter((f) => f.startsWith('0049_'))).toHaveLength(1);
  });

  it('dog_id is NOT NULL and references dogs(id) — multi-dog-first, not a single-dog retrofit', () => {
    expect(source).toMatch(/dog_id uuid not null references dogs\(id\) on delete cascade/);
  });

  it('family_id is NOT NULL and references families(id), isolating every row per family', () => {
    expect(source).toMatch(/family_id uuid not null references families\(id\) on delete cascade/);
  });

  it('category is constrained to the PRD §10 core category list', () => {
    const categoryBlockStart = source.indexOf('category text not null check');
    expect(categoryBlockStart).toBeGreaterThan(-1);
    const categoryBlock = source.slice(categoryBlockStart, source.indexOf('))', categoryBlockStart) + 2);
    for (const category of [
      'vaccination',
      'parasite_prevention',
      'medication',
      'vet_visit',
      'weight',
      'allergy',
      'food',
      'grooming',
      'bath',
      'nails',
      'teeth',
      'ears',
      'other',
    ]) {
      expect(categoryBlock).toContain(`'${category}'`);
    }
  });

  it('every row is either a due task, a completed log entry, or both — never neither', () => {
    expect(source).toContain('constraint health_tasks_due_or_completed check (due_date is not null or completed_at is not null)');
  });

  it('enables RLS and isolates every policy to current_family_id()', () => {
    expect(source).toContain('alter table health_tasks enable row level security;');
    const policyMatches = [...source.matchAll(/create policy "[^"]+" on health_tasks\n\s+for (\w+)[^;]*/g)];
    expect(policyMatches.length).toBeGreaterThanOrEqual(3);
    for (const match of policyMatches) {
      expect(match[0]).toContain('family_id = current_family_id()');
    }
  });

  it('never creates a DELETE policy — a health record is family history, not client-erasable (same posture as dogs, 0042)', () => {
    expect(source).not.toMatch(/for\s+delete/i);
  });

  it('never grants a broader "for all" policy that would fold DELETE back in', () => {
    expect(source).not.toMatch(/create policy[^;]*on health_tasks[^;]*for all/i);
  });
});
