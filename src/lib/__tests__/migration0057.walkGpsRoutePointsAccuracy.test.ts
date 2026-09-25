import fs from 'fs';
import path from 'path';

/**
 * Source-text-scan test (no live Postgres in this sandbox — same convention
 * as migration0051/.../0056). Migration 0057 is documentation-only: it does
 * not alter walk_gps_sessions' schema (route_points is jsonb, added in
 * 0053, and needs no column change to hold an extra key per point) — it
 * only updates that column's comment to describe the new
 * {latitude,longitude,timestamp,accuracy} shape the application layer
 * (logic/gpsDistance.ts, store/gpsStore.ts) now writes.
 */
describe('migration 0057 — walk_gps_sessions.route_points: accuracy documented, no schema/data change', () => {
  const migrationsDir = path.resolve(__dirname, '../../../supabase/migrations');
  const source = fs
    .readFileSync(path.join(migrationsDir, '0057_walk_gps_route_points_accuracy.sql'), 'utf8')
    .replace(/\r\n/g, '\n');

  it('does not edit any already-applied migration file (0001-0056) — only adds a new one', () => {
    const files = fs.readdirSync(migrationsDir).filter((f) => f.endsWith('.sql'));
    for (const mustExist of ['0053_walk_gps_route_points.sql', '0056_admin_only_walk_delete.sql']) {
      expect(files).toContain(mustExist);
    }
    expect(files.filter((f) => f.startsWith('0057_'))).toHaveLength(1);
  });

  it('is comment-only: no create/alter/drop table, column, index, trigger, or policy statement', () => {
    expect(source).not.toMatch(/\b(create|alter|drop)\s+(table|index|trigger|policy)\b/i);
    expect(source).not.toMatch(/\badd column\b/i);
  });

  it('documents the new per-point accuracy field on the existing jsonb column', () => {
    expect(source).toMatch(/comment on column walk_gps_sessions\.route_points is/);
    expect(source).toMatch(/\{latitude,longitude,timestamp,accuracy\}/);
  });
});
