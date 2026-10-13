import fs from 'fs';
import path from 'path';

/**
 * BUG FIX regression (migration 0035): system_admin_list_families()/
 * system_admin_get_family_detail() (0029) predate verified family onboarding
 * (0032) and used to hardcode every family's reported status to the literal
 * 'active', even for genuinely pending/rejected families. 0035 fixes the
 * server side; this proves the "🛡️ ניהול מערכת" screen actually surfaces
 * the real approval_status it now receives, in both the family list row and
 * the family detail card, rather than fetching it and silently dropping it
 * (the pre-fix client already did fetch+forward `status` faithfully — see
 * lib/__tests__/systemAdmin.test.ts — but the screen never rendered it).
 * Source-scan convention: this repo has no render-test harness for screens.
 */
describe('SystemAdminScreen surfaces families.approval_status', () => {
  const source = fs.readFileSync(
    path.resolve(__dirname, '../SystemAdminScreen.tsx'),
    'utf8'
  );

  it('defines a Hebrew label helper covering active/pending/rejected', () => {
    expect(source).toMatch(/function approvalStatusLabel/);
    expect(source).toContain("'active'");
    expect(source).toContain("'pending'");
    expect(source).toContain("'rejected'");
  });

  it('renders the status in the family list row via f.status', () => {
    expect(source).toMatch(/approvalStatusLabel\(f\.status\)/);
  });

  it('renders the status in the family detail card via detail.family?.approvalStatus', () => {
    expect(source).toMatch(/detail\.family\?\.approvalStatus/);
    expect(source).toMatch(/approvalStatusLabel\(detail\.family\.approvalStatus\)/);
  });
});
