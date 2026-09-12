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
  const transitionMigrationSource = fs.readFileSync(
    path.resolve(__dirname, '../../../supabase/migrations/0036_atomic_family_approval_transition.sql'),
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
    expect(screenSource).toContain('await commitFamilyApprovalAndRefresh({');
    expect(screenSource).toContain('family.familyId === selectedFamilyId ? { ...family, status: decision } : family');
    expect(screenSource).toContain('e instanceof SystemAdminApprovalRefreshError');
    expect(screenSource).toContain('ההחלטה נשמרה, אך רענון הנתונים נכשל');
  });

  it('refreshes the fail-closed System Admin gate after OTP establishes the verified session', () => {
    const verifyIndex = onboardingSource.indexOf('await verifyAdminEmailOtp');
    const refreshIndex = onboardingSource.indexOf(
      'await useSystemAdminStore.getState().refresh({ retryOnce: true });'
    );
    const createIndex = onboardingSource.indexOf('const family = await createVerifiedFamily');

    expect(verifyIndex).toBeGreaterThan(-1);
    expect(refreshIndex).toBeGreaterThan(verifyIndex);
    expect(createIndex).toBeGreaterThan(refreshIndex);
  });

  it('recovers applicant status on mount, foreground, and explicit retry', () => {
    expect(onboardingSource).toContain('getMyFamilyOnboardingStatus()');
    expect(onboardingSource).toContain("AppState.addEventListener('change'");
    expect(onboardingSource).toContain("if (nextState === 'active')");
    expect(onboardingSource).toContain('onPress={() => refreshOnboardingStatus(true)}');
    expect(onboardingSource).toContain("status.approvalStatus === 'active'");
    expect(onboardingSource).toContain("setOnboardingApprovalStatus(status.approvalStatus)");
  });

  it('replaces the legacy list RPC without changing authorization and reads the persisted status', () => {
    expect(migrationSource).toContain('create or replace function system_admin_list_families');
    expect(migrationSource).toContain('if not is_system_admin() then');
    expect(migrationSource).toContain('f.approval_status');
    expect(migrationSource).not.toMatch(/'active'::text\s+as status/i);
    expect(migrationSource).toContain('revoke all on function system_admin_list_families(text) from public;');
    expect(migrationSource).toContain('grant execute on function system_admin_list_families(text) to authenticated;');
  });

  it('locks the family and accepts only a pending-to-final transition', () => {
    expect(transitionMigrationSource).toContain('for update;');
    expect(transitionMigrationSource).toContain("if v_current_status <> 'pending' then");
    expect(transitionMigrationSource).toContain("raise exception 'family approval is no longer pending'");
    expect(transitionMigrationSource).toContain("and approval_status = 'pending'");
    expect(transitionMigrationSource).toContain("raise exception 'family not found'");
  });
});
