import fs from 'fs';
import path from 'path';

/**
 * Staging recorded the v1.2 migration as 20261013164442 (a tool stamped its
 * own version) while the repository called it 20261013070000. The repository
 * now uses the recorded version, and the three pending migrations are applied
 * through generated single-transaction "apply + record" SQL so the ledger
 * keeps the repository's versions. These pin that the generated SQL is the
 * exact reviewed migration and is ordered and guarded correctly.
 */
const root = path.join(__dirname, '..', '..', '..');
const migrationsDir = path.join(root, 'supabase', 'migrations');
const applyDir = path.join(root, 'supabase', 'staging_apply');

const PENDING: Array<[string, string[]]> = [
  ['20261015100000_system_admin_duplicate_walk_repair_v12.sql', ['20261013164442']],
  ['20261015100100_walk_lifecycle_gps_v11.sql', ['20261013164442', '20261015100000']],
  ['20261015100200_walk_lifecycle_capabilities_v11.sql', ['20261015100100']],
];

describe('Staging ledger reconciliation', () => {
  const migrations = fs.readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort();

  it('names v1.2 by the version Staging actually recorded, exactly once', () => {
    expect(migrations.filter((f) => f.endsWith('_walk_duplicate_resolution_v12.sql'))).toEqual(['20261013164442_walk_duplicate_resolution_v12.sql']);
    expect(migrations.some((f) => f.startsWith('20261013070000_'))).toBe(false);
  });

  it('keeps dependency order for a fresh install: v1.2 < repair < v1.1 < capability probe, each after its predecessor', () => {
    const order = ['20261013164442_walk_duplicate_resolution_v12.sql', ...PENDING.map(([file]) => file)];
    const positions = order.map((file) => migrations.indexOf(file));
    expect(positions.every((p) => p >= 0)).toBe(true);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
  });

  it.each(PENDING)('%s: generated SQL embeds the migration byte-for-byte, guarded and recorded in one transaction', (file: string, requires: string[]) => {
    const body = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
    const generated = fs.readFileSync(path.join(applyDir, file), 'utf8');
    const version = file.split('_')[0];
    const name = file.slice(version.length + 1, -4);
    const start = `-- ===== BEGIN supabase/migrations/${file} =====\n`;
    const end = `-- ===== END supabase/migrations/${file} =====\n`;
    const embedded = generated.slice(generated.indexOf(start) + start.length, generated.indexOf(end));
    expect(embedded.replace(/\n$/, '')).toBe(body.replace(/\n$/, ''));
    expect(generated.trimStart().split('\n').find((line) => !line.startsWith('--'))).toBe('begin;');
    expect(generated.trimEnd().endsWith('commit;')).toBe(true);
    expect(generated).toContain(`where version = '${version}') then\n    raise exception 'migration ${version} is already recorded; nothing applied';`);
    for (const req of requires) expect(generated).toContain(`where version = '${req}') then\n    raise exception 'required predecessor migration ${req} is not recorded; nothing applied';`);
    expect(generated).toContain(`values ('${version}', '${name}', array[$ledger_body$${body}$ledger_body$]);`);
    // The guard runs before any migration statement.
    expect(generated.indexOf('$ledger_guard$')).toBeLessThan(generated.indexOf(start));
  });

  it('the repair migration targets only the two approved walks of the approved family and dog', () => {
    const sql = fs.readFileSync(path.join(migrationsDir, '20261015100000_system_admin_duplicate_walk_repair_v12.sql'), 'utf8');
    const uuids = new Set(sql.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g));
    expect([...uuids].sort()).toEqual([
      '088a73c5-0dd9-47fd-9bd1-fb44bc739eb3',
      '2a495898-6936-487c-8da9-5fcaeb3b0b60',
      '62c6b367-a253-4dad-9c83-0ae596f37461',
      'f806158f-eee9-4a6e-87be-72c4a3d64f75',
    ]);
  });
});
