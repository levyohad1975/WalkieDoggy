import { supabase, SupabaseNotConfiguredError } from './supabase';

/**
 * System Admin client wrappers. Read operations come from migration 0029;
 * the narrowly scoped family-approval mutation comes from migration 0032.
 * This mirrors every other Supabase-only module in
 * this repo (lib/invites.ts, lib/requests.ts, ...): all real authorization
 * (is_system_admin(), never trusting client-side UI hiding) lives
 * server-side inside the RPCs, never here. Supabase-only by construction —
 * System Admin has no meaning in local/demo mode.
 */

function requireSupabase() {
  if (!supabase) throw new SupabaseNotConfiguredError();
  return supabase;
}

export type SystemAdminFamilyApprovalStatus = 'pending' | 'active' | 'rejected';

export interface SystemAdminFamilyListItem {
  familyId: string;
  familyName: string;
  /** Distinguishing identifier — family names are NOT unique (Master Specification §1/§12); the invite code is. */
  inviteCode: string;
  createdAt: string;
  memberCount: number;
  adminNames: string[];
  dogName: string | null;
  status: SystemAdminFamilyApprovalStatus;
}

export interface SystemAdminFamilyMember {
  id: string;
  name: string;
  avatar: string;
  photoUrl: string | null;
  role: 'admin' | 'member';
  removedAt: string | null;
  claimed: boolean;
}

export interface SystemAdminWalkSummary {
  id: string;
  date: string;
  scheduledTime: string;
  status: 'pending' | 'done' | 'skipped';
  responsibleUserId: string;
  completedAt: string | null;
  isUnplanned: boolean;
}

export type SystemAdminActiveRequest =
  | { kind: 'swap'; id: string; walkId: string; requestedByUserId: string; targetUserId: string; status: string; createdAt: string }
  | { kind: 'time_change'; id: string; walkId: string; requestedByUserId: string; proposedTime: string; status: string; createdAt: string };

export interface SystemAdminAuditEntry {
  id: string;
  action: string;
  targetType: string | null;
  targetId: string | null;
  createdAt: string;
}

export interface SystemAdminFamilyDetail {
  family: { id: string; name: string; inviteCode: string; createdAt: string } | null;
  dog: { id: string; name: string; photoUrl: string | null; sex: 'male' | 'female' | null; walksPerDay: number } | null;
  members: SystemAdminFamilyMember[];
  walks: SystemAdminWalkSummary[];
  activeRequests: SystemAdminActiveRequest[];
  recentAudit: SystemAdminAuditEntry[];
}

/**
 * Safe to call for ANY authenticated session — resolves the caller's own
 * System Admin status only (never anyone else's), used to decide whether to
 * show the "🛡️ ניהול מערכת" entry point at all. UI hiding based on this is
 * never the authorization boundary — every RPC below re-checks
 * is_system_admin() itself.
 */
export async function checkIsSystemAdmin(): Promise<boolean> {
  const client = requireSupabase();
  const { data, error } = await client.rpc('am_i_system_admin');
  if (error) throw error;
  return data === true;
}

export async function listSystemAdminFamilies(search?: string): Promise<SystemAdminFamilyListItem[]> {
  const client = requireSupabase();
  const { data, error } = await client.rpc('system_admin_list_families', { p_search: search?.trim() || null });
  if (error) throw error;
  const rows = (data ?? []) as Array<{
    family_id: string;
    family_name: string;
    invite_code: string;
    created_at: string;
    member_count: number;
    admin_names: string[] | null;
    dog_name: string | null;
    status: SystemAdminFamilyApprovalStatus;
  }>;
  return rows.map((r) => ({
    familyId: r.family_id,
    familyName: r.family_name,
    inviteCode: r.invite_code,
    createdAt: r.created_at,
    memberCount: r.member_count,
    adminNames: r.admin_names ?? [],
    dogName: r.dog_name,
    status: r.status,
  }));
}

export async function getSystemAdminFamilyDetail(familyId: string): Promise<SystemAdminFamilyDetail> {
  const client = requireSupabase();
  const { data, error } = await client.rpc('system_admin_get_family_detail', { p_family_id: familyId });
  if (error) throw error;
  const detail = (data ?? {}) as Partial<SystemAdminFamilyDetail>;
  return {
    family: detail.family ?? null,
    dog: detail.dog ?? null,
    members: detail.members ?? [],
    walks: detail.walks ?? [],
    activeRequests: detail.activeRequests ?? [],
    recentAudit: detail.recentAudit ?? [],
  };
}


/**
 * Approves or rejects a pending family request. System-Admin-only — the
 * server derives the caller from auth.uid() and re-checks is_system_admin().
 * This is intentionally live/server-authoritative and is never queued.
 */
export async function setSystemAdminFamilyApproval(
  familyId: string,
  approvalStatus: Exclude<SystemAdminFamilyApprovalStatus, 'pending'>
): Promise<void> {
  const client = requireSupabase();
  const { error } = await client.rpc('system_admin_set_family_approval', {
    p_family_id: familyId,
    p_approval_status: approvalStatus,
  });
  if (error) throw error;
}
