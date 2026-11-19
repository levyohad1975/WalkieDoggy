import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(__dirname, '../../..');
const app = fs.readFileSync(path.join(root, 'App.tsx'), 'utf8');
const screen = fs.readFileSync(path.join(root, 'src/screens/SystemAdminScreen.tsx'), 'utf8');
const client = fs.readFileSync(path.join(root, 'src/lib/systemAdmin.ts'), 'utf8');
const sql = fs.readFileSync(path.join(root, 'supabase/migrations/20261011104342_system_admin_test_families.sql'), 'utf8');
const storageSql = fs.readFileSync(path.join(root, 'supabase/migrations/20261011104913_system_admin_test_family_storage_cleanup.sql'), 'utf8');
const deletionSql = fs.readFileSync(path.join(root, 'supabase/migrations/20261016115245_permanent_family_deletion.sql'), 'utf8');

describe('System Admin test-family isolation contract', () => {
  it('exposes the control only in the verified System Admin surface and starts the existing setup wizard', () => {
    expect(screen).toContain('visible={visible && isSystemAdmin}');
    expect(screen).toContain('צור משפחת בדיקה');
    expect(app).toContain('onTestFamilySelected={selectTestFamily}');
    expect(app).toContain('<FamilySetupWizard');
    expect(app).toContain('exitSystemAdminTestFamily');
  });

  it('reopens only the real schedule wizard for an existing QA family without clearing completion', () => {
    expect(screen).toContain('visible={visible && isSystemAdmin}');
    expect(screen).toContain('פתיחת שלב לוח הטיולים');
    expect(screen).toContain('reenterExistingSystemAdminTestFamily(familyId, onTestFamilyScheduleSelected)');
    expect(app).toContain('onTestFamilyScheduleSelected={isStagingSupabaseProject ? selectTestFamilyForScheduleReview : undefined}');
    expect(app).toContain('scheduleReviewOnly: true');
    expect(app).toContain("hostname === 'czbxhsoxyawprqehkfit.supabase.co'");
    expect(app).toContain('!isStagingSupabaseProject || !useSystemAdminStore.getState().isSystemAdmin');
    expect(app).toContain('getActiveSystemAdminTestFamily()');
    expect(app).toContain('scheduleReviewOnly = familySetupProgress?.scheduleReviewOnly === true');
    expect(app).toContain('<FamilySetupWizard');
  });

  it('requires an authenticated, verified System Admin for test-family entry, switch, listing and cleanup RPCs', () => {
    const guardedRpcCount = (sql.match(/not public\.is_system_admin\(\)/g) ?? []).length;
    expect(guardedRpcCount).toBeGreaterThanOrEqual(5);
    expect(sql).toContain('email_confirmed_at is null');
    expect(sql).toContain('coalesce(v_auth.is_anonymous, true)');
    expect(sql).toContain('create or replace function public.system_admin_switch_test_family');
  });

  it('routes QA and all-family deletion through the complete audited, double-confirmed flow', () => {
    expect(screen).toContain('openFamilyDeletion(testFamily)');
    expect(screen).toContain('openFamilyDeletion({ familyId: detail.family!.id');
    expect(deletionSql).toContain("p_confirmation_phrase is distinct from 'DELETE FAMILY PERMANENTLY'");
    expect(deletionSql).toContain('public.is_verified_system_admin()');
    expect(deletionSql).toContain('system_admin_list_family_deletion_storage_objects');
    expect(deletionSql).toContain('family_deletion_tombstones');
    expect(client).toContain('client.storage.from(bucket).remove');
  });

  it('keeps the existing QA exit RPC unchanged and provides a distinct admin-only exit path', () => {
    expect(sql).toContain('create or replace function public.system_admin_exit_test_family()');
    expect(sql).not.toContain('create or replace function public.exit_qa_sandbox()');
    expect(storageSql).not.toContain('delete from storage.objects');
  });
});
