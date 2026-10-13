import fs from 'fs';
import path from 'path';

/**
 * Source-text-scan test (this repo has no live Postgres to run migrations
 * against in this sandbox — same convention as migration0037-0042/0101).
 * See migration 0102's own header comment for the full root cause: a
 * zero-destination request_push_events row was recorded as 'sent', the
 * same terminal status a real delivery gets.
 */
describe('migration 0102 — request_push_events gains a distinct no_destination status', () => {
  const migrationsDir = path.resolve(__dirname, '../../../supabase/migrations');
  const source = fs
    .readFileSync(path.join(migrationsDir, '0102_request_push_events_no_destination_status.sql'), 'utf8')
    .replace(/\r\n/g, '\n');

  it('does not edit any already-applied migration file — only adds a new one', () => {
    const files = fs.readdirSync(migrationsDir).filter((f) => f.endsWith('.sql'));
    for (const mustExist of [
      '0014_request_push_events.sql',
      '0101_fix_redeem_invite_profile_session.sql',
    ]) {
      expect(files).toContain(mustExist);
    }
    expect(files.filter((f) => f.startsWith('0102_'))).toHaveLength(1);
  });

  it('widens the status check constraint to also allow no_destination', () => {
    expect(source).toMatch(/drop constraint if exists request_push_events_status_check;/);
    expect(source).toMatch(/check \(status in \('sending', 'sent', 'failed', 'no_destination'\)\);/);
  });

  it('claim_request_push_event() reclaims a no_destination row the same way it reclaims a failed one — "sent" is still never reclaimed', () => {
    expect(source).toMatch(/where request_push_events\.status = 'failed'\s*\n\s*or request_push_events\.status = 'no_destination'/);
  });

  it('mark_request_push_event() accepts no_destination as a valid status alongside sent/failed', () => {
    expect(source).toMatch(/if p_status not in \('sent', 'failed', 'no_destination'\) then/);
  });

  it('grants are unchanged — service_role only, same as 0014', () => {
    expect(source).toMatch(/grant execute on function claim_request_push_event\(text, text, uuid, text, int\) to service_role;/);
    expect(source).toMatch(/grant execute on function mark_request_push_event\(text, text\) to service_role;/);
    expect(source).not.toMatch(/grant execute.*to (authenticated|anon|public)/i);
  });
});
