// supabase/functions/support-notify/index.ts
//
// Notifications for in-app support requests (migration
// 20261102160000_support_tickets.sql).
//
//   { action: 'new_ticket', ticketId } — called by the sender right after
//     submit_support_ticket(). claim_support_ticket_admin_notice() runs AS
//     THE CALLER and returns the request only if the caller sent it, it is
//     fresh, and it was not announced yet. The System Admin then gets an
//     email (SYSTEM_OWNER_EMAIL, via Resend) and a Web Push on every device
//     signed in with a System Admin account.
//
//   { action: 'reply', ticketId } — called by the console after
//     system_admin_reply_support_ticket(). claim_support_reply_notice()
//     re-checks the verified System Admin and returns the recipient profile
//     once per reply. That profile's devices get a Web Push.
//
// The request body carries only an id; every name, text and recipient is
// read from the database.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import webpush from 'npm:web-push@3.6.7';

const VAPID_PUBLIC_KEY = Deno.env.get('VAPID_PUBLIC_KEY') ?? '';
const VAPID_PRIVATE_KEY = Deno.env.get('VAPID_PRIVATE_KEY') ?? '';
const VAPID_SUBJECT = Deno.env.get('VAPID_SUBJECT') ?? 'https://walkielink.co.il';
if (VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY) {
  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TOPIC_LABEL: Record<string, string> = { bug: '🐞 תקלה', question: '❓ שאלה', idea: '💡 הצעה' };

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'content-type': 'application/json' } });
}

function escapeHtml(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#039;');
}

function preview(text: string, max = 120): string {
  const chars = Array.from(text.replace(/\s+/g, ' ').trim());
  return chars.length > max ? `${chars.slice(0, max - 1).join('')}…` : chars.join('');
}

type WebSub = { id: string; endpoint: string; p256dh: string; auth: string };

async function pushTo(serviceClient: ReturnType<typeof createClient>, subs: WebSub[], payload: Record<string, unknown>) {
  if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY || subs.length === 0) return { sent: 0, failed: 0 };
  const unique = [...new Map(subs.map((s) => [s.endpoint, s])).values()];
  let sent = 0;
  let failed = 0;
  await Promise.allSettled(unique.map(async (sub) => {
    try {
      await webpush.sendNotification({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } }, JSON.stringify(payload));
      sent += 1;
    } catch (error: any) {
      failed += 1;
      const status = error?.statusCode ?? null;
      // Gone, or created with an old key: this subscription can never deliver again.
      const permanent = status === 404 || status === 410 || (status === 400 && /VapidPkHashMismatch/i.test(String(error?.body ?? '')));
      await serviceClient.from('web_push_subscriptions')
        .update({ is_active: !permanent, last_error: String(error?.message ?? error).slice(0, 300), updated_at: new Date().toISOString() })
        .eq('id', sub.id);
    }
  }));
  return { sent, failed };
}

async function emailOwner(ticket: Record<string, any>): Promise<boolean> {
  const apiKey = Deno.env.get('RESEND_API_KEY') ?? '';
  const from = Deno.env.get('WELCOME_EMAIL_FROM') ?? '';
  const to = (Deno.env.get('SYSTEM_OWNER_EMAIL') ?? '').trim();
  if (!apiKey || !from || !to) return false;
  const topic = TOPIC_LABEL[ticket.topic] ?? ticket.topic;
  const context = ticket.context && typeof ticket.context === 'object' ? ticket.context : {};
  const lines = [
    ['נושא', topic],
    ['מאת', ticket.user_name ?? '—'],
    ['משפחה', `${ticket.family_name ?? '—'} · קוד ${ticket.invite_code ?? '—'}`],
    ['אימייל המשפחה', ticket.verified_email ?? '—'],
    ['מכשיר', [context.platform, context.device, context.installed ? 'מותקן' : null].filter(Boolean).join(' · ') || '—'],
  ];
  const html = `<div dir="rtl" style="font-family:sans-serif">
<h2>📨 פנייה חדשה — Walkie Doggy Link</h2>
<p style="white-space:pre-wrap;font-size:16px;background:#f5f1ea;padding:12px;border-radius:8px">${escapeHtml(String(ticket.body ?? ''))}</p>
<table>${lines.map(([k, v]) => `<tr><td style="color:#888;padding-left:12px">${escapeHtml(k)}</td><td>${escapeHtml(String(v))}</td></tr>`).join('')}</table>
<p>לתשובה: מסוף הניהול ← 📨 פניות.</p></div>`;
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from, to: [to], subject: `📨 פנייה חדשה: ${topic} · ${ticket.family_name ?? ''}`, html }),
  });
  if (!response.ok) console.error('support-notify email failed', response.status);
  return response.ok;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ ok: false, error: 'method not allowed' }, 405);
  try {
    const authHeader = req.headers.get('Authorization') ?? req.headers.get('authorization');
    if (!authHeader) return json({ ok: false, error: 'missing Authorization header' }, 401);
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const userClient = createClient(supabaseUrl, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: authHeader } } });
    const serviceClient = createClient(supabaseUrl, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

    let action: unknown;
    let ticketId: unknown;
    try {
      const body = await req.json();
      action = body?.action;
      ticketId = body?.ticketId;
    } catch {
      /* invalid body */
    }
    if (typeof ticketId !== 'string' || !UUID_PATTERN.test(ticketId)) return json({ ok: false, error: 'a valid ticketId is required' }, 400);

    if (action === 'new_ticket') {
      const { data: ticket, error } = await userClient.rpc('claim_support_ticket_admin_notice', { p_id: ticketId });
      if (error) throw error;
      if (!ticket) return json({ ok: true, notified: false, reason: 'not claimable' });
      const t = ticket as Record<string, any>;
      const { data: admins, error: adminError } = await serviceClient.from('system_admins').select('auth_user_id');
      if (adminError) throw adminError;
      const adminIds = (admins ?? []).map((a: any) => a.auth_user_id).filter(Boolean);
      const { data: subs, error: subError } = adminIds.length
        ? await serviceClient.from('web_push_subscriptions').select('id, endpoint, p256dh, auth').in('auth_user_id', adminIds).eq('is_active', true)
        : { data: [], error: null };
      if (subError) throw subError;
      const [emailed, push] = await Promise.all([
        emailOwner(t).catch((e) => { console.error('support-notify email error', e instanceof Error ? e.message : e); return false; }),
        pushTo(serviceClient, (subs ?? []) as WebSub[], {
          title: `📨 פנייה חדשה · ${t.family_name ?? ''}`,
          body: `${t.user_name ?? ''}: ${preview(String(t.body ?? ''))}`,
          tag: `support-${t.id}`,
          data: { type: 'support_ticket', ticketId: t.id },
        }),
      ]);
      return json({ ok: true, emailed, pushSent: push.sent, pushFailed: push.failed });
    }

    if (action === 'reply') {
      const { data: claim, error } = await userClient.rpc('claim_support_reply_notice', { p_id: ticketId });
      if (error) {
        const denied = /verified system admin required/i.test(error.message ?? '');
        return json({ ok: false, error: denied ? 'forbidden' : 'claim failed' }, denied ? 403 : 500);
      }
      if (!claim) return json({ ok: true, notified: false, reason: 'not claimable' });
      const c = claim as { id: string; user_id: string; family_id: string };
      const { data: subs, error: subError } = await serviceClient.from('web_push_subscriptions')
        .select('id, endpoint, p256dh, auth').eq('user_id', c.user_id).eq('family_id', c.family_id).eq('is_active', true);
      if (subError) throw subError;
      const push = await pushTo(serviceClient, (subs ?? []) as WebSub[], {
        title: 'Walkie Doggy Link',
        body: 'קיבלת תשובה לפנייה שלך. פתחו את "עזרה ותמיכה" ← "הפניות שלי".',
        tag: `support-reply-${c.id}`,
        data: { type: 'support_reply', ticketId: c.id },
      });
      return json({ ok: true, pushSent: push.sent, pushFailed: push.failed });
    }

    return json({ ok: false, error: 'unknown action' }, 400);
  } catch (error) {
    console.error('support-notify failed', error instanceof Error ? error.message : error);
    return json({ ok: false, error: 'internal error' }, 500);
  }
});
