import * as fs from 'fs';
import * as path from 'path';

/** Release-candidate guardrails across UI, session refresh, and database contract. */
describe('System Admin approval integration source', () => {
  const screenSource = fs.readFileSync(
    path.resolve(__dirname, '../../screens/SystemAdminScreen.tsx'),
    'utf8'
  );
  const onboardingSource = fs.readFileSync(
    path.resolve(__dirname, '../../screens/FamilyOnboardingScreen.tsx'),
    'utf8'
  );
  const migrationSource = fs.readFileSync(
    path.resolve(__dirname, '../../../supabase/migrations/0035_system_admin_family_approval_status.sql'),
    'utf8'
  );

  it('renders all real approval states and only offers decisions for pending families', () => {
    expect(screenSource).toContain("pending: 'ממתינה לאישור'");
    expect(screenSource).toContain("active: 'פעילה'");
    expect(screenSource).toContain("rejected: 'נדחתה'");
    expect(screenSource).toContain("selectedFamily?.status === 'pending'");
    expect(screenSource).toContain("setPendingApprovalAction('active')");
    expect(screenSource).toContain("setPendingApprovalAction('rejected')");
  });

  it('requires confirmation, prevents duplicate submission, and refreshes server data after a decision', () => {
    expect(screenSource).toContain('pendingApprovalAction');
    expect(screenSource).toContain('loading={approvalSaving}');
    expect(screenSource).toContain('disabled={approvalSaving}');
    expect(screenSource).toContain(
      'await setSystemAdminFamilyApproval(selectedFamilyId, pendingApprovalAction);'
    );
    expect(screenSource).toContain(
      'await Promise.all([loadFamilies(search), openFamily(selectedFamilyId)]);'
    );
    expect(screenSource).toContain('setApprovalError(friendlyErrorMessage(e));');
  });

  it('refreshes the fail-closed System Admin gate after OTP establishes the verified session', () => {
    const verifyIndex = onboardingSource.indexOf('await verifyAdminEmailOtp');
    const refreshIndex = onboardingSource.indexOf(
      'await useSystemAdminStore.getState().refresh();'
    );
    const createIndex = onboardingSource.indexOf('const family = await createVerifiedFamily');

    expect(verifyIndex).toBeGreaterThan(-1);
    expect(refreshIndex).toBeGreaterThan(verifyIndex);
    expect(createIndex).toBeGreaterThan(refreshIndex);
  });

  it('replaces the legacy list RPC without changing authorization and reads the persisted status', () => {
    expect(migrationSource).toContain('create or replace function system_admin_list_families');
    expect(migrationSource).toContain('if not is_system_admin() then');
    expect(migrationSource).toContain('f.approval_status');
    expect(migrationSource).not.toMatch(/'active'::text\s+as status/i);
    expect(migrationSource).toContain('revoke all on function system_admin_list_families(text) from public;');
    expect(migrationSource).toContain('grant execute on function system_admin_list_families(text) to authenticated;');
  });
});
