#!/usr/bin/env node

/**
 * Real Staging OTP E2E harness.
 *
 * Safety: this script only targets the explicitly provided non-Production
 * Supabase URL and never performs migrations, deploys, deletes, or writes to
 * Production. It requests an email OTP, retrieves the newest matching OTP
 * from an isolated test mailbox provider, and verifies that OTP against
 * Supabase Auth. It exits non-zero unless a real authenticated session is
 * returned.
 */

const required = [
  'SUPABASE_STAGING_URL',
  'SUPABASE_STAGING_ANON_KEY',
  'STAGING_OTP_TEST_EMAIL',
  'STAGING_OTP_MAILBOX_TOKEN',
];

for (const name of required) {
  if (!process.env[name]) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
}

const supabaseUrl = process.env.SUPABASE_STAGING_URL.replace(/\/$/, '');
const anonKey = process.env.SUPABASE_STAGING_ANON_KEY;
const email = process.env.STAGING_OTP_TEST_EMAIL;
const mailboxToken = process.env.STAGING_OTP_MAILBOX_TOKEN;
const provider = (process.env.STAGING_OTP_MAILBOX_PROVIDER || 'mailosaur').toLowerCase();

if (/localhost|127\.0\.0\.1/.test(supabaseUrl)) {
  throw new Error('This workflow is intended for the remote Staging project, not localhost.');
}

async function jsonFetch(url, options = {}) {
  const res = await fetch(url, options);
  const text = await res.text();
  let body = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  if (!res.ok) {
    throw new Error(`${options.method || 'GET'} ${url} failed (${res.status}): ${typeof body === 'string' ? body.slice(0, 300) : JSON.stringify(body)}`);
  }
  return body;
}

async function requestOtp() {
  await jsonFetch(`${supabaseUrl}/auth/v1/otp`, {
    method: 'POST',
    headers: {
      apikey: anonKey,
      Authorization: `Bearer ${anonKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ email, create_user: true }),
  });
}

async function readOtpFromMailosaur(startedAt) {
  const serverId = process.env.STAGING_OTP_MAILOSAUR_SERVER_ID;
  if (!serverId) {
    throw new Error('Mailosaur provider requires STAGING_OTP_MAILOSAUR_SERVER_ID.');
  }
  const auth = Buffer.from(`${mailboxToken}:`).toString('base64');
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    const search = await jsonFetch(`https://mailosaur.com/api/messages/await?server=${encodeURIComponent(serverId)}`, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${auth}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ sentTo: email, receivedAfter: startedAt.toISOString() }),
    });
    const text = [search?.subject, search?.text?.body, search?.html?.body].filter(Boolean).join('\n');
    const matches = text.match(/\b\d{6}\b/g) || [];
    if (matches.length) return matches[matches.length - 1];
    await new Promise(r => setTimeout(r, 3000));
  }
  throw new Error('Timed out waiting for a 6-digit OTP in the staging mailbox.');
}

async function readOtp(startedAt) {
  if (provider === 'mailosaur') return readOtpFromMailosaur(startedAt);
  throw new Error(`Unsupported STAGING_OTP_MAILBOX_PROVIDER: ${provider}`);
}

async function verifyOtp(token) {
  return jsonFetch(`${supabaseUrl}/auth/v1/verify`, {
    method: 'POST',
    headers: {
      apikey: anonKey,
      Authorization: `Bearer ${anonKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ email, token, type: 'email' }),
  });
}

const startedAt = new Date();
console.log('Requesting real email OTP from Staging Supabase...');
await requestOtp();
console.log('OTP request accepted; waiting for test mailbox delivery...');
const token = await readOtp(startedAt);
console.log('OTP received by isolated test mailbox; verifying against Staging Supabase...');
const verified = await verifyOtp(token);

if (!verified?.access_token || !verified?.user?.id) {
  throw new Error('OTP verification did not return an authenticated session.');
}

console.log('STAGING_OTP_E2E_OK');
console.log(`Authenticated staging user: ${verified.user.id}`);
