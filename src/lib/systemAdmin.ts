import { supabase, SupabaseNotConfiguredError } from './supabase';
import { repository } from '../data';

/**
 * BATCH 4 (item A — System Admin V1, read-only). Thin client wrappers over
 * migration 0029's two RPCs, mirroring every other Supabase-only module in
 * this repo (lib/invites.ts, lib/requests.ts, ...): all real authorization
 * (is_system_admin(), never trusting client-side UI hiding) lives
 * server-side inside the RPCs, never here. Supabase-only by construction —
 * System Admin has no meaning in local/demo mode.
 */

function requireSupabase() {
  if (!supabase) throw new SupabaseNotConfiguredError();
  return supabase;
}

export interface SystemAdminFamilyListItem {
  familyId: string;
  familyName: string;
  /** Distinguishing identifier — family names are NOT unique (Master Specification §1/§12); the invite code is. */
  inviteCode: string;
  createdAt: string;
  memberCount: number;
  adminNames: string[];
  dogName: string | null;
  status: string;
  verifiedEmail: string | null;
}

export interface SystemAdminTestFamily {
  familyId: string;
  familyName: string;
  inviteCode: string;
  createdAt: string;
  dogName: string | null;
}

function rowOrThrow<T>(data: T[] | T | null, message: string): T {
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) throw new Error(message);
  return row as T;
}

/**
 * Profile claims must not switch the audit actor while writes from the
 * currently active family are still queued. Drain and verify the queue
 * before the server changes this System Admin device's family context.
 * The server RPC remains the authorization boundary.
 */
export async function flushBeforeSystemAdminTestFamilySwitch(): Promise<void> {
  if (!repository.trySync || !repository.pendingSyncCount) {
    throw new Error('לא ניתן לוודא שהפעולות במכשיר סונכרנו, ולכן לא עברנו למשפחת הבדיקה.');
  }

  try {
    await repository.trySync();
    const pendingCount = await repository.pendingSyncCount();
    if (pendingCount > 0) {
      throw new Error(
        `לא ניתן לעבור למשפחת בדיקה: נותרו ${pendingCount} פעולות שממתינות לסנכרון. התחברו לאינטרנט והמתינו לסיום הסנכרון במשפחה הפעילה, ואז נסו שוב. המשפחה והנתונים לא שונו.`
      );
    }
  } catch (cause) {
    if (cause instanceof Error && /[\u0590-\u05FF]/.test(cause.message)) throw cause;
    throw new Error('לא הצלחנו לסנכרן את הפעולות במשפחה הפעילה. לא עברנו למשפחת הבדיקה; בדקו את החיבור ונסו שוב.');
  }
}

/** Creates an isolated QA family and snapshots the caller's current family/profile. */
export async function createSystemAdminTestFamily(familyName: string): Promise<SystemAdminTestFamily> {
  const client = requireSupabase();
  await flushBeforeSystemAdminTestFamilySwitch();
  const { data, error } = await client.rpc('system_admin_enter_test_family', { p_family_name: familyName.trim() });
  if (error) throw error;
  const row = rowOrThrow(data as Array<{ id: string; name: string; invite_code: string }> | null, 'יצירת משפחת הבדיקה נכשלה');
  return { familyId: row.id, familyName: row.name, inviteCode: row.invite_code, createdAt: new Date().toISOString(), dogName: null };
}

/** Re-enters an existing QA family without replacing the original membership snapshot. */
export async function switchToSystemAdminTestFamily(familyId: string): Promise<SystemAdminTestFamily> {
  const client = requireSupabase();
  await flushBeforeSystemAdminTestFamilySwitch();
  const { data, error } = await client.rpc('system_admin_switch_test_family', { p_family_id: familyId });
  if (error) throw error;
  const row = rowOrThrow(data as Array<{ id: string; name: string; invite_code: string }> | null, 'הכניסה למשפחת הבדיקה נכשלה');
  return { familyId: row.id, familyName: row.name, inviteCode: row.invite_code, createdAt: new Date().toISOString(), dogName: null };
}

export async function listSystemAdminTestFamilies(): Promise<SystemAdminTestFamily[]> {
  const client = requireSupabase();
  const { data, error } = await client.rpc('system_admin_list_test_families');
  if (error) throw error;
  return ((data ?? []) as Array<{ family_id: string; family_name: string; invite_code: string; created_at: string; dog_name: string | null }>).map((row) => ({
    familyId: row.family_id,
    familyName: row.family_name,
    inviteCode: row.invite_code,
    createdAt: row.created_at,
    dogName: row.dog_name,
  }));
}

export async function getActiveSystemAdminTestFamily(): Promise<{ familyId: string; familyName: string } | null> {
  const client = requireSupabase();
  const { data, error } = await client.rpc('system_admin_get_active_test_family');
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  return row?.family_id && row?.family_name ? { familyId: row.family_id, familyName: row.family_name } : null;
}

export async function deleteSystemAdminTestFamily(familyId: string): Promise<void> {
  const client = requireSupabase();
  const { data: photoRows, error: photoListError } = await client.rpc('system_admin_list_test_family_photo_paths', { p_family_id: familyId });
  if (photoListError) throw photoListError;
  const paths = ((photoRows ?? []) as Array<{ object_path: string }>).map((row) => row.object_path).filter(Boolean);
  for (let offset = 0; offset < paths.length; offset += 1000) {
    const { error } = await client.storage.from('family-photos').remove(paths.slice(offset, offset + 1000));
    if (error) throw error;
  }
  const { error } = await client.rpc('system_admin_delete_test_family', {
    p_family_id: familyId,
    p_confirm: 'DELETE TEST FAMILY',
  });
  if (error) throw error;
}

/** Leaves the active QA family and restores the original family/profile snapshot. */
export async function exitSystemAdminTestFamily(): Promise<{ id: string; name: string }> {
  const client = requireSupabase();
  const { data, error } = await client.rpc('system_admin_exit_test_family');
  if (error) throw error;
  const row = rowOrThrow(data as Array<{ id: string; name: string }> | null, 'החזרה למשפחה המקורית נכשלה');
  return row;
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
  family: { id: string; name: string; inviteCode: string; createdAt: string; approvalStatus: string } | null;
  dog: { id: string; name: string; photoUrl: string | null; sex: 'male' | 'female' | null; walksPerDay: number } | null;
  members: SystemAdminFamilyMember[];
  walks: SystemAdminWalkSummary[];
  activeRequests: SystemAdminActiveRequest[];
  recentAudit: SystemAdminAuditEntry[];
}

export interface SystemAdminGlobalAuditEntry {
  id: string;
  source: 'family_audit' | 'system_audit' | 'state_change';
  familyId: string | null;
  familyName: string | null;
  actorUserId: string | null;
  actorName: string | null;
  actorAuthUserId: string | null;
  actorEmail: string | null;
  action: string;
  targetType: string | null;
  targetId: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export interface SystemAdminEmailDeliveryLogEntry {
  id: string;
  familyId: string | null;
  authUserId: string | null;
  messageType: 'family_welcome' | 'system_owner_new_family';
  recipientEmail: string;
  provider: string;
  providerMessageId: string | null;
  status: string;
  error: string | null;
  createdAt: string;
  updatedAt: string;
}


export interface SystemAdminObserverSession {
  familyId: string;
  familyName: string;
  targetUserId: string | null;
}

export async function beginSystemAdminObserver(familyId: string): Promise<SystemAdminObserverSession> {
  const client = requireSupabase();
  const { data, error } = await client.rpc('begin_system_admin_observer', { p_family_id: familyId });
  if (error) throw error;
  const row = (data ?? {}) as { family_id?: string; family_name?: string; target_user_id?: string | null };
  if (!row.family_id || !row.family_name) throw new Error('observer session could not be established');
  return { familyId: row.family_id, familyName: row.family_name, targetUserId: row.target_user_id ?? null };
}

export async function endSystemAdminObserver(): Promise<void> {
  const client = requireSupabase();
  const { error } = await client.rpc('end_system_admin_observer');
  if (error) throw error;
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
  const { data, error } = await client.rpc('system_admin_list_families_v2', { p_search: search?.trim() || null });
  if (error) throw error;
  const rows = (data ?? []) as Array<{
    family_id: string;
    family_name: string;
    invite_code: string;
    created_at: string;
    member_count: number;
    admin_names: string[] | null;
    dog_name: string | null;
    status: string;
    verified_email: string | null;
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
    verifiedEmail: r.verified_email,
  }));
}

export async function getSystemAdminGlobalAudit(limit = 200): Promise<SystemAdminGlobalAuditEntry[]> {
  const client = requireSupabase();
  const { data, error } = await client.rpc('system_admin_list_global_audit', { p_limit: limit });
  if (error) throw error;
  const rows = (data ?? []) as Array<{
    event_id: string; source: 'family_audit' | 'system_audit' | 'state_change';
    family_id: string | null; family_name: string | null; actor_user_id: string | null;
    actor_name: string | null; actor_auth_user_id: string | null; actor_email: string | null;
    action: string; target_type: string | null; target_id: string | null;
    metadata: Record<string, unknown> | null; created_at: string;
  }>;
  return rows.map((r) => ({
    id: r.event_id, source: r.source, familyId: r.family_id, familyName: r.family_name,
    actorUserId: r.actor_user_id, actorName: r.actor_name, actorAuthUserId: r.actor_auth_user_id,
    actorEmail: r.actor_email, action: r.action, targetType: r.target_type, targetId: r.target_id,
    metadata: r.metadata ?? {}, createdAt: r.created_at,
  }));
}

/**
 * Wraps migration 0032's system_admin_set_family_approval(), the only
 * server-side way to move a family out of 'pending'/'rejected' into 'active'
 * (or vice versa into 'rejected'). Until this wrapper + its SystemAdminScreen
 * call site, this RPC was defined and granted but never called from any
 * client code — with AUTO_APPROVE_NEW_FAMILIES=false a pending family had no
 * in-app path to ever become active. Throws (never silently no-ops) on a
 * denial or an invalid target status, matching every other RPC wrapper here.
 */
export async function setSystemAdminFamilyApproval(
  familyId: string,
  approvalStatus: 'active' | 'rejected'
): Promise<void> {
  const client = requireSupabase();
  const { error } = await client.rpc('system_admin_set_family_approval', {
    p_family_id: familyId,
    p_approval_status: approvalStatus,
  });
  if (error) throw error;
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
 * Migration 0034's read-only counterpart to record_email_delivery_attempt()/
 * update_email_delivery_status() (both service-role-only, called from the
 * Edge Function and the Resend webhook function respectively) — this is the
 * "admin-gated read RPC" 0034's own table comment refers to as the only
 * client-reachable way to see email_delivery_log. p_limit is clamped
 * server-side to [1, 200]; omit to get the server's own default of 50.
 */
export async function getSystemAdminEmailDeliveryLog(limit?: number): Promise<SystemAdminEmailDeliveryLogEntry[]> {
  const client = requireSupabase();
  const { data, error } = await client.rpc('system_admin_list_email_delivery_log', { p_limit: limit ?? null });
  if (error) throw error;
  const rows = (data ?? []) as Array<{
    id: string;
    family_id: string | null;
    auth_user_id: string | null;
    message_type: 'family_welcome' | 'system_owner_new_family';
    recipient_email: string;
    provider: string;
    provider_message_id: string | null;
    status: string;
    error: string | null;
    created_at: string;
    updated_at: string;
  }>;
  return rows.map((r) => ({
    id: r.id,
    familyId: r.family_id,
    authUserId: r.auth_user_id,
    messageType: r.message_type,
    recipientEmail: r.recipient_email,
    provider: r.provider,
    providerMessageId: r.provider_message_id,
    status: r.status,
    error: r.error,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  }));
}
