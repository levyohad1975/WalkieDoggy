#!/usr/bin/env node

/**
 * Real Staging OTP E2E harness.
 *
 * Safety: this script only targets the explicitly provided non-Production
 * Supabase URL and never performs migrations, deploys, deletes, or writes to
 * Production. It requests an email OTP, retrieves the newest matching OTP
 * from a dedicated Gmail test inbox using read-only OAuth, and verifies that
 * OTP against Supabase Auth. It exits non-zero unless a real authenticated
 * session is returned.
 */

const required = [
  'SUPABASE_STAGING_URL',
  'SUPABASE_STAGING_ANON_KEY',
  'STAGING_OTP_TEST_EMAIL',
  'STAGING_OTP_GMAIL_CLIENT_ID',
  'STAGING_OTP_GMAIL_CLIENT_SECRET',
  'STAGING_OTP_GMAIL_REFRESH_TOKEN',
];

for (const name of required) {
  if (!process.env[name]) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
}

const supabaseUrl = process.env.SUPABASE_STAGING_URL.replace(/\/$/, '');
const anonKey = process.env.SUPABASE_STAGING_ANON_KEY;
const email = process.env.STAGING_OTP_TEST_EMAIL;
const gmailClientId = process.env.STAGING_OTP_GMAIL_CLIENT_ID;
const gmailClientSecret = process.env.STAGING_OTP_GMAIL_CLIENT_SECRET;
const gmailRefreshToken = process.env.STAGING_OTP_GMAIL_REFRESH_TOKEN;

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

async function getGmailAccessToken() {
  const body = new URLSearchParams({
    client_id: gmailClientId,
    client_secret: gmailClientSecret,
    refresh_token: gmailRefreshToken,
    grant_type: 'refresh_token',
  });
  const token = await jsonFetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  if (!token?.access_token) throw new Error('Google OAuth refresh did not return an access token.');
  return token.access_token;
}

function decodeBase64Url(value = '') {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  return Buffer.from(normalized, 'base64').toString('utf8');
}

function collectMessageText(payload) {
  const chunks = [];
  function visit(part) {
    if (!part) return;
    if (part.body?.data && (part.mimeType === 'text/plain' || part.mimeType === 'text/html')) {
      chunks.push(decodeBase64Url(part.body.data));
    }
    for (const child of part.parts || []) visit(child);
  }
  visit(payload);
  return chunks.join('\n');
}

async function readOtpFromGmail(startedAt) {
  const accessToken = await getGmailAccessToken();
  const deadline = Date.now() + 90_000;
  const startedMs = startedAt.getTime();

  while (Date.now() < deadline) {
    const query = encodeURIComponent(`to:${email} newer_than:1d`);
    const list = await jsonFetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages?q=${query}&maxResults=10`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    for (const item of list?.messages || []) {
      const message = await jsonFetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(item.id)}?format=full`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      const receivedMs = Number(message?.internalDate || 0);
      if (!receivedMs || receivedMs < startedMs - 5000) continue;
      const headers = Object.fromEntries((message?.payload?.headers || []).map(h => [String(h.name || '').toLowerCase(), h.value || '']));
      const text = [headers.subject, headers.from, collectMessageText(message?.payload)].filter(Boolean).join('\n');
      const matches = text.match(/\b\d{8}\b/g) || [];
      if (matches.length) return matches[matches.length - 1];
    }

    await new Promise(r => setTimeout(r, 3000));
  }
  throw new Error('Timed out waiting for an 8-digit OTP in the Gmail staging test inbox.');
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
console.log('OTP request accepted; waiting for Gmail test mailbox delivery...');
const token = await readOtpFromGmail(startedAt);
console.log('OTP received by Gmail test mailbox; verifying against Staging Supabase...');
const verified = await verifyOtp(token);

if (!verified?.access_token || !verified?.user?.id) {
  throw new Error('OTP verification did not return an authenticated session.');
}

console.log('STAGING_OTP_E2E_OK');
console.log(`Authenticated staging user: ${verified.user.id}`);
