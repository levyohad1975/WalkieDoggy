import { FunctionsHttpError } from '@supabase/supabase-js';
import {
  supabase,
  supabaseClientKey,
  supabaseProjectUrl,
  SupabaseNotConfiguredError,
} from './supabase';
import { withSyncIdentityFence } from './syncIdentityFence';
import { beginOtpFetchTrace, type OtpDiagnosticSink } from './emailOtpDiagnostics';

export type VerifiedAdminIdentity = {
  userId: string;
  email: string;
};

type AuthUser = {
  id: string;
  email?: string | null;
  email_confirmed_at?: string | null;
  confirmed_at?: string | null;
};

export type VerifiedAdminAuthClient = {
  signInWithOtp(args: {
    email: string;
    options: { shouldCreateUser: boolean };
  }): Promise<{ error: unknown | null }>;
  verifyOtp(args: {
    email: string;
    token: string;
    type: 'email';
  }): Promise<{
    data: { user?: AuthUser | null; session?: { user?: AuthUser | null } | null };
    error: unknown | null;
  }>;
  getUser(): Promise<{ data: { user?: AuthUser | null }; error: unknown | null }>;
};

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function assertEmail(email: string): string {
  const normalized = normalizeEmail(email);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) {
    throw new Error('יש להזין כתובת דוא״ל תקינה');
  }
  return normalized;
}

function isEmailConfirmed(user: {
  email_confirmed_at?: string | null;
  confirmed_at?: string | null;
}): boolean {
  return Boolean(user.email_confirmed_at ?? user.confirmed_at);
}

function requireAuthClient(): VerifiedAdminAuthClient {
  if (!supabase) throw new SupabaseNotConfiguredError();
  return supabase.auth as VerifiedAdminAuthClient;
}

function recordOtpDiagnostic(
  diagnostics: OtpDiagnosticSink | undefined,
  stage: Parameters<OtpDiagnosticSink['record']>[0],
  error?: unknown,
  category?: Parameters<OtpDiagnosticSink['record']>[2]
): void {
  try {
    diagnostics?.record(stage, error, category);
  } catch {
    // Temporary diagnostics must never block or change the Auth request.
  }
}

/**
 * Starts passwordless email verification for a prospective family admin.
 *
 * Supabase must have Email sign-in enabled and its email template must expose
 * the OTP token. No family is created, and no membership/profile state is
 * written, until verifyAdminEmailOtp() establishes a confirmed session.
 */
export async function requestAdminEmailVerificationWithAuth(
  auth: VerifiedAdminAuthClient,
  email: string,
  shouldCreateUser = true,
  diagnostics?: OtpDiagnosticSink
): Promise<string> {
  let normalized: string;
  try {
    normalized = assertEmail(email);
    recordOtpDiagnostic(diagnostics, 'input_validation_completed');
  } catch (error) {
    recordOtpDiagnostic(diagnostics, 'input_validation_failed', error, 'validation');
    throw error;
  }

  recordOtpDiagnostic(diagnostics, 'sign_in_with_otp_invoked');
  const fetchTrace = diagnostics ? beginOtpFetchTrace(diagnostics) : null;
  let result: { error: unknown | null };
  try {
    result = await auth.signInWithOtp({
      email: normalized,
      options: { shouldCreateUser },
    });
    recordOtpDiagnostic(diagnostics, 'promise_resolved');
  } catch (error) {
    if (fetchTrace && !fetchTrace.fetchWasInvoked()) {
      recordOtpDiagnostic(diagnostics, 'auth_client_rejected_before_fetch', error);
    }
    recordOtpDiagnostic(diagnostics, 'promise_rejected', error);
    throw error;
  } finally {
    fetchTrace?.close();
  }
  if (result.error) {
    recordOtpDiagnostic(diagnostics, 'auth_error_returned', result.error);
    throw result.error;
  }
  return normalized;
}

export function requestAdminEmailVerification(
  email: string,
  shouldCreateUser = true,
  diagnostics?: OtpDiagnosticSink
): Promise<string> {
  // iPhone Safari has shown an SDK-only failure before any Auth request is
  // issued. On the web, use the documented Auth HTTP endpoint directly with
  // the same public client credential. Native clients retain the SDK path.
  if (canUseBrowserOtpTransport()) {
    return requestAdminEmailVerificationWithBrowserTransport(
      email,
      shouldCreateUser,
      diagnostics
    );
  }

  return requestAdminEmailVerificationWithAuth(
    requireAuthClient(),
    email,
    shouldCreateUser,
    diagnostics
  );
}

/**
 * iOS Safari has intermittently rejected this app's Supabase JS OTP call
 * before the request reaches Auth, while a standard browser fetch reaches the
 * same endpoint. This path is intentionally web-only. It sends the same
 * public-client request semantics as signInWithOtp; issuing and validating the
 * OTP remains wholly server-side in Supabase Auth.
 */
async function requestAdminEmailVerificationWithBrowserTransport(
  email: string,
  shouldCreateUser: boolean,
  diagnostics?: OtpDiagnosticSink
): Promise<string> {
  let normalized: string;
  try {
    normalized = assertEmail(email);
    recordOtpDiagnostic(diagnostics, 'input_validation_completed');
  } catch (error) {
    recordOtpDiagnostic(diagnostics, 'input_validation_failed', error, 'validation');
    throw error;
  }

  recordOtpDiagnostic(diagnostics, 'sign_in_with_otp_invoked');
  try {
    await requestEmailOtpOverBrowserTransport(normalized, shouldCreateUser);
    recordOtpDiagnostic(diagnostics, 'promise_resolved');
    return normalized;
  } catch (error) {
    recordOtpDiagnostic(diagnostics, 'promise_rejected', error);
    throw error;
  }
}

function canUseBrowserOtpTransport(): boolean {
  if (typeof window === 'undefined'
    || typeof XMLHttpRequest === 'undefined'
    || !supabaseProjectUrl
    || !supabaseClientKey) {
    return false;
  }
  return true;
}

function browserOtpEndpoint(): string {
  // Production Safari has rejected this cross-origin Auth request before it
  // reached Supabase. On the public Production host, keep the browser request
  // same-origin and let the narrowly scoped Vercel rewrite forward only this
  // OTP endpoint. Staging and previews continue to call their own Supabase
  // project directly. Use an absolute URL: Expo's web fetch implementation
  // can reject a relative URL before it ever starts a browser request.
  if (window.location?.hostname.toLowerCase() === 'walkielink.co.il') {
    return `${window.location.origin}/_walkie-auth/otp`;
  }

  return `${supabaseProjectUrl.replace(/\/$/, '')}/auth/v1/otp`;
}

async function requestEmailOtpOverBrowserTransport(
  email: string,
  shouldCreateUser: boolean
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    let settled = false;
    const fail = (reason: string, status?: number, code?: string) => {
      if (settled) return;
      settled = true;
      const error = new Error(reason) as Error & { status?: number; code?: string };
      if (status !== undefined) error.status = status;
      if (code) error.code = code;
      reject(error);
    };
    try {
      xhr.open('POST', browserOtpEndpoint(), true);
      xhr.timeout = 15000;
      xhr.withCredentials = false;
      xhr.setRequestHeader('apikey', supabaseClientKey);
      xhr.setRequestHeader('Authorization', `Bearer ${supabaseClientKey}`);
      xhr.setRequestHeader('Content-Type', 'application/json;charset=UTF-8');
      xhr.onload = () => {
        if (settled) return;
        if (xhr.status >= 200 && xhr.status < 300) {
          settled = true;
          resolve();
          return;
        }
        let code: string | undefined;
        try {
          const body: unknown = JSON.parse(xhr.responseText);
          if (body && typeof body === 'object' && 'code' in body
            && typeof body.code === 'string') code = body.code;
        } catch { /* Never surface the response body or personal data. */ }
        fail('email OTP request failed', xhr.status, code);
      };
      xhr.onerror = () => fail('email OTP network error');
      xhr.ontimeout = () => fail('email OTP timeout');
      xhr.onabort = () => fail('email OTP aborted');
      xhr.send(JSON.stringify({
        email,
        data: {},
        create_user: shouldCreateUser,
        gotrue_meta_security: {},
      }));
    } catch {
      fail('email OTP transport initialization failed');
    }
  });
}

/**
 * Exchanges the emailed one-time code for a normal, verified Supabase session.
 * That session replaces the anonymous bootstrap session. Existing family and
 * profile semantics remain unchanged: create_family establishes
 * family_auth_members membership; profile claiming still happens separately.
 */
export async function verifyAdminEmailOtpWithAuth(
  auth: VerifiedAdminAuthClient,
  email: string,
  token: string
): Promise<VerifiedAdminIdentity> {
  const normalized = assertEmail(email);
  const normalizedToken = token.trim();
  if (!normalizedToken) throw new Error('יש להזין את קוד האימות');

  const { data, error } = await withSyncIdentityFence(async () => await auth.verifyOtp({
    email: normalized,
    token: normalizedToken,
    type: 'email',
  }));
  if (error) throw error;

  const user = data.user ?? data.session?.user;
  if (!user?.id || !user.email || !isEmailConfirmed(user)) {
    throw new Error('אימות הדוא״ל לא הושלם');
  }

  return { userId: user.id, email: normalizeEmail(user.email) };
}

export function verifyAdminEmailOtp(
  email: string,
  token: string
): Promise<VerifiedAdminIdentity> {
  return verifyAdminEmailOtpWithAuth(requireAuthClient(), email, token);
}

/**
 * Revalidates the current identity immediately before family creation.
 * Client state is presentation only; create-family authorization remains
 * server-side and must be tightened by the Batch 2 migration/Edge Function.
 */
export async function getVerifiedAdminIdentityWithAuth(
  auth: VerifiedAdminAuthClient
): Promise<VerifiedAdminIdentity> {
  const { data, error } = await auth.getUser();
  if (error) throw error;
  const user = data.user;
  if (!user?.id || !user.email || !isEmailConfirmed(user)) {
    throw new Error('יש לאמת את כתובת הדוא״ל לפני יצירת המשפחה');
  }
  return { userId: user.id, email: normalizeEmail(user.email) };
}

export function getVerifiedAdminIdentity(): Promise<VerifiedAdminIdentity> {
  return getVerifiedAdminIdentityWithAuth(requireAuthClient());
}


export type VerifiedFamilyCreationResult = {
  id: string;
  name: string;
  inviteCode: string;
  approvalStatus: 'pending' | 'active';
  warnings: string[];
};

/**
 * supabase-js's FunctionsHttpError hard-codes its own .message to a generic
 * "Edge Function returned a non-2xx status code" for every non-2xx status,
 * discarding the specific reason create-verified-family/index.ts already
 * computed and returned in its JSON body (e.g. "verified email identity
 * required" for a lapsed/anonymous session). That reason only survives on
 * error.context, the unread Response object. Recovering it here lets
 * friendlyErrorMessage()'s SHARED_ERROR_RULES match the real cause instead
 * of always falling back to a generic "something went wrong" message.
 */
async function edgeFunctionErrorReason(error: unknown): Promise<string | null> {
  if (!(error instanceof FunctionsHttpError)) return null;
  try {
    const body = await error.context.json();
    return typeof body?.error === 'string' ? body.error : null;
  } catch {
    return null;
  }
}

/**
 * families.timezone (0022) defaults new rows to 'Asia/Jerusalem' as a
 * backfill compatibility value for pre-existing families only -- that
 * migration's own header is explicit that family creation must determine
 * each NEW family's real timezone rather than silently inheriting the
 * default (see 0036_create_verified_family_timezone.sql). Sending the
 * device's own resolved IANA zone here is what makes the walk reminder
 * scheduler (0025) and current_family_local_date() (0027) correct for a
 * family outside Israel; create_verified_family() (0036) still falls back
 * to the schema default itself if this is ever missing or invalid.
 */
function deviceTimezone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

/**
 * Creates a family only through the server-authoritative Edge Function.
 * The function derives the caller from the bearer token and reads
 * AUTO_APPROVE_NEW_FAMILIES from its own environment; neither value is
 * accepted from the client. `timezone` is a client-supplied preference
 * (like familyName/dogName), not a security-sensitive value -- the server
 * validates it and falls back safely if it's missing or malformed.
 */
export async function createVerifiedFamily(
  familyName: string,
  dogName?: string
): Promise<VerifiedFamilyCreationResult> {
  if (!supabase) throw new SupabaseNotConfiguredError();
  const { data, error } = await supabase.functions.invoke('create-verified-family', {
    body: {
      familyName: familyName.trim(),
      dogName: dogName?.trim() || null,
      timezone: deviceTimezone(),
    },
  });
  if (error) {
    const reason = await edgeFunctionErrorReason(error);
    throw reason ? new Error(reason) : error;
  }

  const family = data?.family;
  if (
    !family?.id ||
    !family?.name ||
    !family?.inviteCode ||
    (family.approvalStatus !== 'active' && family.approvalStatus !== 'pending')
  ) {
    throw new Error('יצירת המשפחה נכשלה');
  }

  return {
    id: family.id,
    name: family.name,
    inviteCode: family.inviteCode,
    approvalStatus: family.approvalStatus,
    warnings: Array.isArray(data?.warnings) ? data.warnings : [],
  };
}

export type FamilyOnboardingStatus = {
  familyId: string;
  familyName: string;
  approvalStatus: 'pending' | 'active' | 'rejected';
};

/**
 * Reads the caller's own family-creation request (if any) via
 * get_my_family_onboarding_status() (0032) -- the "status RPC" its own
 * migration comment names as one of only two supported surfaces for
 * family_onboarding_requests (the other being the create-verified-family
 * Edge Function itself). Lets a device that already holds a verified
 * (non-anonymous) session recover pending/active state after an app
 * restart, without redoing email OTP verification just to check whether a
 * system admin has acted. Returns null when the caller has no onboarding
 * request (never created a family, or is still on an anonymous session).
 */
export async function getMyFamilyOnboardingStatus(): Promise<FamilyOnboardingStatus | null> {
  if (!supabase) throw new SupabaseNotConfiguredError();
  const { data, error } = await supabase.rpc('get_my_family_onboarding_status');
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  if (!row?.family_id) return null;
  return {
    familyId: row.family_id,
    familyName: row.family_name,
    approvalStatus: row.approval_status,
  };
}
