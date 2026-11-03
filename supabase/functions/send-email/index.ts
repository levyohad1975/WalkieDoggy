// supabase/functions/send-email/index.ts
//
// Supabase Auth "Send Email Hook": Auth calls this function server-to-server
// instead of sending its own built-in auth emails, so the app can deliver
// Hebrew-friendly, Walkie-Doggy-branded OTP emails through Resend. This
// covers the same passwordless-email-OTP flow verifiedAdminOnboarding.ts
// drives client-side (signInWithOtp / verifyOtp), plus any other Supabase
// Auth email Auth chooses to route through this hook (magic link, recovery,
// invite, email change, reauthentication).
//
// SECURITY MODEL: Auth signs every call using the Standard Webhooks
// specification (https://www.standardwebhooks.com/) with a per-project
// secret (SEND_EMAIL_HOOK_SECRET, configured only as an Edge Function
// secret, never in this repository) -- it never sends a Supabase-issued
// JWT, since there is no end-user session at hook-call time. This function
// therefore must be deployed with `verify_jwt = false` (see
// supabase/config.toml) and performs its own signature check via the
// official `standardwebhooks` verifier BEFORE the request body is treated
// as trusted JSON: `req.text()` only reads raw bytes, and `wh.verify()`
// checks the signature over those exact bytes and only then returns the
// parsed `{ user, email_data }` object. A request that fails verification
// is rejected with 401 and its body is never inspected beyond that raw
// text. This mirrors the official Supabase Send Email Hook pattern
// (https://supabase.com/docs/guides/auth/auth-hooks/send-email-hook).
//
// LOGGING: `email_data.token` is the numeric OTP a recipient uses to sign
// in -- as sensitive as a password for the lifetime of that code. Nothing
// in this file ever logs the OTP, the hook secret, the Resend API key, an
// Authorization/bearer value, or the raw/parsed webhook payload; only a
// fixed, generic message is logged on failure.

// deno-lint-ignore-file no-explicit-any
// @ts-nocheck -- executed by Supabase Edge Functions, not Metro/Node tsc.

import { Webhook } from 'npm:standardwebhooks@1.0.0';

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

const SUBJECT_BY_ACTION_TYPE: Record<string, string> = {
  signup: 'קוד האימות שלך ל-Walkie Doggy Link',
  email: 'קוד האימות שלך ל-Walkie Doggy Link',
  magiclink: 'קוד ההתחברות שלך ל-Walkie Doggy Link',
  recovery: 'קוד לשחזור הגישה ל-Walkie Doggy Link',
  invite: 'קוד ההצטרפות שלך ל-Walkie Doggy Link',
  email_change: 'קוד לאישור שינוי כתובת הדוא"ל ב-Walkie Doggy Link',
  reauthentication: 'קוד לאימות מחדש ב-Walkie Doggy Link',
};

// Every action type above carries a numeric email_data.token (see the hook's
// documented payload shape) -- this is the single template used for all of
// them, differing only by subject/lead line, since the app's own OTP-entry
// screen (FamilyOnboardingScreen.tsx) always expects the same style of code.
//
// iOS/macOS offer an emailed one-time code above the keyboard ("From Mail")
// only when Mail recognizes it. Recognition is most reliable when the code
// sits next to an explicit "code" phrase on one line, appears in the subject,
// and a plain-text part is present, so the code is placed first in the
// subject and repeated in an English line in both parts. The input field
// already declares autocomplete="one-time-code".
function templateFor(
  actionType: string,
  token: string
): { subject: string; html: string; text: string } {
  const lead = SUBJECT_BY_ACTION_TYPE[actionType] ?? SUBJECT_BY_ACTION_TYPE.signup;
  const safeToken = escapeHtml(token);
  const subject = `${token} - ${lead}`;
  const html = `<div dir="rtl"><h1>Walkie Doggy Link</h1><p>קוד האימות שלך: <strong style="font-size:28px;letter-spacing:6px;">${safeToken}</strong></p><p dir="ltr">Your Walkie Doggy Link verification code is ${safeToken}</p><p>הקוד תקף לזמן מוגבל. אם לא ביקשת אותו, אפשר להתעלם מהודעה זו בבטחה.</p></div>`;
  const text = `קוד האימות שלך: ${token}\nYour Walkie Doggy Link verification code is ${token}\n\nהקוד תקף לזמן מוגבל. אם לא ביקשת אותו, אפשר להתעלם מהודעה זו בבטחה.`;
  return { subject, html, text };
}

async function sendViaResend(args: { to: string; subject: string; html: string; text: string }): Promise<void> {
  const apiKey = Deno.env.get('RESEND_API_KEY') ?? '';
  const from = Deno.env.get('WELCOME_EMAIL_FROM') ?? '';
  if (!apiKey || !from) throw new Error('email provider is not configured');

  const result = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ from, to: [args.to], subject: args.subject, html: args.html, text: args.text }),
  });
  if (!result.ok) throw new Error(`email provider returned ${result.status}`);
}

function jsonErrorResponse(status: number, message: string): Response {
  return new Response(JSON.stringify({ error: { http_code: status, message } }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') {
    return new Response('not allowed', { status: 400 });
  }

  const hookSecretRaw = Deno.env.get('SEND_EMAIL_HOOK_SECRET') ?? '';
  if (!hookSecretRaw) {
    console.error('send-email hook is not configured');
    return jsonErrorResponse(500, 'send-email hook is not configured');
  }

  // Standard Webhooks secrets are distributed as "v1,whsec_<base64>"; the
  // verifier itself only wants the base64 portion.
  const hookSecret = hookSecretRaw.replace('v1,whsec_', '');
  const wh = new Webhook(hookSecret);

  // Raw bytes only -- never parsed as JSON before the signature over these
  // exact bytes has been checked.
  const payload = await req.text();
  const headers = Object.fromEntries(req.headers);

  let user: { email?: string };
  let email_data: { token?: string; email_action_type?: string };
  try {
    const verified = wh.verify(payload, headers) as {
      user: { email: string };
      email_data: {
        token: string;
        token_hash: string;
        redirect_to: string;
        email_action_type: string;
        site_url: string;
      };
    };
    user = verified.user;
    email_data = verified.email_data;
  } catch {
    console.error('send-email signature verification failed');
    return jsonErrorResponse(401, 'invalid webhook signature');
  }

  if (!user?.email || !email_data?.token) {
    console.error('send-email is missing a required field after verification');
    return jsonErrorResponse(400, 'missing recipient email or token');
  }

  const { subject, html, text } = templateFor(email_data.email_action_type ?? 'signup', email_data.token);

  try {
    await sendViaResend({ to: user.email, subject, html, text });
  } catch {
    console.error('send-email provider send failed');
    return jsonErrorResponse(500, 'email provider failed');
  }

  return new Response(JSON.stringify({}), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
});
