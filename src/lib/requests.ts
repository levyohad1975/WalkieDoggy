import { supabase, SupabaseNotConfiguredError } from './supabase';

/**
 * Thin client wrappers over the migration-0005 request/audit/presence RPCs
 * and their backing tables (supabase/migrations/0005_requests_audit_presence.sql).
 *
 * Deliberately Supabase-only: these are the NEW approval-sensitive
 * workflows (requirements 2/3/12/13), and per requirement 16 ("server
 * result is authoritative"), they must never be simulated locally or queued
 * through SyncQueue as if already applied — a queued "approved" write could
 * show a member an approval that never actually happened server-side. In
 * local/demo mode (no Supabase configured) every function here throws
 * SupabaseNotConfiguredError, and calling UI is expected to catch that and
 * show a clear "not available in demo mode" message rather than pretend to
 * approve/reject anything.
 */

export interface SwapRequestRow {
  id: string;
  family_id: string;
  walk_id: string;
  requested_by_user_id: string;
  target_user_id: string;
  target_walk_id: string | null;
  status: 'pending' | 'approved' | 'rejected';
  created_at: string;
  resolved_at: string | null;
  requester_seen_at: string | null;
  /** Snapshot of both walks at request-creation time (migration 0018) — approve_swap_request()
   *  re-validates the live walks against these before approving; computeRequestLifecycle()
   *  mirrors that same check so a stale request stops showing as actionable before the user
   *  taps approve and hits the server's rejection instead. */
  expected_responsible_user_id: string;
  expected_scheduled_time: string;
  expected_target_responsible_user_id: string | null;
  expected_target_scheduled_time: string | null;
}

export interface TimeChangeRequestRow {
  id: string;
  family_id: string;
  walk_id: string;
  requested_by_user_id: string;
  proposed_time: string;
  expected_time: string;
  status: 'pending' | 'approved' | 'rejected';
  created_at: string;
  resolved_at: string | null;
  requester_seen_at: string | null;
}

export interface FamilyActivityRow {
  user_id: string;
  name: string;
  avatar: string;
  role: 'admin' | 'member';
  removed_at: string | null;
  last_seen_at: string | null;
}

export interface AuditLogRow {
  id: string;
  actor_user_id: string | null;
  actor_name: string | null;
  action: string;
  target_type: string | null;
  target_id: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
}

function requireSupabase() {
  if (!supabase) throw new SupabaseNotConfiguredError();
  return supabase;
}

// ---- Swap requests (Member -> Member approval) ----

export async function createSwapRequest(walkId: string, targetWalkId: string): Promise<string> {
  const client = requireSupabase();
  const { data, error } = await client.rpc('create_swap_request', { p_walk_id: walkId, p_target_walk_id: targetWalkId });
  if (error) throw error;
  return data as string;
}

export async function approveSwapRequest(requestId: string): Promise<void> {
  const client = requireSupabase();
  const { error } = await client.rpc('approve_swap_request', { p_request_id: requestId });
  if (error) throw error;
}

export async function rejectSwapRequest(requestId: string): Promise<void> {
  const client = requireSupabase();
  const { error } = await client.rpc('reject_swap_request', { p_request_id: requestId });
  if (error) throw error;
}

/** Every swap request the current device can see per RLS: ones it created, ones addressed to it, or (admin) any in the family. */
export async function listSwapRequests(): Promise<SwapRequestRow[]> {
  const client = requireSupabase();
  const { data, error } = await client.from('walk_swap_requests').select('*').order('created_at', { ascending: false });
  if (error) throw error;
  return (data ?? []) as SwapRequestRow[];
}

// ---- Time-change requests (Member -> Admin approval) ----

export async function createTimeChangeRequest(walkId: string, proposedTime: string): Promise<string> {
  const client = requireSupabase();
  const { data, error } = await client.rpc('create_time_change_request', { p_walk_id: walkId, p_proposed_time: proposedTime });
  if (error) throw error;
  return data as string;
}

export async function approveTimeChangeRequest(requestId: string): Promise<void> {
  const client = requireSupabase();
  const { error } = await client.rpc('approve_time_change_request', { p_request_id: requestId });
  if (error) throw error;
}

export async function rejectTimeChangeRequest(requestId: string): Promise<void> {
  const client = requireSupabase();
  const { error } = await client.rpc('reject_time_change_request', { p_request_id: requestId });
  if (error) throw error;
}

/** Every time-change request the current device can see per RLS: ones it created, or (admin) any in the family. */
export async function listTimeChangeRequests(): Promise<TimeChangeRequestRow[]> {
  const client = requireSupabase();
  const { data, error } = await client.from('time_change_requests').select('*').order('created_at', { ascending: false });
  if (error) throw error;
  return (data ?? []) as TimeChangeRequestRow[];
}


/**
 * Marks every recent approved/rejected request CREATED BY the current real
 * profile as seen. Authorization and requester identity are derived entirely
 * server-side; the client cannot mark another member's results as read.
 */
export async function markMyRequestResultsSeen(): Promise<void> {
  const client = requireSupabase();
  const { error } = await client.rpc('mark_my_request_results_seen');
  if (error) throw error;
}

// ---- Presence ----

/**
 * Records "this device is active now" for the caller's own claimed profile.
 * Deliberately fire-and-forget from the caller's point of view — a failure
 * here (e.g. offline) must never interrupt anything else the app is doing,
 * so callers should invoke this without awaiting/blocking UI on it and are
 * expected to swallow errors themselves (see App.tsx's foreground hook).
 */
export async function touchLastSeen(): Promise<void> {
  if (!supabase) return; // presence is a nice-to-have, not a hard requirement in demo mode
  const { error } = await supabase.rpc('touch_last_seen');
  if (error) throw error;
}

export async function adminListFamilyActivity(): Promise<FamilyActivityRow[]> {
  const client = requireSupabase();
  const { data, error } = await client.rpc('admin_list_family_activity');
  if (error) throw error;
  return (data ?? []) as FamilyActivityRow[];
}

// ---- Audit log ----

export async function adminListAuditLog(limit = 50, offset = 0): Promise<AuditLogRow[]> {
  const client = requireSupabase();
  const { data, error } = await client.rpc('admin_list_audit_log', { p_limit: limit, p_offset: offset });
  if (error) throw error;
  return (data ?? []) as AuditLogRow[];
}
