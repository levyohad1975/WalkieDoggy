import { supabase, SupabaseNotConfiguredError } from './supabase';

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

/**
 * Starts passwordless email verification for a prospective family admin.
 *
 * Supabase must have Email sign-in enabled and its email template must expose
 * the OTP token. No family is created, and no membership/profile state is
 * written, until verifyAdminEmailOtp() establishes a confirmed session.
 */
export async function requestAdminEmailVerificationWithAuth(
  auth: VerifiedAdminAuthClient,
  email: string
): Promise<string> {
  const normalized = assertEmail(email);
  const { error } = await auth.signInWithOtp({
    email: normalized,
    options: { shouldCreateUser: true },
  });
  if (error) throw error;
  return normalized;
}

export function requestAdminEmailVerification(email: string): Promise<string> {
  return requestAdminEmailVerificationWithAuth(requireAuthClient(), email);
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

  const { data, error } = await auth.verifyOtp({
    email: normalized,
    token: normalizedToken,
    type: 'email',
  });
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
 * Creates a family only through the server-authoritative Edge Function.
 * The function derives the caller from the bearer token and reads
 * AUTO_APPROVE_NEW_FAMILIES from its own environment; neither value is
 * accepted from the client.
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
    },
  });
  if (error) throw error;

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
