import fs from 'fs';
import path from 'path';
import { familyIdentityParts, isOnline, matchesPresenceSearch, presenceLabel, type PresenceFamily } from '../systemAdminPresence';

const now = new Date('2026-11-02T12:00:00Z');
const minutesAgo = (m: number) => new Date(now.getTime() - m * 60_000).toISOString();

const levi = (over: Partial<PresenceFamily> = {}): PresenceFamily => ({
  familyId: 'f1', familyName: 'לוי', inviteCode: 'ABC123', status: 'active', createdAt: '2026-10-01T00:00:00Z',
  verifiedEmail: 'dana@example.com', adminNames: ['דנה'], dogNames: ['רקסי', 'בונו'], lastSeenAt: minutesAgo(1),
  members: [
    { userId: 'u1', name: 'דנה', avatar: null, role: 'admin', claimed: true, lastSeenAt: minutesAgo(1) },
    { userId: 'u2', name: 'יואב', avatar: null, role: 'member', claimed: false, lastSeenAt: null },
  ],
  ...over,
});

describe('System Admin presence helpers', () => {
  it('tells same-named families apart by code, admins, dogs and email', () => {
    expect(familyIdentityParts(levi()).join(' · ')).toBe('קוד ABC123 · מנהל/ת: דנה · כלב: רקסי, בונו · dana@example.com');
    expect(familyIdentityParts({ inviteCode: 'XYZ', adminNames: [], dogNames: [], verifiedEmail: null })).toEqual(['קוד XYZ']);
  });

  it('uses the same 5-minute rule as the in-family green dot', () => {
    expect(isOnline(minutesAgo(4), now)).toBe(true);
    expect(isOnline(minutesAgo(6), now)).toBe(false);
    expect(isOnline(null, now)).toBe(false);
  });

  it('labels every member, including ones never seen', () => {
    expect(presenceLabel({ lastSeenAt: minutesAgo(1), claimed: true }, now)).toBe('פעיל עכשיו');
    expect(presenceLabel({ lastSeenAt: minutesAgo(12), claimed: true }, now)).toBe('נראה לפני 12 דק׳');
    expect(presenceLabel({ lastSeenAt: '2026-10-20T08:00:00Z', claimed: true }, now)).toMatch(/^נראה ב-\d+\/\d+\/\d\d$/);
    expect(presenceLabel({ lastSeenAt: null, claimed: false }, now)).toBe('עוד לא התחבר/ה');
    expect(presenceLabel({ lastSeenAt: null, claimed: true }, now)).toBe('אין נתון נוכחות');
  });

  it('search matches any identifying detail, every word required', () => {
    const f = levi();
    for (const q of ['לוי', 'abc123', 'דנה', 'רקסי', 'dana@', 'יואב', 'לוי רקסי']) expect(matchesPresenceSearch(f, q)).toBe(true);
    expect(matchesPresenceSearch(f, 'לוי כהן')).toBe(false);
    expect(matchesPresenceSearch(f, '  ')).toBe(true);
  });
});

describe('migration 20261102150000 — presence for the verified System Admin only', () => {
  const sql = fs.readFileSync(path.resolve(__dirname, '../../../supabase/migrations/20261102150000_system_admin_presence.sql'), 'utf8');

  it('is read-only, hardened and re-checks the System Admin on the server', () => {
    expect(sql).toContain("security definer set search_path = ''");
    expect(sql).toContain('if auth.uid() is null or not public.is_verified_system_admin() then');
    expect(sql).toContain('revoke all on function public.system_admin_list_presence() from public, anon;');
    expect(sql).not.toMatch(/\b(insert into|update public\.|delete from|create table)\b/i);
  });

  it('returns the identifying details for every family', () => {
    for (const key of ["'invite_code'", "'admin_names'", "'dog_names'", "'verified_email'", "'last_seen_at'", "'members'"]) expect(sql).toContain(key);
  });
});

describe('console wiring', () => {
  const admin = fs.readFileSync(path.resolve(__dirname, '../../screens/SystemAdminScreen.tsx'), 'utf8');
  it('offers "🟢 מי אונליין" and identifies families in the activity log beyond their name', () => {
    expect(admin).toContain('🟢 מי אונליין');
    expect(admin).toContain('<SystemAdminPresencePanel />');
    expect(admin).toContain('familyIdentityById.get(entry.familyId)');
  });
});
