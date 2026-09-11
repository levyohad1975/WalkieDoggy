import { supabase, SupabaseNotConfiguredError } from './supabase';

export type VerifiedAdminIdentity = {
  userId: string;
  email: string;
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

/**
 * Starts passwordless email verification for a prospective family admin.
 *
 * Supabase must have Email sign-in enabled and its email template must expose
 * the OTP token. No family is created, and no membership/profile state is
 * written, until verifyAdminEmailOtp() establishes a confirmed session.
 */
export async function requestAdminEmailVerification(email: string): Promise<string> {
  if (!supabase) throw new SupabaseNotConfiguredError();
  const normalized = assertEmail(email);
  const { error } = await supabase.auth.signInWithOtp({
    email: normalized,
    options: { shouldCreateUser: true },
  });
  if (error) throw error;
  return normalized;
}

/**
 * Exchanges the emailed one-time code for a normal, verified Supabase session.
 * That session replaces the anonymous bootstrap session. Existing family and
 * profile semantics remain unchanged: create_family establishes
 * family_auth_members membership; profile claiming still happens separately.
 */
export async function verifyAdminEmailOtp(
  email: string,
  token: string
): Promise<VerifiedAdminIdentity> {
  if (!supabase) throw new SupabaseNotConfiguredError();
  const normalized = assertEmail(email);
  const normalizedToken = token.trim();
  if (!normalizedToken) throw new Error('יש להזין את קוד האימות');

  const { data, error } = await supabase.auth.verifyOtp({
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

/**
 * Revalidates the current identity immediately before family creation.
 * Client state is presentation only; create-family authorization remains
 * server-side and must be tightened by the Batch 2 migration/Edge Function.
 */
export async function getVerifiedAdminIdentity(): Promise<VerifiedAdminIdentity> {
  if (!supabase) throw new SupabaseNotConfiguredError();
  const { data, error } = await supabase.auth.getUser();
  if (error) throw error;
  const user = data.user;
  if (!user?.id || !user.email || !isEmailConfirmed(user)) {
    throw new Error('יש לאמת את כתובת הדוא״ל לפני יצירת המשפחה');
  }
  return { userId: user.id, email: normalizeEmail(user.email) };
}
