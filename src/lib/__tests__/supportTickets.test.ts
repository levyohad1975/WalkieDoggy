import fs from 'fs';
import path from 'path';

const root = path.resolve(__dirname, '../../..');
const read = (rel: string) => fs.readFileSync(path.join(root, rel), 'utf8');

describe('migration 20261102160000 — support requests', () => {
  const sql = read('supabase/migrations/20261102160000_support_tickets.sql');

  it('keeps the table behind RLS with no client privileges', () => {
    expect(sql).toContain('alter table public.support_tickets enable row level security;');
    expect(sql).toContain('revoke all on public.support_tickets from public, anon, authenticated;');
    expect(sql).not.toMatch(/grant (select|insert|update|delete)[^;]* on public\.support_tickets/i);
    expect(sql).not.toMatch(/create policy/i);
  });

  it('hardens every function and re-checks the System Admin for console actions', () => {
    const fns = sql.split('create or replace function ').slice(1);
    expect(fns.length).toBe(9);
    for (const fn of fns) {
      const name = fn.slice('public.'.length, fn.indexOf('('));
      expect(fn).toContain("security definer set search_path = ''");
      expect(sql).toMatch(new RegExp(`revoke all on function public\\.${name}\\([^)]*\\) from public, anon`));
    }
    for (const name of ['system_admin_list_support_tickets', 'system_admin_reply_support_ticket', 'system_admin_set_support_ticket_status', 'claim_support_reply_notice']) {
      const body = fns.find((fn) => fn.startsWith(`public.${name}(`)) ?? '';
      expect(body).toContain('perform public.support_assert_system_admin();');
    }
  });

  it('lets families send and read only their own requests', () => {
    const submit = sql.slice(sql.indexOf('public.submit_support_ticket('), sql.indexOf('public.list_my_support_tickets('));
    expect(submit).toContain('public.real_current_profile_id()');
    expect(submit).toContain('public.current_family_id()');
    expect(submit).toContain('>= 10 then');
    const mine = sql.slice(sql.indexOf('public.list_my_support_tickets('), sql.indexOf('public.mark_my_support_replies_seen('));
    expect(mine).toContain('where t.user_id = v_profile and t.family_id = v_family');
  });

  it('announces each request and each reply at most once, only to its sender', () => {
    const claim = sql.slice(sql.indexOf('public.claim_support_ticket_admin_notice('), sql.indexOf('public.claim_support_reply_notice('));
    expect(claim).toContain('t.auth_user_id = auth.uid() and t.admin_notified_at is null');
    expect(sql).toContain("reply_notified_at = null");
    expect(sql).toContain('t.replied_at is not null and t.reply_notified_at is null');
  });
});

describe('support-notify Edge Function', () => {
  const fn = read('supabase/functions/support-notify/index.ts');
  it('trusts only an id from the request and claims through the caller', () => {
    expect(fn).toContain("userClient.rpc('claim_support_ticket_admin_notice'");
    expect(fn).toContain("userClient.rpc('claim_support_reply_notice'");
    expect(fn).toContain("Deno.env.get('SYSTEM_OWNER_EMAIL')");
    expect(fn).toContain(".in('auth_user_id', adminIds)");
    expect(fn).toContain('escapeHtml(String(ticket.body');
  });
});

describe('Help & Support uses the in-app form instead of the mail app', () => {
  const modal = read('src/components/HelpCenterModal.tsx');
  it('opens the form and shows replies under "הפניות שלי"', () => {
    expect(modal).not.toContain('mailto:');
    expect(modal).toContain('label="✍️ כתבו לנו"');
    expect(modal).toContain('await submitSupportTicket(topic, text);');
    expect(modal).toContain('📬 הפניות שלי');
    expect(modal).toContain('markMySupportRepliesSeen()');
  });

  it('the console has a "📨 פניות" tab', () => {
    const admin = read('src/screens/SystemAdminScreen.tsx');
    expect(admin).toContain('📨 פניות');
    expect(admin).toContain('<SystemAdminSupportPanel />');
  });
});

describe('support helpers', () => {
  it('labels topics and statuses in Hebrew', () => {
    const { supportTopicLabel, supportStatusLabel } = require('../support');
    expect(supportTopicLabel('bug')).toBe('🐞 תקלה');
    expect(supportStatusLabel('open')).toBe('ממתינה לתשובה');
    expect(supportStatusLabel('answered')).toBe('נענתה');
  });
});
