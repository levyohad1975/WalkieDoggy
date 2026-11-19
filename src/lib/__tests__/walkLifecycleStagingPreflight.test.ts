import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

const root = path.resolve(__dirname, '../../../');
const preflightPath = path.join(root, 'supabase/manual_tests/walk_lifecycle_v11_staging_preflight_readonly.sql');
const preflight = fs.readFileSync(preflightPath, 'utf8');

function readInventory() {
  const start = preflight.indexOf('with expected_ledger(');
  const end = preflight.indexOf('\n), live_ledger as', start);
  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);
  const values = preflight.slice(start, end);
  return [...values.matchAll(/\('([^']+)','([^']+)','([a-f0-9]{32})',(null|'[^']*'),'([^']+)'\)/g)].map((match) => ({
    version: match[1],
    name: match[2],
    fingerprint: match[3],
    repositorySource: match[4] === 'null' ? null : match[4].slice(1, -1),
    sourceStatus: match[5],
  }));
}

describe('Walk Lifecycle Staging preflight inventory and trigger checks', () => {
  it('is read-only and fingerprints the current Staging ledger instead of comparing filename prefixes', () => {
    const inventory = readInventory();
    expect(preflight).toMatch(/begin transaction read only;/i);
    expect(preflight.trimEnd()).toMatch(/rollback;$/i);
    expect(inventory).toHaveLength(72);
    expect(new Set(inventory.map((row) => row.version)).size).toBe(inventory.length);
    expect(inventory.find((row) => row.version === '20261013164442')).toMatchObject({
      name: 'walk_duplicate_resolution_v12',
      fingerprint: '8318a215a8380446e2529949603f908a',
      repositorySource: 'supabase/migrations/20261013164442_walk_duplicate_resolution_v12.sql',
      sourceStatus: 'exact',
    });
    expect(preflight).not.toContain('repo_not_in_ledger');
    expect(preflight).not.toContain('ledger_not_in_repo');
  });

  it('labels exact, changed-source, baseline, and ledger-only history without rewriting it', () => {
    const inventory = readInventory();
    expect(new Set(inventory.map((row) => row.sourceStatus))).toEqual(
      new Set(['exact', 'source_diverged', 'baseline_in_schema', 'ledger_only', 'activation_pending']),
    );
    for (const row of inventory) {
      if (!row.repositorySource) {
        expect(row.sourceStatus).toBe('ledger_only');
        continue;
      }
      if (row.sourceStatus === 'baseline_in_schema') {
        expect(row.repositorySource).toBe('supabase/schema.sql');
        continue;
      }
      const bytes = fs.readFileSync(path.join(root, row.repositorySource));
      const repositoryFingerprint = crypto.createHash('md5').update(bytes).digest('hex');
      if (row.sourceStatus === 'exact' || row.sourceStatus === 'activation_pending') {
        expect(repositoryFingerprint).toBe(row.fingerprint);
      } else {
        expect(repositoryFingerprint).not.toBe(row.fingerprint);
      }
    }
  });

  it('checks the deployed walks delete trigger and duplicate-marker guard by trigger and function name', () => {
    expect(preflight).toContain("t.tgname = 'walks_admin_only_delete'");
    expect(preflight).toContain("p.proname = 'enforce_admin_only_walk_delete'");
    expect(preflight).toContain("t.tgname = 'walks_duplicate_resolution_marker_guard'");
    expect(preflight).toContain("p.proname = 'prevent_untrusted_duplicate_resolution_marker_change'");
    expect(preflight).not.toContain('enforce_walk_write_authorization');
  });

  it('pins the exact four migration versions and their preactivation ledger states', () => {
    expect(preflight).toContain("('20261013164442','walk_duplicate_resolution_v12'");
    expect(preflight).toContain("('20261015100000','system_admin_duplicate_walk_repair_v12'");
    expect(preflight).toContain("('20261015100100','walk_lifecycle_gps_v11'");
    expect(preflight).toContain("('20261015100200','walk_lifecycle_capabilities_v11'");
  });
});
