/**
 * New-device approval (migration 20261103120000_device_access_requests and
 * the device-access-notify Edge Function). A family member's new device
 * (typically the iPhone home-screen shortcut, which keeps storage separate
 * from Safari) asks to be signed into a profile that is already signed in
 * elsewhere; a family admin approves it with one tap. Every RPC is
 * re-authorized on the server.
 */
import { supabase, SupabaseNotConfiguredError } from './supabase';
import { supportContext } from './support';

export type DeviceAccessStatus = 'pending' | 'approved' | 'rejected' | 'expired';

export interface DeviceAccessRequestState {
  id: string;
  targetUserId: string;
  status: DeviceAccessStatus;
}

export interface AdminDeviceAccessRequest {
  id: string;
  targetUserId: string;
  targetName: string;
  targetAvatar: string | null;
  device: string | null;
  createdAt: string;
}

/** How often the waiting device checks whether the admin decided. */
export const DEVICE_ACCESS_POLL_MS = 4000;

function client() {
  if (!supabase) throw new SupabaseNotConfiguredError();
  return supabase;
}

export async function requestDeviceAccess(targetUserId: string): Promise<string> {
  const context = supportContext('login');
  const { data, error } = await client().rpc('request_device_access', {
    p_target_user_id: targetUserId,
    p_context: { device: context.device, installed: context.installed },
  });
  if (error) throw error;
  const requestId = data as string;
  // Best effort: the request is saved and visible to the admin in the app
  // even if the push fails.
  void client().functions.invoke('device-access-notify', { body: { requestId } }).catch(() => undefined);
  return requestId;
}

export async function getMyDeviceAccessRequest(requestId: string): Promise<DeviceAccessRequestState | null> {
  const { data, error } = await client().rpc('get_my_device_access_request', { p_id: requestId });
  if (error) throw error;
  if (!data) return null;
  const r = data as any;
  return { id: r.id, targetUserId: r.target_user_id, status: r.status };
}

export async function listAdminDeviceAccessRequests(): Promise<AdminDeviceAccessRequest[]> {
  if (!supabase) return [];
  const { data, error } = await supabase.rpc('admin_list_device_access_requests');
  if (error) throw error;
  return ((data ?? []) as any[]).map((r) => ({
    id: r.id,
    targetUserId: r.target_user_id,
    targetName: r.target_name ?? '',
    targetAvatar: r.target_avatar ?? null,
    device: typeof r.context?.device === 'string' ? r.context.device : null,
    createdAt: r.created_at,
  }));
}

export async function decideDeviceAccessRequest(requestId: string, approve: boolean): Promise<void> {
  const { error } = await client().rpc('admin_decide_device_access_request', { p_id: requestId, p_approve: approve });
  if (error) throw error;
}

/** True for claimFamilyProfile()'s "signed in on another device" rejection. */
export function isProfileClaimedElsewhereError(err: unknown): boolean {
  const message = err instanceof Error ? err.message
    : err && typeof err === 'object' && 'message' in err ? String((err as { message?: unknown }).message ?? '') : String(err ?? '');
  return message.includes('profile already claimed by another device');
}
