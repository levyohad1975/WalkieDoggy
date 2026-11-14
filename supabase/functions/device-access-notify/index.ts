// supabase/functions/device-access-notify/index.ts
//
// Push to the family admins when a family member's new device asks to be
// signed into its profile (migration 20261103120000_device_access_requests.sql).
//
//   { requestId } — called by the requesting device right after
//     request_device_access(). claim_device_access_admin_notice() runs AS THE
//     CALLER and returns the request only if the caller made it, it is still
//     pending and fresh, and it was not announced yet. Every device of the
//     family's admin profiles then gets a Web Push.
//
// The body carries only an id; the name and recipients come from the database.

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

    const { data: claim, error } = await userClient.rpc('claim_device_access_admin_notice', { p_id: requestId });
    if (error) throw error;
    if (!claim) return json({ ok: true, notified: false, reason: 'not claimable' });
    const c = claim as { id: string; family_id: string; target_name: string | null };

    const ids = await familyAdminProfileIds(serviceClient, c.family_id);
    if (!ids.length || !VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) return json({ ok: true, pushSent: 0 });

    const { data: subs, error: subError } = await serviceClient.from('web_push_subscriptions')
      .select('id, endpoint, p256dh, auth').in('user_id', ids).eq('family_id', c.family_id).eq('is_active', true);
    if (subError) throw subError;

    const payload = JSON.stringify({
      title: '📲 בקשת התחברות ממכשיר חדש',
      body: `${c.target_name ?? 'בן משפחה'} מבקש/ת להתחבר ממכשיר חדש. פתחו את האפליקציה כדי לאשר.`,
      tag: `device-access-${c.id}`,
      data: { type: 'device_access_request', requestId: c.id },
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
    console.error('device-access-notify failed', error instanceof Error ? error.message : error);
    return json({ ok: false, error: 'internal error' }, 500);
  }
});
