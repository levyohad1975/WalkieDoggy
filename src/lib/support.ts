/**
 * In-app support requests (migration 20261102160000_support_tickets and the
 * support-notify Edge Function). Families send and read their own requests;
 * the verified System Admin lists, replies and closes them. Every RPC is
 * re-authorized on the server.
 */
import { Platform } from 'react-native';
import { supabase, SupabaseNotConfiguredError } from './supabase';

export type SupportTopic = 'bug' | 'question' | 'idea';
export type SupportStatus = 'open' | 'answered' | 'closed';

export const SUPPORT_TOPICS: Array<{ id: SupportTopic; label: string }> = [
  { id: 'bug', label: '🐞 תקלה' },
  { id: 'question', label: '❓ שאלה' },
  { id: 'idea', label: '💡 הצעה' },
];

export interface MySupportTicket {
  id: string;
  topic: SupportTopic;
  body: string;
  status: SupportStatus;
  adminReply: string | null;
  repliedAt: string | null;
  replyUnread: boolean;
  createdAt: string;
}

export interface AdminSupportTicket {
  id: string;
  topic: SupportTopic;
  body: string;
  status: SupportStatus;
  context: Record<string, unknown>;
  adminReply: string | null;
  repliedAt: string | null;
  replySeenAt: string | null;
  createdAt: string;
  userName: string | null;
  familyId: string;
  familyName: string;
  inviteCode: string;
  verifiedEmail: string | null;
  adminNames: string[];
  dogNames: string[];
}

function client() {
  if (!supabase) throw new SupabaseNotConfiguredError();
  return supabase;
}

/** Device facts that help reproduce a problem; nothing personal. */
export function supportContext(screen: string): Record<string, unknown> {
  const g = globalThis as any;
  const ua: string = typeof g.navigator?.userAgent === 'string' ? g.navigator.userAgent : '';
  const device = /iPhone|iPad|iPod/i.test(ua) ? 'iPhone/iPad' : /Android/i.test(ua) ? 'Android' : Platform.OS === 'web' ? 'מחשב' : Platform.OS;
  const installed = g.navigator?.standalone === true
    || (typeof g.matchMedia === 'function' && g.matchMedia('(display-mode: standalone)')?.matches === true);
  return { platform: Platform.OS, device, installed, screen, ua: ua.slice(0, 160) };
}

export async function submitSupportTicket(topic: SupportTopic, body: string, screen = 'help'): Promise<string> {
  const { data, error } = await client().rpc('submit_support_ticket', { p_topic: topic, p_body: body.trim(), p_context: supportContext(screen) });
  if (error) throw error;
  const ticketId = data as string;
  // Best effort: the request is already saved even if the notification fails.
  void client().functions.invoke('support-notify', { body: { action: 'new_ticket', ticketId } }).catch(() => undefined);
  return ticketId;
}

export async function listMySupportTickets(): Promise<MySupportTicket[]> {
  if (!supabase) return [];
  const { data, error } = await supabase.rpc('list_my_support_tickets');
  if (error) throw error;
  return ((data ?? []) as any[]).map((t) => ({
    id: t.id, topic: t.topic, body: t.body, status: t.status, adminReply: t.admin_reply ?? null,
    repliedAt: t.replied_at ?? null, replyUnread: Boolean(t.reply_unread), createdAt: t.created_at,
  }));
}

export async function markMySupportRepliesSeen(): Promise<void> {
  if (!supabase) return;
  await supabase.rpc('mark_my_support_replies_seen');
}

export async function listAdminSupportTickets(status: SupportStatus | null): Promise<AdminSupportTicket[]> {
  const { data, error } = await client().rpc('system_admin_list_support_tickets', { p_status: status });
  if (error) throw error;
  return ((data ?? []) as any[]).map((t) => ({
    id: t.id, topic: t.topic, body: t.body, status: t.status, context: t.context ?? {},
    adminReply: t.admin_reply ?? null, repliedAt: t.replied_at ?? null, replySeenAt: t.reply_seen_at ?? null,
    createdAt: t.created_at, userName: t.user_name ?? null, familyId: t.family_id, familyName: t.family_name ?? '',
    inviteCode: t.invite_code ?? '', verifiedEmail: t.verified_email ?? null,
    adminNames: Array.isArray(t.admin_names) ? t.admin_names : [], dogNames: Array.isArray(t.dog_names) ? t.dog_names : [],
  }));
}

export async function replyToSupportTicket(ticketId: string, reply: string): Promise<void> {
  const { error } = await client().rpc('system_admin_reply_support_ticket', { p_id: ticketId, p_reply: reply.trim() });
  if (error) throw error;
  void client().functions.invoke('support-notify', { body: { action: 'reply', ticketId } }).catch(() => undefined);
}

export async function setSupportTicketStatus(ticketId: string, status: SupportStatus): Promise<void> {
  const { error } = await client().rpc('system_admin_set_support_ticket_status', { p_id: ticketId, p_status: status });
  if (error) throw error;
}

export function supportTopicLabel(topic: string): string {
  return SUPPORT_TOPICS.find((t) => t.id === topic)?.label ?? topic;
}

export function supportStatusLabel(status: string): string {
  return status === 'open' ? 'ממתינה לתשובה' : status === 'answered' ? 'נענתה' : status === 'closed' ? 'סגורה' : status;
}
