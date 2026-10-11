import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(__dirname, '../../..');
const app = fs.readFileSync(path.join(root, 'App.tsx'), 'utf8');
const screen = fs.readFileSync(path.join(root, 'src/screens/SystemAdminScreen.tsx'), 'utf8');
const client = fs.readFileSync(path.join(root, 'src/lib/systemAdmin.ts'), 'utf8');
const sql = fs.readFileSync(path.join(root, 'supabase/migrations/20261011104342_system_admin_test_families.sql'), 'utf8');
const storageSql = fs.readFileSync(path.join(root, 'supabase/migrations/20261011105300_system_admin_test_family_storage_cleanup.sql'), 'utf8');

describe('System Admin test-family isolation contract', () => {
  it('exposes the control only in the verified System Admin surface and starts the existing setup wizard', () => {
    expect(screen).toContain('visible={visible && isSystemAdmin}');
    expect(screen).toContain('צור משפחת בדיקה');
    expect(app).toContain('onTestFamilySelected={selectTestFamily}');
    expect(app).toContain('<FamilySetupWizard');
    expect(app).toContain('exitSystemAdminTestFamily');
  });

  it('requires an authenticated, verified System Admin for test-family entry, switch, listing and cleanup RPCs', () => {
    const guardedRpcCount = (sql.match(/not public\.is_system_admin\(\)/g) ?? []).length;
    expect(guardedRpcCount).toBeGreaterThanOrEqual(5);
    expect(sql).toContain('email_confirmed_at is null');
    expect(sql).toContain('coalesce(v_auth.is_anonymous, true)');
    expect(sql).toContain('create or replace function public.system_admin_switch_test_family');
  });

  it('refuses non-test or currently active family deletion and requires explicit confirmation', () => {
    expect(sql).toContain("p_confirm is distinct from 'DELETE TEST FAMILY'");
    expect(sql).toContain("if not v_is_qa then raise exception 'refusing to delete a non-test family'");
    expect(sql).toContain("return to the original family before deleting this test family");
    expect(storageSql).toContain("bucket_id = 'family-photos' and o.name like p_family_id::text || '/%'");
    expect(storageSql).toContain('system_admin_list_test_family_photo_paths');
    expect(client).toContain("client.storage.from('family-photos').remove");
  });

  it('keeps the existing QA exit RPC unchanged and provides a distinct admin-only exit path', () => {
    expect(sql).toContain('create or replace function public.system_admin_exit_test_family()');
    expect(sql).not.toContain('create or replace function public.exit_qa_sandbox()');
    expect(storageSql).not.toContain('delete from storage.objects');
  });
});
