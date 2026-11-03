import fs from 'fs';
import path from 'path';

const root = path.resolve(__dirname, '../../..');
const read = (rel: string) => fs.readFileSync(path.join(root, rel), 'utf8');

describe('migration 20261103120000 — new-device approval', () => {
  const sql = read('supabase/migrations/20261103120000_device_access_requests.sql');
  const fns = sql.split('create or replace function ').slice(1);
  const body = (name: string) => fns.find((fn) => fn.startsWith(`public.${name}(`)) ?? '';

  it('keeps the table behind RLS with no client privileges', () => {
    expect(sql).toContain('alter table public.device_access_requests enable row level security;');
    expect(sql).toContain('revoke all on public.device_access_requests from public, anon, authenticated;');
    expect(sql).not.toMatch(/grant (select|insert|update|delete)[^;]* on public\.device_access_requests/i);
    expect(sql).not.toMatch(/create policy/i);
  });

  it('hardens every function', () => {
    expect(fns.length).toBe(6);
    for (const fn of fns) {
      const name = fn.slice('public.'.length, fn.indexOf('('));
      expect(fn).toContain("security definer set search_path = ''");
      expect(sql).toMatch(new RegExp(`revoke all on function public\\.${name}\\([^)]*\\) from public, anon`));
    }
    // The assert helper is never callable by clients.
    expect(sql).toContain('revoke all on function public.device_access_assert_family_admin(uuid) from public, anon, authenticated;');
  });

  it('only a member of the family can ask, for an active profile of that family, rate-limited', () => {
    const request = body('request_device_access');
    expect(request).toContain('from public.family_auth_members m join public.families f on f.id = m.family_id');
    expect(request).toContain("where m.auth_user_id = auth.uid() and f.approval_status = 'active'");
    expect(request).toContain('if v_target_family is distinct from v_family or v_removed is not null then');
    expect(request).toContain('>= 5 then');
  });

  it('only a real family admin decides — not impersonating, not as a System Admin observer', () => {
    const assert = body('device_access_assert_family_admin');
    expect(assert).toContain('public.active_system_admin_observer_family() is not null');
    expect(assert).toContain('public.active_impersonation_target() is not null');
    expect(assert).toContain('not public.is_real_family_admin(p_family_id)');
    expect(body('admin_list_device_access_requests')).toContain('perform public.device_access_assert_family_admin(v_family);');
    const decide = body('admin_decide_device_access_request');
    expect(decide).toContain('perform public.device_access_assert_family_admin(r.family_id);');
    expect(decide).toContain("if r.status <> 'pending' or r.created_at <= now() - interval '30 minutes' then");
    expect(decide).toContain('insert into public.profile_auth_sessions (auth_user_id, family_id, user_id, updated_at)');
    expect(decide).toContain("'device_access_approved'");
  });

  it('the device reads only its own request, and each request is announced once', () => {
    expect(body('get_my_device_access_request')).toContain('where r.id = p_id and r.requester_auth_user_id = auth.uid();');
    expect(body('claim_device_access_admin_notice')).toContain('r.requester_auth_user_id = auth.uid() and r.status = \'pending\'');
    expect(body('claim_device_access_admin_notice')).toContain('r.admin_notified_at is null');
  });
});

describe('device-access-notify Edge Function', () => {
  const fn = read('supabase/functions/device-access-notify/index.ts');
  it('trusts only an id, claims through the caller and pushes to the family admins', () => {
    expect(fn).toContain("userClient.rpc('claim_device_access_admin_notice'");
    expect(fn).toContain("serviceClient.rpc('family_admin_profile_ids'");
    expect(fn).toContain(".in('user_id', ids).eq('family_id', c.family_id).eq('is_active', true)");
  });
});

describe('new-device approval in the app', () => {
  const login = read('src/screens/LoginScreen.tsx');
  const home = read('src/screens/HomeScreen.tsx');

  it('a profile signed in elsewhere opens the approval window instead of an error', () => {
    expect(login).toContain('if (isProfileClaimedElsewhereError(err)) {\n        setAccessRequestUserId(userId);');
    expect(login).toContain('<DeviceAccessRequestModal');
  });

  it('the family admin sees the request on Home', () => {
    expect(home).toContain("<DeviceAccessRequestsCard enabled={isSupabaseConfigured && actualFamilyRole === 'admin' && !personalNotificationsReadOnly} />");
  });

  it('recognises the server rejection used for "signed in elsewhere"', () => {
    const { isProfileClaimedElsewhereError } = require('../deviceAccess');
    expect(isProfileClaimedElsewhereError({ message: 'profile already claimed by another device' })).toBe(true);
    expect(isProfileClaimedElsewhereError(new Error('network'))).toBe(false);
  });
});
