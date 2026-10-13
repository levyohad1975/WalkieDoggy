import { supabase, SupabaseNotConfiguredError } from './supabase';

/**
 * Thin client wrapper over the migration-0007 `set_member_role` RPC
 * (supabase/migrations/0007_multi_admin_roles.sql). Deliberately
 * Supabase-only and NEVER routed through Repository/OfflineFirstRepository's
 * SyncQueue, for the same reason lib/requests.ts's approval RPCs aren't:
 * this is an approval-sensitive, server-authoritative admin action (every
 * real authorization/last-admin check happens inside the RPC, re-verified
 * fresh against auth.uid() every call) — queuing it as "already applied"
 * offline could show a false success for a role change that never actually
 * took effect server-side. In local/demo mode (no Supabase configured) this
 * throws SupabaseNotConfiguredError; calling UI should catch that and show a
 * clear "not available in demo mode" message, matching every other
 * Supabase-only workflow in this app (see lib/requests.ts's doc comment).
 */
function requireSupabase() {
  if (!supabase) throw new SupabaseNotConfiguredError();
  return supabase;
}

export type FamilyRole = 'admin' | 'member';

/** Promotes/demotes a family member. Throws on failure — see set_member_role()'s server-side checks (admin-only, active member, last-admin protection) in 0007. */
export async function setMemberRole(userId: string, role: FamilyRole): Promise<void> {
  const client = requireSupabase();
  const { error } = await client.rpc('set_member_role', { p_user_id: userId, p_role: role });
  if (error) throw error;
}
