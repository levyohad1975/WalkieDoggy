import { supabase, SupabaseNotConfiguredError } from './supabase';

export type ChatAccessReason = 'support' | 'incident' | 'policy_review';
export interface AdminChatFamily { id: string; name: string; status: string }
export interface AdminChatConversation {
  id: string; kind: 'family' | 'direct' | 'group'; title: string | null; created_at: string; last_message_at: string | null;
  participants: Array<{ id: string; name: string }>;
}
export interface AdminChatMessage {
  id: string; created_at: string; sender_user_id: string | null; sender_name: string | null;
  deleted_at: string | null; body: string | null; attachment_mime: string | null;
}
function client() { if (!supabase) throw new SupabaseNotConfiguredError(); return supabase; }
export async function listAdminChatFamilies(search: string, offset = 0): Promise<AdminChatFamily[]> {
  const { data, error } = await client().rpc('system_admin_list_chat_families', { p_search: search.trim() || null, p_limit: 100, p_offset: offset });
  if (error) throw error; return (data ?? []) as AdminChatFamily[];
}
export async function listAdminFamilyChats(familyId: string): Promise<AdminChatConversation[]> {
  const { data, error } = await client().rpc('system_admin_list_family_chats', { p_family_id: familyId });
  if (error) throw error; return (data ?? []) as AdminChatConversation[];
}
export async function readAdminChatMessages(args: { familyId: string; conversationId: string; reason: ChatAccessReason; before?: AdminChatMessage | null }): Promise<AdminChatMessage[]> {
  const { data, error } = await client().rpc('system_admin_read_chat_messages', {
    p_family_id: args.familyId, p_conversation_id: args.conversationId, p_reason: args.reason,
    p_before_created_at: args.before?.created_at ?? null, p_before_id: args.before?.id ?? null, p_limit: 40,
  });
  if (error) throw error; return (data ?? []) as AdminChatMessage[];
}
export async function getAdminChatAttachment(args: { familyId: string; conversationId: string; messageId: string; reason: ChatAccessReason }): Promise<string> {
  const { data, error } = await client().functions.invoke('system-admin-chat-attachment', { body: {
    familyId: args.familyId, conversationId: args.conversationId, messageId: args.messageId, reason: args.reason,
  } });
  if (error) throw error;
  if (typeof data?.signedUrl !== 'string') throw new Error('attachment unavailable');
  return data.signedUrl;
}
