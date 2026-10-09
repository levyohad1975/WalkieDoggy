// supabase/functions/send-chat-push/index.ts
//
// Family Chat push notifications (migration 0108_family_chat.sql).
//
// SECURITY MODEL — same posture as send-request-push: this function holds
// the SERVICE ROLE key, so it trusts NOTHING from the request body except
// one opaque id.
//
//   1. The caller is authenticated from their own Authorization bearer token
//      (a user-scoped client; queries through it run as the caller, under RLS).
//   2. chat_push_context(messageId) runs AS THE CALLER and returns the
//      message only if the caller is its real author, it is recent, and it
//      has not been removed. Anything else returns null and nothing is sent.
//      A client therefore cannot trigger a push for someone else's message,
//      for an old message, or with content of its choosing.
//   3. Recipients come from chat_push_recipients() (service role): every
//      active member of the conversation EXCEPT the sender, minus members
//      who turned notifications off or muted this conversation. The client
//      never supplies a recipient.
//   4. claim_chat_push_event() makes delivery at-most-once per message, so a
//      retried send (same message id) or a duplicated call cannot notify
//      twice.
//
// The notification text is the sender's name and a short preview, both read
// from the database — never from the request.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import webpush from 'npm:web-push@3.6.7';

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';
const VAPID_PUBLIC_KEY = Deno.env.get('VAPID_PUBLIC_KEY') ?? '';
const VAPID_PRIVATE_KEY = Deno.env.get('VAPID_PRIVATE_KEY') ?? '';
const VAPID_SUBJECT = Deno.env.get('VAPID_SUBJECT') ?? 'https://walkie-doggy-link.expo.app';

if (VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY) {
  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
}

const PREVIEW_MAX_LENGTH = 140;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const FALLBACK_SENDER = 'בן/בת משפחה'; // בן/בת משפחה
const NO_RECIPIENT = '00000000-0000-0000-0000-000000000000';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'content-type': 'application/json' },
  });
}

/** Single-line preview, truncated on a code-point boundary (never mid-emoji). */
function previewOf(body: string): string {
  const oneLine = body.replace(/\s+/g, ' ').trim();
  const chars = Array.from(oneLine);
  return chars.length > PREVIEW_MAX_LENGTH ? `${chars.slice(0, PREVIEW_MAX_LENGTH - 1).join('')}…` : oneLine;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }
  if (req.method !== 'POST') {
    return json({ ok: false, error: 'method not allowed' }, 405);
  }

  try {
    const authHeader = req.headers.get('Authorization') ?? req.headers.get('authorization');
    if (!authHeader) {
      return json({ ok: false, error: 'missing Authorization header' }, 401);
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: authData, error: authError } = await userClient.auth.getUser();
    if (authError || !authData?.user) {
      return json({ ok: false, error: 'invalid or expired session' }, 401);
    }

    let messageId: unknown;
    try {
      messageId = (await req.json())?.messageId;
    } catch {
      messageId = undefined;
    }
    if (typeof messageId !== 'string' || !UUID_PATTERN.test(messageId)) {
      return json({ ok: false, error: 'a valid messageId is required' }, 400);
    }

    // Runs as the caller. Null unless the caller is the author of a recent,
    // live message in a conversation they can access.
    const { data: context, error: contextError } = await userClient.rpc('chat_push_context', {
      p_message_id: messageId,
    });
    if (contextError) throw contextError;
    if (!context) {
      return json({ ok: false, sent: 0, reason: 'not the author of a recent message' });
    }
    const ctx = context as {
      message_id: string;
      conversation_id: string;
      sender_user_id: string;
      sender_name: string | null;
      body: string;
    };

    const serviceClient = createClient(supabaseUrl, serviceRoleKey);

    const { data: claimed, error: claimError } = await serviceClient.rpc('claim_chat_push_event', {
      p_message_id: ctx.message_id,
    });
    if (claimError) throw claimError;
    if (!claimed) {
      return json({ ok: true, sent: 0, reason: 'already sent' });
    }

    const mark = (status: 'sent' | 'failed' | 'no_destination') =>
      serviceClient.rpc('mark_chat_push_event', { p_message_id: ctx.message_id, p_status: status });

    try {
      const { data: recipientRows, error: recipientError } = await serviceClient.rpc('chat_push_recipients', {
        p_message_id: ctx.message_id,
      });
      if (recipientError) throw recipientError;

      // Defence in depth: the sender is excluded in SQL, and again here.
      const recipientIds = [
        ...new Set(
          ((recipientRows ?? []) as unknown[])
            .map((row) => (typeof row === 'string' ? row : (row as { chat_push_recipients?: string })?.chat_push_recipients))
            .filter((id): id is string => typeof id === 'string' && id !== ctx.sender_user_id)
        ),
      ];

      const idsForQuery = recipientIds.length > 0 ? recipientIds : [NO_RECIPIENT];
      const [{ data: tokenRows, error: tokenError }, { data: webRows, error: webError }] = await Promise.all([
        serviceClient.from('push_tokens').select('id, user_id, token').in('user_id', idsForQuery).eq('is_active', true),
        serviceClient
          .from('web_push_subscriptions')
          .select('id, user_id, endpoint, p256dh, auth')
          .in('user_id', idsForQuery)
          .eq('is_active', true),
      ]);
      if (tokenError) throw tokenError;
      if (webError) throw webError;

      const expoTokens = tokenRows ?? [];
      // One notification per physical destination, even if it is registered twice.
      const webSubscriptions = [...new Map((webRows ?? []).map((sub: any) => [sub.endpoint, sub])).values()];

      if (expoTokens.length === 0 && webSubscriptions.length === 0) {
        await mark('no_destination');
        return json({ ok: true, sent: 0, expoSent: 0, webSent: 0, reason: 'no active push destinations' });
      }

      const title = ctx.sender_name?.trim() || FALLBACK_SENDER;
      const body = previewOf(ctx.body);
      const data = { type: 'chat', conversationId: ctx.conversation_id, messageId: ctx.message_id };

      let expoSent = 0;
      let webSent = 0;
      const deliveryErrors: string[] = [];

      if (expoTokens.length > 0) {
        try {
          const messages = expoTokens.map((row: any) => ({
            to: row.token,
            title,
            body,
            data,
            sound: 'default',
            priority: 'high',
            // Collapses a burst from one conversation on Android/iOS.
            collapseId: `chat-${ctx.conversation_id}`,
          }));
          const expoResponse = await fetch(EXPO_PUSH_URL, {
            method: 'POST',
            headers: { 'content-type': 'application/json', accept: 'application/json' },
            body: JSON.stringify(messages),
          });
          if (!expoResponse.ok) throw new Error(`Expo Push HTTP ${expoResponse.status}`);
          const expoResult = await expoResponse.json();
          const tickets = Array.isArray(expoResult?.data) ? expoResult.data : [];
          const updates: Promise<unknown>[] = [];
          tickets.forEach((ticket: any, index: number) => {
            const tokenRow = expoTokens[index];
            if (!tokenRow) return;
            if (ticket?.status === 'ok') {
              expoSent += 1;
              return;
            }
            if (ticket?.status === 'error') {
              const isPermanent = ticket?.details?.error === 'DeviceNotRegistered';
              updates.push(
                serviceClient
                  .from('push_tokens')
                  .update({
                    is_active: !isPermanent,
                    last_error: String(ticket.message ?? ticket.details?.error ?? 'unknown error'),
                  })
                  .eq('id', tokenRow.id)
              );
            }
          });
          if (updates.length > 0) await Promise.allSettled(updates);
        } catch (expoErr) {
          console.error('Expo Push failed', expoErr);
          deliveryErrors.push(`expo: ${String(expoErr)}`);
        }
      }

      if (webSubscriptions.length > 0) {
        if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) {
          deliveryErrors.push('web: VAPID keys are not configured');
        } else {
          const payload = JSON.stringify({ title, body, data, tag: `chat-${ctx.conversation_id}` });
          const results = await Promise.allSettled(
            webSubscriptions.map(async (sub: any) => {
              try {
                await webpush.sendNotification(
                  { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
                  payload
                );
                webSent += 1;
                await serviceClient
                  .from('web_push_subscriptions')
                  .update({ is_active: true, last_error: null, updated_at: new Date().toISOString() })
                  .eq('id', sub.id);
              } catch (pushErr: any) {
                const statusCode = pushErr?.statusCode ?? pushErr?.status ?? null;
                const isPermanent = statusCode === 404 || statusCode === 410;
                await serviceClient
                  .from('web_push_subscriptions')
                  .update({
                    is_active: !isPermanent,
                    last_error: String(pushErr?.message ?? pushErr ?? 'unknown Web Push error'),
                    updated_at: new Date().toISOString(),
                  })
                  .eq('id', sub.id);
                throw pushErr;
              }
            })
          );
          for (const result of results) {
            if (result.status === 'rejected') deliveryErrors.push(`web: ${String(result.reason)}`);
          }
        }
      }

      const totalSent = expoSent + webSent;
      if (totalSent > 0) {
        await mark('sent');
        return json({ ok: true, sent: totalSent, expoSent, webSent, deliveryErrors });
      }

      console.error('Chat push delivery failed', { messageId: ctx.message_id, deliveryErrors });
      await mark('failed');
      return json({ ok: false, sent: 0, expoSent: 0, webSent: 0, deliveryErrors });
    } catch (sendErr) {
      console.error('Chat push send block failed', sendErr);
      await mark('failed');
      return json({ ok: false, error: String(sendErr) });
    }
  } catch (err) {
    console.error('send-chat-push failed', err);
    return json({ ok: false, error: String(err) });
  }
});
