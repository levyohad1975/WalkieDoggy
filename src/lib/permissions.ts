import { supabase, SupabaseNotConfiguredError } from './supabase';
import type { MemberPermissionOverride, PermissionKey } from '../logic/permissions';

/**
 * Thin client wrappers over the migration-0023 member_permission_overrides
 * table and its admin-gated RPCs (set_member_permission_override /
 * clear_member_permission_override). Mirrors lib/family.ts's
 * setMemberRole() pattern exactly: Supabase-only (throws
 * SupabaseNotConfiguredError in local/demo mode — there is no
 * per-member-permission concept there, every local/demo member simply gets
 * the role default), and never routed through Repository/SyncQueue — every
 * real authorization check (Family Admin, active member, known
 * permission_key) happens inside the RPCs themselves, re-verified fresh
 * against auth.uid() every call, so this must never be simulated offline.
 */
function requireSupabase() {
  if (!supabase) throw new SupabaseNotConfiguredError();
  return supabase;
}

interface MemberPermissionOverrideRow {
  user_id: string;
  permission_key: PermissionKey;
  allowed: boolean;
}

/**
 * Every override row the current device can see per RLS (0023): its own
 * user's rows, or — for a Family Admin — every row in the family. A raw
 * `.from(...).select(...)` call, not a dedicated RPC: the same established
 * pattern lib/requests.ts already uses for listSwapRequests/
 * listTimeChangeRequests, safe here because 0023's own select policy
 * ("family_id = current_family_id() and (user_id = current_profile_id() or
 * is_family_admin(family_id))") already scopes the result correctly server-
 * side — there is nothing this query could over-fetch.
 */
export async function listMemberPermissionOverrides(): Promise<MemberPermissionOverride[]> {
  const client = requireSupabase();
  const { data, error } = await client
    .from('member_permission_overrides')
    .select('user_id, permission_key, allowed');
  if (error) throw error;
  return ((data ?? []) as MemberPermissionOverrideRow[]).map((row) => ({
    userId: row.user_id,
    permissionKey: row.permission_key,
    allowed: row.allowed,
  }));
}

/** Sets (or replaces) one member's explicit permission override. Family-Admin-only — enforced server-side in set_member_permission_override (0023). */
export async function setMemberPermissionOverride(
  userId: string,
  permissionKey: PermissionKey,
  allowed: boolean
): Promise<void> {
  const client = requireSupabase();
  const { error } = await client.rpc('set_member_permission_override', {
    p_user_id: userId,
    p_permission_key: permissionKey,
    p_allowed: allowed,
  });
  if (error) throw error;
}

/** Clears a member's override, reverting that permission back to the role default. Family-Admin-only — enforced server-side in clear_member_permission_override (0023). */
export async function clearMemberPermissionOverride(userId: string, permissionKey: PermissionKey): Promise<void> {
  const client = requireSupabase();
  const { error } = await client.rpc('clear_member_permission_override', {
    p_user_id: userId,
    p_permission_key: permissionKey,
  });
  if (error) throw error;
}
