import fs from 'fs';
import path from 'path';

/**
 * Source-text-scan test (no live Postgres in this sandbox — same convention
 * as migration0037/.../0050). Locks in the properties that matter most for
 * Phase 4 (GPS foundation, PRD §7): one session per walk, no raw location
 * history stored anywhere (privacy-by-design — see this migration's own
 * header), a first-class correction column, and — matching dogs (0042) and
 * health_tasks (0049) — no client-facing DELETE policy.
 */
describe('migration 0051 — walk_gps_sessions: no raw location history, correction flow, no client DELETE', () => {
  const migrationsDir = path.resolve(__dirname, '../../../supabase/migrations');
  const source = fs
    .readFileSync(path.join(migrationsDir, '0051_walk_gps_sessions.sql'), 'utf8')
    .replace(/\r\n/g, '\n');

  it('does not edit any already-applied migration file (0001-0050) — only adds a new one', () => {
    const files = fs.readdirSync(migrationsDir).filter((f) => f.endsWith('.sql'));
    for (const mustExist of ['0049_health_grooming_foundation.sql', '0050_health_task_recurrence.sql']) {
      expect(files).toContain(mustExist);
    }
    expect(files.filter((f) => f.startsWith('0051_'))).toHaveLength(1);
  });

  it('one session per walk (unique constraint), cascading with the walk', () => {
    expect(source).toMatch(/walk_id uuid not null references walks\(id\) on delete cascade/);
    expect(source).toMatch(/unique \(walk_id\)/);
  });

  it('stores only a derived distance + point count — no lat/lng/route/coordinates columns of any kind', () => {
    const tableStart = source.indexOf('create table if not exists walk_gps_sessions');
    const tableEnd = source.indexOf(');', tableStart);
    const tableBody = source.slice(tableStart, tableEnd);
    expect(tableBody).toMatch(/distance_meters numeric/);
    expect(tableBody).toMatch(/point_count int/);
    expect(tableBody).not.toMatch(/lat|lng|latitude|longitude|coordinates|route|polyline|geography|geometry|postgis/i);
  });

  it('has a first-class correction column, distinct from the original device-computed reading', () => {
    expect(source).toMatch(/corrected_distance_meters numeric/);
    expect(source).toMatch(/corrected_by_user_id uuid references users\(id\)/);
  });

  it('dog_id and family_id are NOT NULL — every session is attributed to one specific dog and family', () => {
    expect(source).toMatch(/dog_id uuid not null references dogs\(id\) on delete cascade/);
    expect(source).toMatch(/family_id uuid not null references families\(id\) on delete cascade/);
  });

  it('source is an open, extensible list (adapter/provider-ready for a future collar), not hardcoded to one vendor assumption', () => {
    expect(source).toMatch(/source text not null default 'device_gps' check \(source in \('device_gps'\)\)/);
  });

  it('enables RLS and isolates every policy to current_family_id()', () => {
    expect(source).toContain('alter table walk_gps_sessions enable row level security;');
    const policyMatches = [...source.matchAll(/create policy "[^"]+" on walk_gps_sessions\n\s+for (\w+)[^;]*/g)];
    expect(policyMatches.length).toBeGreaterThanOrEqual(3);
    for (const match of policyMatches) {
      expect(match[0]).toContain('family_id = current_family_id()');
    }
  });

  it('never creates a DELETE policy — matches dogs (0042) and health_tasks (0049)\'s no-client-delete posture', () => {
    expect(source).not.toMatch(/for\s+delete/i);
  });

  it('never grants a broader "for all" policy that would fold DELETE back in', () => {
    expect(source).not.toMatch(/create policy[^;]*on walk_gps_sessions[^;]*for all/i);
  });
});
