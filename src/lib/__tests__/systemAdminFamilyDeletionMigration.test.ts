import fs from 'node:fs';
import path from 'node:path';

const migrationPath = path.resolve(__dirname, '../../../supabase/migrations/20261016115245_permanent_family_deletion.sql');
const sql = fs.readFileSync(migrationPath, 'utf8').toLowerCase();

describe('permanent family deletion migration safety contract', () => {
  it('requires verified System Admin authorization in each privileged entry point and rejects observer modes', () => {
    for (const fn of ['system_admin_family_deletion_impact', 'system_admin_begin_family_deletion', 'system_admin_list_family_deletion_storage_objects', 'system_admin_finalize_family_deletion']) {
      const start = sql.indexOf(`function public.${fn}`);
      expect(start).toBeGreaterThanOrEqual(0);
      const body = sql.slice(start, sql.indexOf('$$;', start));
      expect(body).toContain('is_verified_system_admin()');
      expect(body).toContain('active_system_admin_observer_family()');
      expect(body).toContain('active_impersonation_target()');
    }
  });

  it('creates content-free anti-replay tombstones and blocks tenant writes and family ID reuse', () => {
    expect(sql).toContain('create table if not exists public.family_deletion_tombstones');
    expect(sql).toContain('reject_writes_for_deleting_family');
    expect(sql).toContain('prevent_deleted_family_id_reuse');
    expect(sql).toContain("state in ('deleting','deleted')");
    expect(sql).not.toContain('syncqueue');
  });

  it('deletes Storage through RLS-scoped authenticated Storage API, never SQL object deletion', () => {
    expect(sql).toContain('system admin delete family photos during deletion');
    expect(sql).toContain('system admin delete chat attachments during deletion');
    expect(sql).not.toMatch(/delete\s+from\s+storage\.objects/);
    expect(sql).toContain('chat_attachment_path_parts');
  });

  it('preserves authentication identities, redacts family audit content and retires the QA-only destructive RPC', () => {
    expect(sql).toContain('family_content_redacted');
    expect(sql).toContain('system_admin_delete_test_family');
    expect(sql).toContain('test family deletion is retired');
    expect(sql).not.toMatch(/delete\s+from\s+auth\.users/);
    expect(sql).not.toMatch(/delete\s+from\s+public\.system_admins/);
  });
});
