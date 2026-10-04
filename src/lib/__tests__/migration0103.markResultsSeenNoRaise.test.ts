import fs from 'fs';
import path from 'path';

/**
 * Source-text-scan test (this repo has no live Postgres to run migrations
 * against in this sandbox — same convention as migration0101/0102). Part
 * of the "bell opens an error dialog" real-device QA fix — see
 * mark_my_request_results_seen()'s own header comment in this migration
 * for the full analysis: it used to raise 'no active profile claimed on
 * this family' for a condition touch_last_seen() already treats as a
 * harmless no-op, so opening the bell (HomeScreen's openRequestsInbox(),
 * the only caller) could surface a scary "אופס" error over an inbox that
 * otherwise opened and rendered fine. The client-side half of this fix
 * (requestsStore.ts's markResultsSeen() no longer surfacing ANY failure
 * from this RPC) is covered in requestsStore.test.ts; this file covers
 * only the server-side convention fix.
 */
describe('migration 0103 — mark_my_request_results_seen() no longer raises when identity cannot be resolved', () => {
  const migrationsDir = path.resolve(__dirname, '../../../supabase/migrations');
  const source = fs
    .readFileSync(path.join(migrationsDir, '0103_mark_results_seen_no_raise.sql'), 'utf8')
    .replace(/\r\n/g, '\n');

  it('does not edit any already-applied migration file — only adds a new one', () => {
    const files = fs.readdirSync(migrationsDir).filter((f) => f.endsWith('.sql'));
    for (const mustExist of [
      '0019_request_result_seen_state.sql',
      '0101_fix_redeem_invite_profile_session.sql',
      '0102_request_push_events_no_destination_status.sql',
    ]) {
      expect(files).toContain(mustExist);
    }
    expect(files.filter((f) => f.startsWith('0103_'))).toHaveLength(1);
  });

  it('returns silently instead of raising when current_profile_id()/current_family_id() cannot resolve — matching touch_last_seen()\'s own convention', () => {
    expect(source).toMatch(/if me is null or my_family is null then\s*\n\s*return;/);
    expect(source).not.toMatch(/raise exception 'no active profile claimed on this family'/);
  });

  it('still only ever marks the CALLER\'s own requested rows as seen — no authorization widening', () => {
    expect(source).toMatch(/and requested_by_user_id = me/g);
    expect(source).toMatch(/security definer/);
    expect(source).toMatch(/revoke all on function mark_my_request_results_seen\(\) from public;/);
    expect(source).toMatch(/grant execute on function mark_my_request_results_seen\(\) to authenticated;/);
    expect(source).not.toMatch(/grant execute.*to (anon|public)/i);
  });

  it('preserves the original 24-hour recently-resolved window for both request tables', () => {
    expect(source).toMatch(/update walk_swap_requests/);
    expect(source).toMatch(/update time_change_requests/);
    const occurrences = source.match(/resolved_at >= now\(\) - interval '24 hours'/g) ?? [];
    expect(occurrences.length).toBe(2);
  });
});
