import fs from 'fs';
import path from 'path';

/**
 * FEATURE (migration 0034): system_admin_list_email_delivery_log() was added
 * alongside email_delivery_log with a table comment naming it "the only
 * supported surface" (besides service-role) for inspecting welcome-email/
 * system-owner-email delivery status — but it had zero client call sites
 * anywhere in this repo. This proves the "🛡️ ניהול מערכת" screen now wires
 * it up: a header button opens a dedicated email-log view that fetches and
 * renders every entry's timestamp, message type, recipient, and status.
 * Source-scan convention: this repo has no render-test harness for screens.
 */
describe('SystemAdminScreen surfaces email_delivery_log', () => {
  const source = fs.readFileSync(
    path.resolve(__dirname, '../SystemAdminScreen.tsx'),
    'utf8'
  );

  it('imports getSystemAdminEmailDeliveryLog from lib/systemAdmin', () => {
    expect(source).toMatch(/getSystemAdminEmailDeliveryLog/);
  });

  it('defines Hebrew label helpers for message type and status', () => {
    expect(source).toMatch(/function emailMessageTypeLabel/);
    expect(source).toContain("'family_welcome'");
    expect(source).toContain("'system_owner_new_family'");
    expect(source).toMatch(/function emailStatusLabel/);
  });

  it('exposes a header control that opens the email delivery log view', () => {
    expect(source).toMatch(/onPress=\{openEmailLog\}/);
  });

  it('renders every entry with recipient, message type label, and status label', () => {
    expect(source).toMatch(/emailLog\.map\(/);
    expect(source).toMatch(/emailMessageTypeLabel\(e\.messageType\)/);
    expect(source).toMatch(/e\.recipientEmail/);
    expect(source).toMatch(/emailStatusLabel\(e\.status\)/);
  });
});
