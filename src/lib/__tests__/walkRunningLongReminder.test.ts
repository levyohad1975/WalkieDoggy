import fs from 'fs';
import path from 'path';

const root = path.resolve(__dirname, '../../..');
const read = (rel: string) => fs.readFileSync(path.join(root, rel), 'utf8');

describe('walk still running long — one push to the walker (owner request 2026-11-03)', () => {
  const sql = read('supabase/migrations/20261103180000_walk_running_long_reminder.sql');
  const fn = read('supabase/functions/send-walk-reminders/index.ts');

  it('is server-only and claims each walk once', () => {
    expect(sql).toContain('alter table public.walk_running_long_notices enable row level security;');
    expect(sql).toContain('revoke all on public.walk_running_long_notices from public, anon, authenticated;');
    expect(sql).toContain('revoke all on function public.claim_walks_running_long(integer) from public, anon, authenticated;');
    expect(sql).toContain('grant execute on function public.claim_walks_running_long(integer) to service_role;');
    expect(sql).toContain("security definer set search_path = ''");
    expect(sql).toContain('on conflict (walk_id) do nothing');
    expect(sql).toContain("where w.status = 'in_progress'");
    expect(sql).toContain("and w.started_at > now() - interval '6 hours'");
  });

  it('fires after 30 minutes, to the walker only', () => {
    expect(fn).toContain('const WALK_RUNNING_LONG_MINUTES = 30;');
    expect(fn).toContain("serviceClient.rpc('claim_walks_running_long', {");
    expect(fn).toContain('[w.recipient_user_id],');
    expect(sql).toContain('coalesce(w.actual_walker_user_id, w.responsible_user_id) as due_recipient');
  });
});
