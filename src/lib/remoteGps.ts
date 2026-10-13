import { isSupabaseConfigured, supabase } from './supabase';

export interface RemoteGpsTarget { target_auth_user_id: string; target_user_id: string; display_name: string; device_label: string }
export interface RemoteGpsCommand { command_id: string; walk_id: string; status: 'pending'|'tracking'|'failed'|'expired'|'stopped'; expires_at: string }
export interface RemoteGpsWalkStatus { command_id: string; status: RemoteGpsCommand['status']; failure_reason: string|null; expires_at: string }

async function rpc<T>(name: string, args?: Record<string, unknown>): Promise<T> {
  if (!isSupabaseConfigured || !supabase) throw new Error('remote GPS requires a connected family');
  const { data, error } = await supabase.rpc(name, args ?? {});
  if (error) throw error;
  return data as T;
}
export const getRemoteGpsSettings = () => rpc<{familyEnabled:boolean;consentEnabled:boolean;isAdmin:boolean}>('get_remote_gps_settings');
export const setRemoteGpsConsent = (enabled: boolean) => rpc<void>('set_remote_gps_consent',{p_enabled:enabled});
export const setFamilyRemoteGpsEnabled = (enabled: boolean) => rpc<void>('set_family_remote_gps_enabled',{p_enabled:enabled});
export const listRemoteGpsTargets = (walkId: string) => rpc<RemoteGpsTarget[]>('list_remote_gps_target_devices',{p_walk_id:walkId});
export const requestRemoteGpsStart = (walkId: string,targetAuthUserId: string) => rpc<string>('request_remote_gps_device_start',{p_walk_id:walkId,p_target_auth_user_id:targetAuthUserId});
export const getMyRemoteGpsCommands = () => rpc<RemoteGpsCommand[]>('get_my_remote_gps_commands');
export const getRemoteGpsWalkStatus = (walkId: string) => rpc<RemoteGpsWalkStatus[]>('get_remote_gps_walk_status',{p_walk_id:walkId});
export const heartbeatRemoteGpsTracking = (commandId: string) => rpc<void>('heartbeat_remote_gps_tracking',{p_command_id:commandId});
export const acknowledgeRemoteGpsStart = (commandId: string,tracking: boolean,reason?: string) => rpc<void>('acknowledge_remote_gps_start',{p_command_id:commandId,p_tracking:tracking,p_reason:reason});
export const stopRemoteGpsTracking = (commandId: string) => rpc<void>('stop_remote_gps_tracking',{p_command_id:commandId});
export async function sendRemoteGpsNotification(commandId: string): Promise<void> {
  if (!supabase) return;
  const { error } = await supabase.functions.invoke('remote-gps-notify',{body:{commandId}});
  if (error) throw error;
}
