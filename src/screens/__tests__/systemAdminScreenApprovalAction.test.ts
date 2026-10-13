import fs from 'fs';
import path from 'path';

/**
 * BUG FIX regression: migration 0032's system_admin_set_family_approval()
 * RPC — the only server-side way to move a family out of 'pending'/
 * 'rejected' into 'active' (or into 'rejected') — was defined and granted
 * but never called from any client code. With AUTO_APPROVE_NEW_FAMILIES=false
 * a newly created family stuck at 'pending' had no in-app remedy: the
 * "🛡️ ניהול מערכת" screen only ever displayed the status, never let a real
 * System Admin change it. Source-scan convention: this repo has no
 * render-test harness for screens (see systemAdminScreenApprovalStatus.test.ts).
 */
describe('SystemAdminScreen wires system_admin_set_family_approval to real UI actions', () => {
  const source = fs.readFileSync(
    path.resolve(__dirname, '../SystemAdminScreen.tsx'),
    'utf8'
  );

  it('imports the approval-action client wrapper', () => {
    expect(source).toMatch(/import\s*\{[^}]*setSystemAdminFamilyApproval[^}]*\}\s*from\s*'\.\.\/lib\/systemAdmin'/);
  });

  it('defines a handler that calls the wrapper for the currently selected family', () => {
    expect(source).toMatch(/handleSetApproval/);
    expect(source).toMatch(/setSystemAdminFamilyApproval\(selectedFamilyId,\s*approvalStatus\)/);
  });

  it('offers an approve action whenever the family is not already active', () => {
    expect(source).toMatch(/detail\.family\.approvalStatus !== 'active'/);
    expect(source).toMatch(/handleSetApproval\('active'\)/);
  });

  it('offers a reject action for a pending family specifically', () => {
    expect(source).toMatch(/detail\.family\.approvalStatus === 'pending'/);
    expect(source).toMatch(/handleSetApproval\('rejected'\)/);
  });

  it('refreshes both the family detail and the family list after a successful approval change', () => {
    const handlerMatch = source.match(/const handleSetApproval[\s\S]*?\n  \};/);
    expect(handlerMatch).toBeTruthy();
    const handlerBody = handlerMatch![0];
    expect(handlerBody).toMatch(/openFamily\(selectedFamilyId\)/);
    expect(handlerBody).toMatch(/loadFamilies\(search\)/);
  });

  it('surfaces a genuine approval-action error via an accessible alert rather than swallowing it', () => {
    expect(source).toMatch(/approvalActionError/);
    expect(source).toMatch(/setApprovalActionError\(friendlyErrorMessage\(e\)\)/);
  });
});
