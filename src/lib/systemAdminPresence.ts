/**
 * System Admin "🟢 מי אונליין" (migration 20261102150000_system_admin_presence).
 * Read-only; the server re-checks is_verified_system_admin() on every call.
 */
import { supabase, SupabaseNotConfiguredError } from './supabase';
import { describePresence } from '../logic/presence';

export interface PresenceMember {
  userId: string;
  name: string;
  avatar: string | null;
  role: string | null;
  claimed: boolean;
  lastSeenAt: string | null;
}

export interface PresenceFamily {
  familyId: string;
  familyName: string;
  inviteCode: string;
  status: string;
  createdAt: string;
  verifiedEmail: string | null;
  adminNames: string[];
  dogNames: string[];
  lastSeenAt: string | null;
  members: PresenceMember[];
}

export async function listSystemAdminPresence(): Promise<PresenceFamily[]> {
  if (!supabase) throw new SupabaseNotConfiguredError();
  const client = supabase;
  const { data, error } = await client.rpc('system_admin_list_presence');
  if (error) throw error;
  const rows = (data ?? []) as Array<any>;
  return rows.map((f) => ({
    familyId: f.family_id,
    familyName: f.family_name ?? '',
    inviteCode: f.invite_code ?? '',
    status: f.status ?? '',
    createdAt: f.created_at,
    verifiedEmail: f.verified_email ?? null,
    adminNames: Array.isArray(f.admin_names) ? f.admin_names : [],
    dogNames: Array.isArray(f.dog_names) ? f.dog_names : [],
    lastSeenAt: f.last_seen_at ?? null,
    members: (Array.isArray(f.members) ? f.members : []).map((m: any) => ({
      userId: m.user_id,
      name: m.name ?? '',
      avatar: m.avatar ?? null,
      role: m.role ?? null,
      claimed: Boolean(m.claimed),
      lastSeenAt: m.last_seen_at ?? null,
    })),
  }));
}

/**
 * Details that tell two same-named families apart (owner request: "10
 * families named לוי"). Used by the presence list and the activity log.
 */
export function familyIdentityParts(f: { inviteCode?: string | null; adminNames?: string[]; dogNames?: string[]; verifiedEmail?: string | null }): string[] {
  const parts: string[] = [];
  if (f.inviteCode) parts.push(`קוד ${f.inviteCode}`);
  if (f.adminNames && f.adminNames.length > 0) parts.push(`מנהל/ת: ${f.adminNames.join(', ')}`);
  if (f.dogNames && f.dogNames.length > 0) parts.push(`כלב: ${f.dogNames.join(', ')}`);
  if (f.verifiedEmail) parts.push(f.verifiedEmail);
  return parts;
}

export function isOnline(lastSeenAt: string | null, now: Date = new Date()): boolean {
  return describePresence(lastSeenAt, now).active;
}

/** "פעיל עכשיו" / "נראה לפני 12 דק׳" / "נראה היום ב-09:40" / "נראה ב-28/10" / never. */
export function presenceLabel(member: Pick<PresenceMember, 'lastSeenAt' | 'claimed'>, now: Date = new Date()): string {
  const described = describePresence(member.lastSeenAt, now);
  if (described.label) return described.label;
  if (member.lastSeenAt) {
    const seen = new Date(member.lastSeenAt);
    if (!Number.isNaN(seen.getTime())) return `נראה ב-${seen.getDate()}/${seen.getMonth() + 1}/${String(seen.getFullYear()).slice(2)}`;
  }
  return member.claimed ? 'אין נתון נוכחות' : 'עוד לא התחבר/ה';
}

/** Free-text match over everything that identifies a family or a member. */
export function matchesPresenceSearch(f: PresenceFamily, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const haystack = [f.familyName, f.inviteCode, f.verifiedEmail ?? '', ...f.adminNames, ...f.dogNames, ...f.members.map((m) => m.name)]
    .join(' ')
    .toLowerCase();
  return q.split(/\s+/).every((word) => haystack.includes(word));
}
