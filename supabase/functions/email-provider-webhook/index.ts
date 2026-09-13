// supabase/functions/email-provider-webhook/index.ts
//
// Issue #3 Batch 2 follow-up: receives Resend's delivery-event webhook
// (email.sent / email.delivered / email.bounced / email.complained /
// email.opened / email.clicked / email.delivery_delayed) and updates the
// matching email_delivery_log (0034) row so a failed or bounced send is
// observable instead of silently disappearing after the best-effort attempt
// in create-verified-family.
//
// SECURITY MODEL: Resend signs webhook deliveries the way Svix does --
// `svix-id` / `svix-timestamp` / `svix-signature` headers over the raw body,
// keyed by a per-endpoint secret (RESEND_WEBHOOK_SECRET, configured only as
// an Edge Function secret, never in this repository). This function
// verifies that signature itself before trusting anything in the body, and
// this endpoint must be deployed with `verify_jwt = false` (see
// supabase/config.toml) since Resend never sends a Supabase-issued JWT.
// A request that fails verification is rejected with 401 and never reaches
// the database. Only SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY (already
// required by create-verified-family) and RESEND_WEBHOOK_SECRET are read
// from the environment; nothing here is client-facing or CORS-enabled.

// deno-lint-ignore-file no-explicit-any
// @ts-nocheck -- executed by Supabase Edge Functions, not Metro/Node tsc.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

function response(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

// Constant-time comparison of two base64-encoded byte strings. A plain `===`
// on the decoded signature would short-circuit on the first differing byte,
// letting an attacker recover the expected HMAC one byte at a time from
// response-timing differences; this compares every byte regardless of where
// (or whether) a mismatch occurs. `candidate` is attacker-controlled (from
// the request's svix-signature header) and may not even be valid base64, so
// a decode failure is treated as a non-match rather than thrown.
function timingSafeBase64Equal(candidate: string, expected: string): boolean {
  let candidateBytes: Uint8Array;
  try {
    candidateBytes = base64ToBytes(candidate);
  } catch {
    return false;
  }
  const expectedBytes = base64ToBytes(expected);
  if (candidateBytes.length !== expectedBytes.length) return false;

  let diff = 0;
  for (let i = 0; i < expectedBytes.length; i++) {
    diff |= candidateBytes[i] ^ expectedBytes[i];
  }
  return diff === 0;
}

// Svix signature scheme: HMAC-SHA256("{id}.{timestamp}.{body}") using the
// base64-decoded secret (after its "whsec_" prefix), base64-encoded, then
// compared against every "v1,<signature>" entry in the space-separated
// svix-signature header (Resend may send more than one during key rotation).
async function verifySvixSignature(args: {
  secret: string;
  svixId: string;
  svixTimestamp: string;
  svixSignature: string;
  body: string;
}): Promise<boolean> {
  const raw = args.secret.startsWith('whsec_') ? args.secret.slice('whsec_'.length) : args.secret;
  const key = await crypto.subtle.importKey(
    'raw',
    base64ToBytes(raw),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const signedContent = `${args.svixId}.${args.svixTimestamp}.${args.body}`;
  const signatureBytes = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(signedContent));
  const expected = bytesToBase64(new Uint8Array(signatureBytes));

  return args.svixSignature
    .split(' ')
    .map((entry) => entry.split(',')[1] ?? '')
    .some((candidate) => timingSafeBase64Equal(candidate, expected));
}

const STATUS_BY_EVENT_TYPE: Record<string, string> = {
  'email.sent': 'sent',
  'email.delivered': 'delivered',
  'email.delivery_delayed': 'queued',
  'email.bounced': 'bounced',
  'email.complained': 'complained',
  'email.opened': 'opened',
  'email.clicked': 'clicked',
};

const WEBHOOK_TIMESTAMP_TOLERANCE_SECONDS = 5 * 60;

Deno.serve(async (request) => {
  if (request.method !== 'POST') return response(405, { error: 'method not allowed' });

  try {
    const secret = Deno.env.get('RESEND_WEBHOOK_SECRET') ?? '';
    const svixId = request.headers.get('svix-id') ?? '';
    const svixTimestamp = request.headers.get('svix-timestamp') ?? '';
    const svixSignature = request.headers.get('svix-signature') ?? '';
    const body = await request.text();

    if (!secret || !svixId || !svixTimestamp || !svixSignature) {
      return response(401, { error: 'missing webhook signature' });
    }

    const timestampSeconds = Number(svixTimestamp);
    if (
      !Number.isFinite(timestampSeconds) ||
      Math.abs(Date.now() / 1000 - timestampSeconds) > WEBHOOK_TIMESTAMP_TOLERANCE_SECONDS
    ) {
      return response(401, { error: 'webhook timestamp out of tolerance' });
    }

    const verified = await verifySvixSignature({ secret, svixId, svixTimestamp, svixSignature, body });
    if (!verified) return response(401, { error: 'invalid webhook signature' });

    const payload = JSON.parse(body || '{}');
    const eventType = typeof payload?.type === 'string' ? payload.type : '';
    const emailId = typeof payload?.data?.email_id === 'string' ? payload.data.email_id : '';
    const status = STATUS_BY_EVENT_TYPE[eventType];

    // Unrecognized event types (Resend may add new ones) and events without
    // a correlatable email id are acknowledged and ignored rather than
    // treated as an error -- there is nothing actionable to update.
    if (!status || !emailId) return response(200, { ignored: true });

    const url = Deno.env.get('SUPABASE_URL') ?? '';
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
    if (!url || !serviceRoleKey) throw new Error('Supabase function environment is incomplete');

    const admin = createClient(url, serviceRoleKey, { auth: { persistSession: false } });
    const errorDetail =
      eventType === 'email.bounced' || eventType === 'email.complained'
        ? JSON.stringify(payload.data ?? {})
        : null;

    const { error } = await admin.rpc('update_email_delivery_status', {
      p_provider: 'resend',
      p_provider_message_id: emailId,
      p_status: status,
      p_error: errorDetail,
    });
    if (error) throw error;

    return response(200, { ok: true });
  } catch (error) {
    console.error('email-provider-webhook failed', error instanceof Error ? error.message : error);
    return response(500, { error: 'webhook processing failed' });
  }
});
