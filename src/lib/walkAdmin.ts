import { supabase, SupabaseNotConfiguredError } from './supabase';

/**
 * BATCH 3 — Task 6: thin client wrapper for admin_reschedule_walk()
 * (supabase/migrations/0026_admin_reschedule_walk.sql).
 *
 * Deliberately a SEPARATE file from lib/requests.ts: that file is
 * specifically the Member-initiated request/approval workflows (create/
 * approve/reject swap or time-change). This is the opposite thing — a
 * Family Admin's DIRECT edit of a walk's scheduled time, with no request
 * row and no approval step. Keeping them in different files makes that
 * distinction hard to blur by accident (see this migration's own doc
 * comment for the full "request vs. direct edit" reasoning).
 *
 * Like every other approval-sensitive/admin RPC wrapper in this codebase,
 * this is Supabase-only: in local/demo mode it throws
 * SupabaseNotConfiguredError, and the caller (scheduleStore.rescheduleWalk)
 * falls back to its existing local-repository behavior instead.
 */
function requireSupabase() {
  if (!supabase) throw new SupabaseNotConfiguredError();
  return supabase;
}

/**
 * Server-authoritative direct time edit for a pending walk. Authorization
 * (Family Admin, not currently impersonating) is enforced entirely inside
 * the RPC via is_family_admin() — never trust a client-side admin flag.
 */
export async function adminRescheduleWalk(walkId: string, newTime: string): Promise<void> {
  const client = requireSupabase();
  const { error } = await client.rpc('admin_reschedule_walk', { p_walk_id: walkId, p_new_time: newTime });
  if (error) throw error;
}

/**
 * Server-authoritative direct mutual swap of two pending walks.
 * This is an Admin action, not the member request/approval workflow.
 * Authorization and atomicity are enforced by admin_swap_walks() on the server.
 */
export async function adminSwapWalks(walkAId: string, walkBId: string): Promise<void> {
  const client = requireSupabase();
  const { error } = await client.rpc('admin_swap_walks', {
    p_walk_a_id: walkAId,
    p_walk_b_id: walkBId,
  });
  if (error) throw error;
}
