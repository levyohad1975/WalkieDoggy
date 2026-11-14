import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import webpush from 'npm:web-push@3.6.7';

const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'content-type': 'application/json' } });
const vapidPublic = Deno.env.get('VAPID_PUBLIC_KEY') ?? '';
const vapidPrivate = Deno.env.get('VAPID_PRIVATE_KEY') ?? '';
if (vapidPublic && vapidPrivate) webpush.setVapidDetails(Deno.env.get('VAPID_SUBJECT') ?? 'https://walkielink.co.il', vapidPublic, vapidPrivate);

Deno.serve(async (request: Request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (request.method !== 'POST') return json({ ok: false, error: 'method not allowed' }, 405);
  const authorization = request.headers.get('Authorization');
  if (!authorization) return json({ ok: false, error: 'unauthorized' }, 401);
  let caller: ReturnType<typeof createClient> | undefined;
  let claimedIds: string[] = [];
  try {
    const url = Deno.env.get('SUPABASE_URL')!;
    const anon = Deno.env.get('SUPABASE_ANON_KEY')!;
    const service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    caller = createClient(url, anon, { global: { headers: { Authorization: authorization } } });
    const { data: auth, error: authError } = await caller.auth.getUser();
    if (authError || !auth.user) return json({ ok: false, error: 'unauthorized' }, 401);
    const body = await request.json().catch(() => ({}));
    const walkId = body?.walkId;
    if (typeof walkId !== 'string' || !/^[0-9a-f-]{36}$/i.test(walkId)) return json({ ok: false, error: 'invalid walk' }, 400);

    const { data: notifications, error: claimError } = await caller.rpc('claim_walk_lifecycle_notifications_v11', { p_walk_id: walkId });
    if (claimError) throw claimError;
    if (!notifications?.length) return json({ ok: true, providerAccepted: false, reason: 'no pending notifications' });
    const admin = createClient(url, service);
    claimedIds = notifications.map((row: any) => row.notification_id as string);
    let acceptedDestinations = 0;
    let acceptedNotifications = 0;
    const failureReasons: string[] = [];

    // One remote action can create one row per recipient. Resolve devices and
    // delivery state per row so one recipient cannot consume another's outbox.
    for (const notification of notifications) {
      const { data: sessions, error: sessionsError } = await admin.from('profile_auth_sessions').select('auth_user_id').eq('family_id', notification.family_id).eq('user_id', notification.recipient_user_id);
      if (sessionsError) throw sessionsError;
      const authIds = [...new Set((sessions ?? []).map((row: any) => row.auth_user_id).filter(Boolean))];
      const [expoResult, webResult] = await Promise.all([
        authIds.length ? admin.from('push_tokens').select('token').eq('family_id', notification.family_id).eq('user_id', notification.recipient_user_id).in('auth_user_id', authIds).eq('is_active', true) : Promise.resolve({ data: [], error: null }),
        authIds.length ? admin.from('web_push_subscriptions').select('endpoint,p256dh,auth').eq('family_id', notification.family_id).eq('user_id', notification.recipient_user_id).in('auth_user_id', authIds).eq('is_active', true) : Promise.resolve({ data: [], error: null }),
      ]);
      if (expoResult.error) throw expoResult.error;
      if (webResult.error) throw webResult.error;
      const title = 'Walkie Doggy';
      const message = notification.kind === 'remote_finish'
        ? `מנהל המשפחה סיים את הטיול של ${notification.dog_name}. פתחו את האפליקציה לפרטים.`
        : `${notification.actor_name} התחיל/ה את הטיול של ${notification.dog_name} עבורך. פתחו את הטיול והפעילו GPS במכשיר שלכם.`;
      const expoTokens = [...new Set((expoResult.data ?? []).map((row: any) => row.token))];
      let acceptedForRecipient = 0;
      const failures: string[] = [];
      if (expoTokens.length) {
        const response = await fetch('https://exp.host/--/api/v2/push/send', {
          method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify(expoTokens.map((to) => ({ to, title, body: message, sound: 'default', priority: 'high', data: { type: 'walk_lifecycle', walkId, notificationIds: [notification.notification_id] } }))),
        });
        if (!response.ok) failures.push(`expo_http_${response.status}`);
        else {
          const result = await response.json().catch(() => ({}));
          const tickets = Array.isArray(result?.data) ? result.data : [];
          acceptedForRecipient += tickets.filter((ticket: any) => ticket.status === 'ok').length;
          if (tickets.some((ticket: any) => ticket.status !== 'ok')) failures.push('expo_provider_rejected');
        }
      }
      if (vapidPublic && vapidPrivate) {
        for (const subscription of webResult.data ?? []) {
          try {
            await webpush.sendNotification(subscription, JSON.stringify({ title, body: message, data: { type: 'walk_lifecycle', walkId, notificationIds: [notification.notification_id] } }));
            acceptedForRecipient += 1;
          } catch { failures.push('webpush_provider_rejected'); }
        }
      }
      const providerAccepted = acceptedForRecipient > 0;
      const failureReason = providerAccepted ? null : (failures[0] ?? 'no_registered_push_destinations');
      const { error: finishError } = await caller.rpc('finish_walk_lifecycle_notification_delivery_v11', {
        p_notification_ids: [notification.notification_id], p_provider_accepted: providerAccepted, p_failure_reason: failureReason,
      });
      if (finishError) throw finishError;
      claimedIds = claimedIds.filter((id) => id !== notification.notification_id);
      acceptedDestinations += acceptedForRecipient;
      if (providerAccepted) acceptedNotifications += 1;
      else failureReasons.push(failureReason);
    }
    return json({ ok: true, providerAccepted: acceptedNotifications > 0, acceptedDestinations, acceptedNotifications, failureReason: acceptedNotifications > 0 ? null : (failureReasons[0] ?? 'no_registered_push_destinations') });
  } catch (error) {
    if (caller && claimedIds.length) {
      await caller.rpc('finish_walk_lifecycle_notification_delivery_v11', {
        p_notification_ids: claimedIds, p_provider_accepted: false, p_failure_reason: 'notification_sender_error',
      }).catch(() => undefined);
    }
    console.error('walk lifecycle notification delivery failed', error);
    return json({ ok: false, error: 'notification delivery failed' }, 500);
  }
});
