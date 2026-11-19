// supabase/functions/routine-request-notify/index.ts
//
// One push per step of a routine change request
// (migration 20261110090000_routine_change_requests.sql):
//   pending_target -> the other family member ("X asks to swap with you")
//   pending_admin  -> the family admins ("waiting for your approval")
//   approved / rejected -> the requester (and the other member, if any)
// and for a one-off take of a single walk (take_once, migration
// 20261112110000): pending_target -> the walk's member; approved -> both.
//
//   { requestId } — called by whichever device just moved the request.
//   claim_routine_request_notice() runs AS THE CALLER: it returns the request
//   only to a member of the same family, and only once per status.
//
// The body carries only an id; names, recipients and text come from the
// database.

// deno-lint-ignore-file no-explicit-any
// @ts-nocheck -- Deno/Edge Function runtime globals are not available in this repo's Node/RN TypeScript config.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import webpush from 'npm:web-push@3.6.7';

const VAPID_PUBLIC_KEY = Deno.env.get('VAPID_PUBLIC_KEY') ?? '';
const VAPID_PRIVATE_KEY = Deno.env.get('VAPID_PRIVATE_KEY') ?? '';
const VAPID_SUBJECT = Deno.env.get('VAPID_SUBJECT') ?? 'https://walkielink.co.il';
if (VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY) {
  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DAYS = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

/**
 * The family's admin profiles. Admin is the profile's role (users.role), as
 * is_real_family_admin() decides it. family_admin_profile_ids() looks for a
 * users.auth_user_id link that profiles claimed on a device do not have, so
 * it found nobody and admin pushes never arrived (found 2026-11-10).
 */
async function familyAdminProfileIds(serviceClient: any, familyId: string): Promise<string[]> {
  const { data, error } = await serviceClient.from('users').select('id')
    .eq('family_id', familyId).eq('role', 'admin').is('removed_at', null);
  if (error) throw error;
  return (data ?? []).map((u: any) => u.id).filter(Boolean);
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'content-type': 'application/json' } });
}

const slot = (day: number | null, time: string | null) => (day === null || day === undefined || !time ? '' : `${DAYS[day] ?? ''} ${time}`);

/** " (12.11)" for a one-off take's date (YYYY-MM-DD). */
const dateLabel = (date: string | null) => {
  const m = typeof date === 'string' ? /^\d{4}-(\d{2})-(\d{2})$/.exec(date) : null;
  return m ? ` (${Number(m[2])}.${Number(m[1])})` : '';
};

/** What is being asked, in one Hebrew line. */
function describe(c: any): string {
  const requester = c.requester_name ?? 'בן משפחה';
  const target = c.target_name ?? 'בן משפחה';
  switch (c.kind) {
    case 'swap': return `${requester} מבקש/ת להחליף באופן קבוע: ${slot(c.my_day, c.my_time)} של ${requester} תמורת ${slot(c.their_day, c.their_time)} של ${target}`;
    case 'give': return `${requester} מבקש/ת להעביר באופן קבוע את ${slot(c.my_day, c.my_time)} אל ${target}`;
    case 'take': return `${requester} מבקש/ת לקחת באופן קבוע את ${slot(c.their_day, c.their_time)} של ${target}`;
    case 'take_once': return `${requester} מבקש/ת לקחת רק פעם אחת את הטיול של ${target} ב${slot(c.their_day, c.their_time)}${dateLabel(c.walk_date)}`;
    default: return `${requester} מבקש/ת להזיז באופן קבוע את טיול ${slot(c.my_day, c.my_time)} לשעה ${c.new_time}`;
  }
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

    let requestId: unknown;
    try {
      requestId = (await req.json())?.requestId;
    } catch {
      /* invalid body */
    }
    if (typeof requestId !== 'string' || !UUID_PATTERN.test(requestId)) return json({ ok: false, error: 'a valid requestId is required' }, 400);

    const { data: claim, error } = await userClient.rpc('claim_routine_request_notice', { p_id: requestId });
    if (error) throw error;
    if (!claim) return json({ ok: true, notified: false, reason: 'not claimable' });
    const c = claim as any;

    let recipients: string[] = [];
    let title = '';
    let body = describe(c);
    const once = c.kind === 'take_once';
    if (c.status === 'pending_target') {
      recipients = [c.target_user_id];
      title = once ? '🙋 בקשה לקחת טיול שלך' : '🔁 בקשה לשינוי בשגרה';
      body = `${body}. פתחו את האפליקציה כדי לאשר או לסרב.`;
    } else if (c.status === 'pending_admin') {
      recipients = await familyAdminProfileIds(serviceClient, c.family_id);
      title = '🔁 שינוי בשגרה ממתין לאישורך';
      body = c.target_name && c.kind !== 'change_time' ? `${body} (${c.target_name} הסכים/ה).` : `${body}.`;
    } else if (c.status === 'approved') {
      recipients = [c.requester_user_id, c.target_user_id];
      title = once ? '✅ הטיול הועבר' : '✅ השינוי בשגרה אושר';
    } else if (c.status === 'rejected') {
      recipients = [c.requester_user_id];
      title = once ? 'הבקשה לקחת את הטיול לא אושרה' : 'הבקשה לשינוי בשגרה לא אושרה';
    }
    const ids = [...new Set(recipients.filter(Boolean))];
    if (!ids.length || !VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) return json({ ok: true, pushSent: 0 });

    const { data: subs, error: subError } = await serviceClient.from('web_push_subscriptions')
      .select('id, endpoint, p256dh, auth').in('user_id', ids).eq('family_id', c.family_id).eq('is_active', true);
    if (subError) throw subError;

    const payload = JSON.stringify({
      title,
      body,
      tag: `routine-request-${c.id}`,
      data: { type: 'routine_change_request', requestId: c.id, status: c.status },
    });
    const unique = [...new Map((subs ?? []).map((s: any) => [s.endpoint, s])).values()];
    let sent = 0;
    await Promise.allSettled(unique.map(async (sub: any) => {
      try {
        await webpush.sendNotification({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } }, payload);
        sent += 1;
      } catch (err: any) {
        const status = err?.statusCode ?? null;
        const permanent = status === 404 || status === 410 || (status === 400 && /VapidPkHashMismatch/i.test(String(err?.body ?? '')));
        await serviceClient.from('web_push_subscriptions')
          .update({ is_active: !permanent, last_error: String(err?.message ?? err).slice(0, 300), updated_at: new Date().toISOString() })
          .eq('id', sub.id);
      }
    }));
    return json({ ok: true, pushSent: sent });
  } catch (error) {
    console.error('routine-request-notify failed', error instanceof Error ? error.message : error);
    return json({ ok: false, error: 'internal error' }, 500);
  }
});
