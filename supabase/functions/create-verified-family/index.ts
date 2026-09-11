// supabase/functions/create-verified-family/index.ts
// deno-lint-ignore-file no-explicit-any
// @ts-nocheck -- executed by Supabase Edge Functions, not Metro/Node tsc.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
};

function response(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  });
}

function autoApproveFromEnvironment(): boolean {
  const raw = (Deno.env.get('AUTO_APPROVE_NEW_FAMILIES') ?? 'true').trim().toLowerCase();
  if (raw !== 'true' && raw !== 'false') {
    throw new Error('AUTO_APPROVE_NEW_FAMILIES must be true or false');
  }
  return raw === 'true';
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

async function sendEmail(args: {
  to: string;
  subject: string;
  html: string;
}): Promise<string> {
  const apiKey = Deno.env.get('RESEND_API_KEY') ?? '';
  const from = Deno.env.get('WELCOME_EMAIL_FROM') ?? '';
  if (!apiKey || !from) throw new Error('email provider is not configured');

  const result = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ from, to: [args.to], subject: args.subject, html: args.html }),
  });
  const payload = await result.json().catch(() => ({}) as Record<string, unknown>);
  if (!result.ok) throw new Error(`email provider returned ${result.status}`);
  return typeof payload.id === 'string' ? payload.id : '';
}

// Records every send attempt in email_delivery_log (0034) so delivery
// failures are observable and so the provider webhook (email-provider-
// webhook) can later correlate bounce/complaint/open events back to this
// attempt by provider_message_id. Logging failures are swallowed -- they
// must never turn a best-effort email failure into a harder failure, and
// must never affect the `warnings` returned to the caller beyond the
// existing per-message warning below.
async function sendAndLogEmail(
  admin: ReturnType<typeof createClient>,
  args: {
    familyId: string;
    authUserId: string | null;
    messageType: 'family_welcome' | 'system_owner_new_family';
    to: string;
    subject: string;
    html: string;
  }
): Promise<boolean> {
  try {
    const providerMessageId = await sendEmail({ to: args.to, subject: args.subject, html: args.html });
    await admin
      .rpc('record_email_delivery_attempt', {
        p_family_id: args.familyId,
        p_auth_user_id: args.authUserId,
        p_message_type: args.messageType,
        p_recipient_email: args.to,
        p_status: 'sent',
        p_provider: 'resend',
        p_provider_message_id: providerMessageId || null,
        p_error: null,
      })
      .then(({ error }) => {
        if (error) console.error('record_email_delivery_attempt (sent) failed', error.message);
      });
    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await admin
      .rpc('record_email_delivery_attempt', {
        p_family_id: args.familyId,
        p_auth_user_id: args.authUserId,
        p_message_type: args.messageType,
        p_recipient_email: args.to,
        p_status: 'failed',
        p_provider: 'resend',
        p_provider_message_id: null,
        p_error: message,
      })
      .then(({ error: logError }) => {
        if (logError) console.error('record_email_delivery_attempt (failed) failed', logError.message);
      });
    return false;
  }
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (request.method !== 'POST') return response(405, { error: 'method not allowed' });

  try {
    const authorization = request.headers.get('Authorization') ?? '';
    if (!authorization.startsWith('Bearer ')) {
      return response(401, { error: 'missing authorization' });
    }

    const url = Deno.env.get('SUPABASE_URL') ?? '';
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
    if (!url || !anonKey || !serviceRoleKey) {
      throw new Error('Supabase function environment is incomplete');
    }

    const userClient = createClient(url, anonKey, {
      global: { headers: { Authorization: authorization } },
      auth: { persistSession: false },
    });
    const { data: userData, error: userError } = await userClient.auth.getUser();
    const user = userData.user;
    if (
      userError ||
      !user?.id ||
      !user.email ||
      user.is_anonymous === true ||
      !user.email_confirmed_at
    ) {
      return response(403, { error: 'verified email identity required' });
    }

    const body = await request.json().catch(() => ({}));
    const familyName = typeof body.familyName === 'string' ? body.familyName.trim() : '';
    const dogName = typeof body.dogName === 'string' ? body.dogName.trim() : null;
    if (!familyName) return response(400, { error: 'familyName is required' });

    const autoApprove = autoApproveFromEnvironment();
    const admin = createClient(url, serviceRoleKey, { auth: { persistSession: false } });
    const { data, error } = await admin.rpc('create_verified_family', {
      p_auth_user_id: user.id,
      p_family_name: familyName,
      p_dog_name: dogName || null,
      p_auto_approve: autoApprove,
    });
    if (error) throw error;

    const row = Array.isArray(data) ? data[0] : data;
    if (!row) throw new Error('family creation returned no result');

    const warnings: string[] = [];
    const appUrl = (Deno.env.get('APP_PUBLIC_URL') ?? '').replace(/\/$/, '');
    const joinLink = appUrl ? `${appUrl}/invite/${encodeURIComponent(row.invite_code)}` : '';
    const qrLink = joinLink ? `${joinLink}?view=qr` : '';

    if (row.created) {
      if (appUrl) {
        const safeName = escapeHtml(row.name);
        const safeCode = escapeHtml(row.invite_code);
        const safeJoin = escapeHtml(joinLink);
        const safeQr = escapeHtml(qrLink);
        const welcomeSent = await sendAndLogEmail(admin, {
          familyId: row.id,
          authUserId: user.id,
          messageType: 'family_welcome',
          to: user.email,
          subject: `ברוכים הבאים ל-Walkie Doggy Link — ${row.name}`,
          html: `<div dir="rtl"><h1>ברוכים הבאים ל-Walkie Doggy Link</h1><p>המשפחה <strong>${safeName}</strong> נוצרה.</p><p>קוד ההצטרפות: <strong>${safeCode}</strong></p><p><a href="${safeJoin}">קישור להצטרפות למשפחה</a></p><p><a href="${safeQr}">פתיחת קוד QR להצטרפות</a></p><p><a href="${escapeHtml(appUrl)}">פתיחת האפליקציה</a></p></div>`,
        });
        if (!welcomeSent) warnings.push('welcome_email_not_sent');
      } else {
        warnings.push('app_public_url_not_configured');
      }

      const ownerEmail = (Deno.env.get('SYSTEM_OWNER_EMAIL') ?? '').trim();
      if (ownerEmail) {
        const ownerSent = await sendAndLogEmail(admin, {
          familyId: row.id,
          authUserId: null,
          messageType: 'system_owner_new_family',
          to: ownerEmail,
          subject: `Walkie Doggy Link — משפחה חדשה: ${row.name}`,
          html: `<div dir="rtl"><p>נוצרה משפחה חדשה: <strong>${escapeHtml(row.name)}</strong></p><p>סטטוס: ${escapeHtml(row.approval_status)}</p><p>מזהה: ${escapeHtml(row.id)}</p></div>`,
        });
        if (!ownerSent) warnings.push('system_owner_notification_not_sent');
      } else {
        warnings.push('system_owner_email_not_configured');
      }
    }

    return response(200, {
      family: {
        id: row.id,
        name: row.name,
        inviteCode: row.invite_code,
        approvalStatus: row.approval_status,
      },
      warnings,
    });
  } catch (error) {
    console.error('create-verified-family failed', error instanceof Error ? error.message : error);
    return response(500, { error: 'family creation failed' });
  }
});
