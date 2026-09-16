#!/usr/bin/env node

/**
 * Real non-Production Staging family-creation E2E.
 *
 * Flow:
 * 1. request and verify a real email OTP through the dedicated Gmail inbox
 * 2. invoke create-verified-family with the verified session
 * 3. verify the persisted onboarding status through the authenticated RPC
 * 4. verify the invite code resolves to the same family
 * 5. verify join-family from an independent client session when active
 *
 * Safety: Staging only. No migrations, deploys, deletes, Production access,
 * service-role key, anonymous-auth requirement, or secret logging.
 */

import { createClient } from '@supabase/supabase-js';

const required = [
  'SUPABASE_STAGING_URL',
  'SUPABASE_STAGING_ANON_KEY',
  'STAGING_OTP_TEST_EMAIL',
  'STAGING_OTP_GMAIL_CLIENT_ID',
  'STAGING_OTP_GMAIL_CLIENT_SECRET',
  'STAGING_OTP_GMAIL_REFRESH_TOKEN',
];

for (const name of required) {
  if (!process.env[name]) throw new Error(`Missing required environment variable: ${name}`);
}

const supabaseUrl = process.env.SUPABASE_STAGING_URL.replace(/\/$/, '');
const anonKey = process.env.SUPABASE_STAGING_ANON_KEY;
const email = process.env.STAGING_OTP_TEST_EMAIL.trim().toLowerCase();
const gmailClientId = process.env.STAGING_OTP_GMAIL_CLIENT_ID;
const gmailClientSecret = process.env.STAGING_OTP_GMAIL_CLIENT_SECRET;
const gmailRefreshToken = process.env.STAGING_OTP_GMAIL_REFRESH_TOKEN;

if (/localhost|127\.0\.0\.1/.test(supabaseUrl)) {
  throw new Error('This harness is for the remote Staging project, not localhost.');
}

function makeClient() {
  return createClient(supabaseUrl, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

async function jsonFetch(url, options = {}) {
  const res = await fetch(url, options);
  const text = await res.text();
  let body = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  if (!res.ok) {
    throw new Error(`${options.method || 'GET'} request failed (${res.status}): ${typeof body === 'string' ? body.slice(0, 300) : JSON.stringify(body)}`);
  }
  return body;
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
  return Buffer.from(value.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
}

function collectMessageText(payload) {
  const chunks = [];
  const visit = part => {
    if (!part) return;
    if (part.body?.data && (part.mimeType === 'text/plain' || part.mimeType === 'text/html')) {
      chunks.push(decodeBase64Url(part.body.data));
    }
    for (const child of part.parts || []) visit(child);
  };
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
      const matches = text.match(/\b\d{6}\b/g) || [];
      if (matches.length) return matches[matches.length - 1];
    }
    await new Promise(resolve => setTimeout(resolve, 3000));
  }
  throw new Error('Timed out waiting for the staging OTP email.');
}

const admin = makeClient();
const startedAt = new Date();

console.log('Requesting Staging OTP...');
const { error: otpError } = await admin.auth.signInWithOtp({ email, options: { shouldCreateUser: true } });
if (otpError) throw otpError;

const otp = await readOtpFromGmail(startedAt);
console.log('OTP delivered; verifying Staging admin session...');
const { data: verifyData, error: verifyError } = await admin.auth.verifyOtp({ email, token: otp, type: 'email' });
if (verifyError) throw verifyError;
if (!verifyData?.session?.access_token || !verifyData?.session?.refresh_token || !verifyData?.user?.id) {
  throw new Error('OTP verification did not return a complete authenticated Staging session.');
}

const unique = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
const familyName = `E2E Family ${unique}`;
const dogName = `E2E Dog ${unique.slice(-5)}`;

console.log('Creating verified family in Staging...');
const { data: createData, error: createError } = await admin.functions.invoke('create-verified-family', { body: { familyName, dogName } });
if (createError) throw createError;

const family = createData?.family;
if (!family?.id || !family?.inviteCode || !['active', 'pending'].includes(family?.approvalStatus)) {
  throw new Error('create-verified-family returned an invalid family payload.');
}

console.log('Verifying persisted family onboarding status...');
const { data: statusData, error: statusError } = await admin.rpc('get_my_family_onboarding_status');
if (statusError) throw statusError;
const statusRow = Array.isArray(statusData) ? statusData[0] : statusData;
if (!statusRow || statusRow.family_id !== family.id || statusRow.family_name !== family.name) {
  throw new Error('Persisted onboarding status does not match the created family.');
}
if (statusRow.approval_status !== family.approvalStatus) {
  throw new Error('Persisted approval status does not match the create response.');
}

console.log('Verifying invite code lookup...');
const { data: lookupData, error: lookupError } = await admin.rpc('find_family_by_invite_code', { code: family.inviteCode });
if (family.approvalStatus === 'pending') {
  if (lookupError) throw lookupError;
  const pendingLookup = Array.isArray(lookupData) ? lookupData[0] : lookupData;
  if (pendingLookup) throw new Error('Pending family invite lookup must remain fail-closed until approval.');
  console.log('STAGING_FAMILY_E2E_PENDING_OK');
  console.log(`Created persisted pending family ${family.id}; invite lookup remains fail-closed until approval.`);
  process.exit(0);
}
if (lookupError) throw lookupError;
const lookupRow = Array.isArray(lookupData) ? lookupData[0] : lookupData;
if (!lookupRow || lookupRow.id !== family.id) throw new Error('Invite code did not resolve to the created active family.');

console.log('Verifying join from an independent authenticated client session...');
const secondDevice = makeClient();
const { data: secondSession, error: secondSessionError } = await secondDevice.auth.setSession({
  access_token: verifyData.session.access_token,
  refresh_token: verifyData.session.refresh_token,
});
if (secondSessionError) throw secondSessionError;
if (!secondSession?.session?.access_token) throw new Error('Independent client did not accept the authenticated Staging session.');

const { data: joinData, error: joinError } = await secondDevice.rpc('join_family', { code: family.inviteCode });
if (joinError) throw joinError;
const joinRow = Array.isArray(joinData) ? joinData[0] : joinData;
if (!joinRow || joinRow.id !== family.id) throw new Error('Independent authenticated client did not resolve/join the created family.');

console.log('STAGING_FAMILY_E2E_OK');
console.log(`Verified family persistence, invite lookup, and authenticated independent-client join for Staging family ${family.id}.`);
