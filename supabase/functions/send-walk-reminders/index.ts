// supabase/functions/send-walk-reminders/index.ts
//
// BATCH 2: the authoritative, server-side walk reminder sender. Invoked on
// a schedule (pg_cron + pg_net — see this batch's report for the exact
// one-time `cron.schedule(...)` statement to run after deploying this
// function; deliberately NOT embedded in a migration, same reasoning as
// VAPID_PUBLIC_KEY/VAPID_PRIVATE_KEY never appearing in one) — roughly once
// a minute is the intended cadence, but this function is idempotent and
// safe to invoke more often, less often, concurrently, or after a long gap
// (see "STALENESS" below).
//
// AUTHENTICATION MODEL — deliberately DIFFERENT from send-request-push:
// send-request-push has a real end user in the loop (a client just took an
// action and is reporting it), so it authenticates the CALLER's own bearer
// token via Supabase Auth. This function has NO end user in the loop at
// all — its only legitimate caller is this project's own cron trigger. A
// Supabase Edge Function's platform-level JWT check (verify_jwt) is NOT
// sufficient on its own to restrict that: it only confirms the incoming
// Authorization header is SOME validly-signed token for this project, and
// the public anon key (present in the app bundle) is itself such a token —
// so verify_jwt alone would let anyone holding the anon key invoke this.
// Deploy this function with `--no-verify-jwt` (see deployment steps) and
// instead require a SEPARATE shared secret, `WALK_REMINDER_CRON_SECRET`
// (set via `supabase secrets set`, never in this file, never in the app
// bundle, never in a migration), sent as a custom header by the cron job
// itself. This is the ONLY credential this function trusts — everything it
// then does runs under the SERVICE ROLE key it holds itself, deriving every
// recipient/message/state fact fresh from the database (requirement 9: no
// client-supplied recipient ids, message text, family id, or role info —
// there IS no "client" here in the request-lifecycle-push sense at all).
//
// FLOW, per invocation:
//   1. Verify the shared secret header. Reject (401) if missing/wrong.
//   2. Call due_walk_reminders() (migration 0025) — RECIPIENT-level
//      candidates (one row per (walk, stage, recipient)), a first pass
//      computed fresh from `walks`/`families`/`family_auth_members` right
//      now, already excluding any recipient already durably marked 'sent'.
//   3. Group those candidates by (walk_id, stage, fire_at) — every recipient
//      of the same walk+stage shares one walk-level re-check, done ONCE per
//      group:
//      a. Call walk_reminder_context(walk_id) for one more, fully-fresh
//         read taken at the moment of processing THIS group (requirement
//         3's re-check: exists / still pending / time unchanged).
//      b. Skip the WHOLE group if the walk no longer exists, is no longer
//         pending, or its freshly-recomputed fire time for this stage no
//         longer matches the group's (rescheduled between step 2 and now —
//         a fresh candidate for the new time appears on the next tick).
//      c. If the group has any T+30 admin_escalation candidates, fetch the
//         CURRENT admin roster (family_admin_profile_ids()) once for the
//         group, for the per-recipient re-check in step 4c below.
//   4. For EACH recipient candidate within a still-valid group, independently:
//      a. Re-check requirement 3's remaining bullet — the recipient is
//         still who it should be right now: a 'responsible' candidate is
//         skipped if the fresh context's responsible_user_id no longer
//         matches it (the walk was reassigned since step 2 — the NEW
//         responsible member appears as their own fresh candidate on a
//         later tick); an 'admin_escalation' candidate is skipped if that
//         person is no longer an active admin OR has since become the
//         walk's own responsible member (in which case they already get
//         their own 'responsible' message instead — no double-notify).
//      b. CORRECTION (Batch 2 review): atomically claim
//         (walk_id, stage, fire_at, recipient_user_id) via
//         claim_walk_reminder_event() — now scoped PER RECIPIENT, not per
//         walk+stage. This is the actual fix for the review finding: a
//         responsible member's successful delivery can no longer suppress
//         a retry for a different (e.g. admin) recipient's failed
//         delivery, because each recipient has their own independent
//         durable row. Skip this recipient only (not the group) if not
//         claimed (already sent, or another concurrent invocation is
//         currently sending it and that attempt isn't stale).
//      c. Build the message (inlined copy of src/logic/reminderMessages.ts
//         — Deno can't import an RN-project file at deploy time, same
//         limitation documented in send-request-push/index.ts for
//         src/logic/pushRouting.ts — keep both in sync) appropriate to this
//         recipient's role ('responsible' vs 'admin_escalation').
//      d. Send via Expo Push + Web Push to whichever channels THIS ONE
//         recipient has registered (push_tokens / web_push_subscriptions) —
//         same delivery code shape as send-request-push (including
//         DeviceNotRegistered / 404-410 token deactivation). If a person has
//         more than one destination (e.g. an Expo token AND a Web Push
//         subscription), sending both and marking 'sent' once ANY succeeds
//         is intentional — see migration 0025 Part 1's header for why that
//         is a different case from the bug being fixed here (one person's
//         own redundant channels vs. two different people sharing one
//         row).
//      e. mark_walk_reminder_event(..., sent-if-anything-delivered for THIS
//         recipient, else failed-for-retry) — same "don't retry a partial
//         success" rule as send-request-push, now scoped to this recipient
//         alone.
//   5. Return a JSON summary (never throws to the caller — pg_net doesn't
//      care about the body, but a 200 with a clear summary makes this
//      debuggable from the SQL side via net._http_response).
//
// STALENESS: due_walk_reminders()'s own p_max_lateness_minutes bound (0025,
// default 6h) already refuses to consider a reminder "due" once it's that
// far in the past — see that function's header for why. This function does
// not add a second staleness rule on top of that.

// deno-lint-ignore-file no-explicit-any
// @ts-nocheck -- Deno/Edge Function runtime globals (Deno.serve, Deno.env)
// are not available in this repo's Node/RN TypeScript project config; this
// file is only ever executed by `supabase functions deploy`, never bundled
// by Metro/tsc for the app.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import webpush from 'npm:web-push@3.6.7';

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';
const VAPID_PUBLIC_KEY = Deno.env.get('VAPID_PUBLIC_KEY') ?? '';
const VAPID_PRIVATE_KEY = Deno.env.get('VAPID_PRIVATE_KEY') ?? '';
const VAPID_SUBJECT = Deno.env.get('VAPID_SUBJECT') ?? 'https://walkie-doggy-link.expo.app';
const CRON_SECRET = Deno.env.get('WALK_REMINDER_CRON_SECRET') ?? '';

if (VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY) {
  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
}

// ----------------------------------------------------------------------------
// Inlined copy of src/logic/reminderMessages.ts — see that file's header for
// the canonical, unit-tested version and the Hebrew-grammar reasoning behind
// every phrase. Kept deliberately identical in behavior; update both if this
// ever changes.
// ----------------------------------------------------------------------------

type ReminderStage = 'T-15' | 'T' | 'T+15' | 'T+30';

const REMINDER_STAGE_OFFSET_MINUTES: Record<ReminderStage, number> = {
  'T-15': -15,
  T: 0,
  'T+15': 15,
  'T+30': 30,
};

function stableIndex(seed: string, length: number): number {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return h % length;
}

function pick<T>(items: T[], seed: string): T {
  return items[stableIndex(seed, items.length)];
}

function dogNoun(dogName: string, dogSex: string | null | undefined): string {
  if (dogSex === 'male') return `הכלב ${dogName}`;
  if (dogSex === 'female') return `הכלבה ${dogName}`;
  return dogName;
}

function wentOutForm(dogSex: string | null | undefined): 'יצא' | 'יצאה' | null {
  if (dogSex === 'male') return 'יצא';
  if (dogSex === 'female') return 'יצאה';
  return null;
}

interface ReminderMessageInput {
  stage: ReminderStage;
  dogName: string;
  dogSex?: string | null;
  responsibleName: string;
  scheduledTime: string;
  varietySeed: string;
}

function buildWalkReminderMessage(input: ReminderMessageInput): { title: string; body: string } {
  const { stage, dogName, dogSex, responsibleName, scheduledTime, varietySeed } = input;
  const noun = dogNoun(dogName, dogSex);
  const seed = `${varietySeed}:${stage}`;

  if (stage === 'T-15') {
    return pick(
      [
        { title: `🐶 עוד 15 דקות לטיול של ${dogName}`, body: `${responsibleName} אחראי/ת על הטיול בשעה ${scheduledTime}` },
        { title: '⏰ טיול בקרוב', body: `בעוד 15 דקות הגיע הזמן לטייל את ${dogName} — ${responsibleName} אחראי/ת` },
      ],
      seed
    );
  }
  if (stage === 'T') {
    return pick(
      [
        { title: '🐾 הגיע הזמן לטיול!', body: `${noun} מחכה לטיול עכשיו — ${responsibleName} אחראי/ת` },
        { title: `🐾 זמן לטייל את ${dogName}`, body: `השעה ${scheduledTime} הגיעה — ${responsibleName} אחראי/ת על הטיול` },
      ],
      seed
    );
  }
  if (stage === 'T+15') {
    return pick(
      [
        { title: '⏰ הטיול עדיין לא סומן כבוצע', body: `${noun} עדיין מחכה — הטיול משעה ${scheduledTime} טרם סומן. ${responsibleName} אחראי/ת` },
        { title: `⏰ ${dogName} עדיין מחכה לטיול`, body: `הטיול משעה ${scheduledTime} עדיין ממתין — ${responsibleName} אחראי/ת. אפשר לסמן כבוצע באפליקציה` },
      ],
      seed
    );
  }
  const wentOut = wentOutForm(dogSex);
  return pick(
    [
      {
        title: '🚨 הטיול דורש תשומת לב',
        body: wentOut
          ? `${noun} עדיין לא ${wentOut} לטיול משעה ${scheduledTime} — ${responsibleName} אחראי/ת`
          : `הטיול של ${dogName} משעה ${scheduledTime} עדיין ממתין — ${responsibleName} אחראי/ת`,
      },
      { title: '🚨 טיול באיחור משמעותי', body: `הטיול של ${dogName} משעה ${scheduledTime} עדיין לא סומן כבוצע — ${responsibleName} אחראי/ת` },
    ],
    seed
  );
}

function buildWalkAttentionEscalationMessage(input: Omit<ReminderMessageInput, 'stage'>): { title: string; body: string } {
  const { dogName, dogSex, responsibleName, scheduledTime, varietySeed } = input;
  const wentOut = wentOutForm(dogSex);
  const noun = dogNoun(dogName, dogSex);
  const seed = `${varietySeed}:T+30:escalation`;
  return pick(
    [
      { title: '🚨 טיול דורש תשומת לב', body: `הטיול של ${dogName} משעה ${scheduledTime}, באחריות ${responsibleName}, עדיין לא בוצע` },
      {
        title: '🚨 עדכון למשפחה',
        body: wentOut
          ? `${noun} עדיין לא ${wentOut} לטיול (${scheduledTime}) — ${responsibleName} היה/תה אחראי/ת`
          : `הטיול של ${dogName} משעה ${scheduledTime} עדיין ממתין — ${responsibleName} היה/תה אחראי/ת`,
      },
    ],
    seed
  );
}

// ----------------------------------------------------------------------------
// Delivery — same Expo Push + Web Push shape as send-request-push/index.ts
// (token/subscription loading, deactivation on permanent failure). Extracted
// to a shared helper here since this function sends to more than one
// logical recipient group per walk (responsible member + admins at T+30).
// ----------------------------------------------------------------------------

async function sendToRecipients(
  serviceClient: any,
  recipientUserIds: string[],
  title: string,
  body: string,
  data: Record<string, unknown>
): Promise<{ sent: number; errors: string[] }> {
  if (recipientUserIds.length === 0) return { sent: 0, errors: [] };

  const errors: string[] = [];
  let sent = 0;

  const { data: tokenRows } = await serviceClient
    .from('push_tokens')
    .select('id, user_id, token')
    .in('user_id', recipientUserIds)
    .eq('is_active', true);
  const { data: webPushRows } = await serviceClient
    .from('web_push_subscriptions')
    .select('id, user_id, endpoint, p256dh, auth')
    .in('user_id', recipientUserIds)
    .eq('is_active', true);

  const expoTokens = tokenRows ?? [];
  const webSubscriptions = webPushRows ?? [];

  if (expoTokens.length > 0) {
    try {
      const messages = expoTokens.map((r: any) => ({
        to: r.token,
        title,
        body,
        data,
        sound: 'default',
        priority: 'high',
      }));
      const expoResponse = await fetch(EXPO_PUSH_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify(messages),
      });
      if (!expoResponse.ok) throw new Error(`Expo Push HTTP ${expoResponse.status}`);
      const expoResult = await expoResponse.json();
      const tickets = Array.isArray(expoResult?.data) ? expoResult.data : [];
      const deactivations: Promise<any>[] = [];
      tickets.forEach((ticket: any, i: number) => {
        const tokenRow = expoTokens[i];
        if (!tokenRow) return;
        if (ticket?.status === 'ok') {
          sent += 1;
          return;
        }
        if (ticket?.status === 'error') {
          const isPermanent = ticket?.details?.error === 'DeviceNotRegistered';
          deactivations.push(
            serviceClient
              .from('push_tokens')
              .update({ is_active: !isPermanent, last_error: String(ticket.message ?? ticket.details?.error ?? 'unknown error') })
              .eq('id', tokenRow.id)
          );
        }
      });
      if (deactivations.length > 0) await Promise.allSettled(deactivations);
    } catch (expoErr) {
      console.error('send-walk-reminders: Expo Push failed', expoErr);
      errors.push(`expo: ${String(expoErr)}`);
    }
  }

  if (webSubscriptions.length > 0) {
    if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) {
      errors.push('web: VAPID keys are not configured');
    } else {
      const payload = JSON.stringify({ title, body, data });
      const webResults = await Promise.allSettled(
        webSubscriptions.map(async (subscriptionRow: any) => {
          try {
            await webpush.sendNotification(
              { endpoint: subscriptionRow.endpoint, keys: { p256dh: subscriptionRow.p256dh, auth: subscriptionRow.auth } },
              payload
            );
            sent += 1;
            await serviceClient
              .from('web_push_subscriptions')
              .update({ is_active: true, last_error: null, updated_at: new Date().toISOString() })
              .eq('id', subscriptionRow.id);
          } catch (pushErr: any) {
            const statusCode = pushErr?.statusCode ?? pushErr?.status ?? null;
            const isPermanent = statusCode === 404 || statusCode === 410;
            await serviceClient
              .from('web_push_subscriptions')
              .update({ is_active: !isPermanent, last_error: String(pushErr?.message ?? pushErr ?? 'unknown Web Push error'), updated_at: new Date().toISOString() })
              .eq('id', subscriptionRow.id);
            throw pushErr;
          }
        })
      );
      for (const result of webResults) {
        if (result.status === 'rejected') errors.push(`web: ${String(result.reason)}`);
      }
    }
  }

  return { sent, errors };
}

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'x-cron-secret, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  // ---- Step 1: the ONLY credential this function trusts — see header. ----
  const providedSecret = req.headers.get('x-cron-secret') ?? '';
  if (!CRON_SECRET || providedSecret !== CRON_SECRET) {
    return new Response(JSON.stringify({ ok: false, error: 'unauthorized' }), { status: 401 });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const serviceClient = createClient(supabaseUrl, serviceRoleKey);

  const summary = {
    ok: true,
    groupsProcessed: 0,
    groupsSkippedStale: 0,
    recipientsProcessed: 0,
    recipientsSkippedStale: 0,
    sent: 0,
    failed: 0,
    errors: [] as string[],
  };

  try {
    // ---- Step 2: RECIPIENT-level candidates, first pass, fresh right now. ----
    const { data: candidates, error: dueError } = await serviceClient.rpc('due_walk_reminders');
    if (dueError) throw dueError;

    // ---- Step 3: group by (walk_id, stage, fire_at) — one walk-level
    // re-check per group, shared by every recipient in it. ----
    const groups = new Map<string, any[]>();
    for (const c of candidates ?? []) {
      const key = `${c.walk_id}|${c.stage}|${c.fire_at}`;
      const arr = groups.get(key);
      if (arr) arr.push(c);
      else groups.set(key, [c]);
    }

    for (const groupCandidates of groups.values()) {
      summary.groupsProcessed += 1;
      const first = groupCandidates[0];
      const stage = first.stage as ReminderStage;

      try {
        // ---- Step 3a: one more, fully-fresh read for THIS walk. ----
        const { data: contextRows, error: contextError } = await serviceClient.rpc('walk_reminder_context', {
          p_walk_id: first.walk_id,
        });
        if (contextError) throw contextError;
        const ctx = (contextRows ?? [])[0];

        // ---- Step 3b: re-check — exists, still pending, time unchanged. ----
        if (!ctx || ctx.status !== 'pending') {
          summary.groupsSkippedStale += 1;
          summary.recipientsSkippedStale += groupCandidates.length;
          continue;
        }
        const freshFireAtMs = new Date(ctx.scheduled_at).getTime() + REMINDER_STAGE_OFFSET_MINUTES[stage] * 60000;
        const candidateFireAtMs = new Date(first.fire_at).getTime();
        // Compare at minute granularity — both sides are already
        // minute-truncated server-side (due_walk_reminders()), this just
        // guards against any incidental sub-minute float noise.
        if (Math.round(freshFireAtMs / 60000) !== Math.round(candidateFireAtMs / 60000)) {
          // Rescheduled since step 2 computed this group — a fresh set of
          // candidates for the new time will appear on a later tick.
          summary.groupsSkippedStale += 1;
          summary.recipientsSkippedStale += groupCandidates.length;
          continue;
        }

        // ---- Step 3c: fresh admin roster, once per group, only if needed. ----
        let freshAdminIds: string[] | null = null;
        if (stage === 'T+30' && groupCandidates.some((c) => c.recipient_role === 'admin_escalation')) {
          const { data: adminIds } = await serviceClient.rpc('family_admin_profile_ids', { p_family_id: ctx.family_id });
          freshAdminIds = adminIds ?? [];
        }

        const messageInput = {
          dogName: ctx.dog_name,
          dogSex: ctx.dog_sex,
          responsibleName: ctx.responsible_user_name ?? 'מישהו מהמשפחה',
          // The raw "HH:mm" local wall-clock string, in the family's own
          // timezone — see walk_reminder_context()'s comment (0025) for why
          // this must NOT be derived from scheduled_at (a UTC instant).
          scheduledTime: ctx.scheduled_time_local ?? '',
          varietySeed: ctx.walk_id,
        };

        // ---- Step 4: each recipient, independently. ----
        for (const candidate of groupCandidates) {
          summary.recipientsProcessed += 1;
          try {
            // ---- Step 4a: per-recipient re-check. ----
            if (candidate.recipient_role === 'responsible') {
              if (candidate.recipient_user_id !== ctx.responsible_user_id) {
                // Reassigned since step 2 — the new responsible member gets
                // their own fresh candidate on a later tick.
                summary.recipientsSkippedStale += 1;
                continue;
              }
            } else {
              // admin_escalation
              const stillAdmin = (freshAdminIds ?? []).includes(candidate.recipient_user_id);
              const nowResponsible = candidate.recipient_user_id === ctx.responsible_user_id;
              if (!stillAdmin || nowResponsible) {
                // No longer an admin, or has since become the responsible
                // member themselves (who already gets their own message) —
                // skip rather than send a stale/duplicate escalation.
                summary.recipientsSkippedStale += 1;
                continue;
              }
            }

            // ---- Step 4b: atomic, durable, PER-RECIPIENT exactly-once claim. ----
            const { data: claimed, error: claimError } = await serviceClient.rpc('claim_walk_reminder_event', {
              p_walk_id: ctx.walk_id,
              p_family_id: ctx.family_id,
              p_stage: stage,
              p_fire_at: candidate.fire_at,
              p_recipient_user_id: candidate.recipient_user_id,
              p_recipient_role: candidate.recipient_role,
            });
            if (claimError) throw claimError;
            if (!claimed) continue; // already sent to this recipient, or another invocation is currently sending it

            // ---- Step 4c: role-appropriate message. ----
            const msg =
              candidate.recipient_role === 'responsible'
                ? buildWalkReminderMessage({ ...messageInput, stage })
                : buildWalkAttentionEscalationMessage(messageInput);

            // ---- Step 4d: send to THIS recipient's own destinations only. ----
            const result = await sendToRecipients(serviceClient, [candidate.recipient_user_id], msg.title, msg.body, {
              type: candidate.recipient_role === 'responsible' ? 'walkReminder' : 'walkAttentionEscalation',
              walkId: ctx.walk_id,
              stage,
            });

            // ---- Step 4e: mark THIS recipient's outcome only — never
            // retry a partial success (mirrors send-request-push's
            // "totalSent > 0 -> sent" rule), and never lets this
            // recipient's outcome affect any other recipient's row (the
            // Batch 2 review fix). A recipient with NO registered push
            // channel at all (nobody to deliver to, zero errors) is a
            // legitimate non-delivery, not a failure — marked 'sent' so
            // it's never retried, same as send-request-push's "no active
            // push destinations" case. Only an actual delivery ERROR (a
            // channel existed but sending it failed) is retryable.
            const hadErrors = result.errors.length > 0;
            const outcomeStatus = result.sent > 0 || !hadErrors ? 'sent' : 'failed';
            await serviceClient.rpc('mark_walk_reminder_event', {
              p_walk_id: ctx.walk_id,
              p_stage: stage,
              p_fire_at: candidate.fire_at,
              p_recipient_user_id: candidate.recipient_user_id,
              p_status: outcomeStatus,
            });

            if (outcomeStatus === 'sent') {
              summary.sent += 1;
            } else {
              summary.failed += 1;
              summary.errors.push(...result.errors);
            }
          } catch (perRecipientErr) {
            summary.failed += 1;
            summary.errors.push(String(perRecipientErr));
            console.error('send-walk-reminders: recipient failed', candidate, perRecipientErr);
          }
        }
      } catch (perGroupErr) {
        summary.failed += groupCandidates.length;
        summary.errors.push(String(perGroupErr));
        console.error('send-walk-reminders: group failed', first, perGroupErr);
      }
    }

    return new Response(JSON.stringify(summary), { status: 200 });
  } catch (err) {
    console.error('send-walk-reminders: fatal', err);
    return new Response(JSON.stringify({ ok: false, error: String(err) }), { status: 200 });
  }
});

