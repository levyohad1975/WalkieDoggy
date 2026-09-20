import { FunctionsHttpError } from '@supabase/supabase-js';
import {
  createVerifiedFamily,
  getMyFamilyOnboardingStatus,
  getVerifiedAdminIdentity,
  getVerifiedAdminIdentityWithAuth,
  requestAdminEmailVerification,
  requestAdminEmailVerificationWithAuth,
  verifyAdminEmailOtp,
  verifyAdminEmailOtpWithAuth,
  type VerifiedAdminAuthClient,
} from '../verifiedAdminOnboarding';
import { supabase } from '../supabase';

// Defined as a literal inside the factory (not a closed-over outer const) so
// there is no risk of the mock referencing an as-yet-uninitialized variable
// — see scheduleStore.loadResult.test.ts's comment for why that pattern
// matters with jest.mock()'s hoisting.
jest.mock('../supabase', () => ({
  supabase: {
    functions: { invoke: jest.fn() },
    auth: { signInWithOtp: jest.fn(), verifyOtp: jest.fn(), getUser: jest.fn() },
    rpc: jest.fn(),
  },
  SupabaseNotConfiguredError: class SupabaseNotConfiguredError extends Error {},
}));

const mockInvoke = (supabase as unknown as { functions: { invoke: jest.Mock } }).functions
  .invoke;
const mockAuth = (supabase as unknown as { auth: jest.Mocked<VerifiedAdminAuthClient> }).auth;
const mockRpc = (supabase as unknown as { rpc: jest.Mock }).rpc;

function authClient(): jest.Mocked<VerifiedAdminAuthClient> {
  return {
    signInWithOtp: jest.fn(),
    verifyOtp: jest.fn(),
    getUser: jest.fn(),
  };
}

describe('verified admin onboarding', () => {
  it('normalizes the email and requests a passwordless verification code', async () => {
    const auth = authClient();
    auth.signInWithOtp.mockResolvedValue({ error: null });

    await expect(
      requestAdminEmailVerificationWithAuth(auth, '  Admin@Example.COM ')
    ).resolves.toBe('admin@example.com');
    expect(auth.signInWithOtp).toHaveBeenCalledWith({
      email: 'admin@example.com',
      options: { shouldCreateUser: true },
    });
  });

  it('rejects an invalid email before calling Supabase', async () => {
    const auth = authClient();

    await expect(
      requestAdminEmailVerificationWithAuth(auth, 'not-an-email')
    ).rejects.toThrow('כתובת דוא״ל תקינה');
    expect(auth.signInWithOtp).not.toHaveBeenCalled();
  });

  it('returns only an identity established by a confirmed email OTP', async () => {
    const auth = authClient();
    auth.verifyOtp.mockResolvedValue({
      data: {
        user: {
          id: 'auth-user-1',
          email: 'Admin@Example.COM',
          email_confirmed_at: '2026-09-11T07:00:00Z',
        },
        session: null,
      },
      error: null,
    });

    await expect(
      verifyAdminEmailOtpWithAuth(auth, 'admin@example.com', ' 123456 ')
    ).resolves.toEqual({
      userId: 'auth-user-1',
      email: 'admin@example.com',
    });
    expect(auth.verifyOtp).toHaveBeenCalledWith({
      email: 'admin@example.com',
      token: '123456',
      type: 'email',
    });
  });

  it('fails closed when Supabase does not report a confirmed email', async () => {
    const auth = authClient();
    auth.verifyOtp.mockResolvedValue({
      data: {
        user: { id: 'auth-user-1', email: 'admin@example.com', email_confirmed_at: null },
        session: null,
      },
      error: null,
    });

    await expect(
      verifyAdminEmailOtpWithAuth(auth, 'admin@example.com', '123456')
    ).rejects.toThrow('אימות הדוא״ל לא הושלם');
  });

  it('revalidates the current verified identity before family creation', async () => {
    const auth = authClient();
    auth.getUser.mockResolvedValue({
      data: {
        user: {
          id: 'auth-user-1',
          email: 'ADMIN@example.com',
          confirmed_at: '2026-09-11T07:00:00Z',
        },
      },
      error: null,
    });

    await expect(getVerifiedAdminIdentityWithAuth(auth)).resolves.toEqual({
      userId: 'auth-user-1',
      email: 'admin@example.com',
    });
  });

  it('propagates a Supabase error instead of returning a normalized email', async () => {
    const auth = authClient();
    const supabaseError = new Error('rate limited');
    auth.signInWithOtp.mockResolvedValue({ error: supabaseError });

    await expect(
      requestAdminEmailVerificationWithAuth(auth, 'admin@example.com')
    ).rejects.toBe(supabaseError);
  });

  it('rejects an empty/whitespace-only OTP code before calling Supabase', async () => {
    const auth = authClient();

    await expect(
      verifyAdminEmailOtpWithAuth(auth, 'admin@example.com', '   ')
    ).rejects.toThrow('קוד האימות');
    expect(auth.verifyOtp).not.toHaveBeenCalled();
  });

  it('propagates a Supabase error from OTP verification', async () => {
    const auth = authClient();
    const supabaseError = new Error('invalid token');
    auth.verifyOtp.mockResolvedValue({ data: { user: null }, error: supabaseError });

    await expect(
      verifyAdminEmailOtpWithAuth(auth, 'admin@example.com', '123456')
    ).rejects.toBe(supabaseError);
  });

  it('falls back to the session user when the response has no top-level user', async () => {
    const auth = authClient();
    auth.verifyOtp.mockResolvedValue({
      data: {
        user: null,
        session: {
          user: {
            id: 'auth-user-2',
            email: 'Admin2@Example.com',
            email_confirmed_at: '2026-09-11T07:00:00Z',
          },
        },
      },
      error: null,
    });

    await expect(
      verifyAdminEmailOtpWithAuth(auth, 'admin2@example.com', '123456')
    ).resolves.toEqual({ userId: 'auth-user-2', email: 'admin2@example.com' });
  });

  it('propagates a Supabase error instead of returning a stale/unconfirmed identity', async () => {
    const auth = authClient();
    const supabaseError = new Error('session expired');
    auth.getUser.mockResolvedValue({ data: { user: null }, error: supabaseError });

    await expect(getVerifiedAdminIdentityWithAuth(auth)).rejects.toBe(supabaseError);
  });

  it('fails closed when the current session user is not email-confirmed', async () => {
    const auth = authClient();
    auth.getUser.mockResolvedValue({
      data: { user: { id: 'auth-user-1', email: 'admin@example.com', confirmed_at: null } },
      error: null,
    });

    await expect(getVerifiedAdminIdentityWithAuth(auth)).rejects.toThrow(
      'יש לאמת את כתובת הדוא״ל'
    );
  });
});

describe('the requireAuthClient()-backed exports (delegate to the real supabase.auth)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('requestAdminEmailVerification() calls supabase.auth.signInWithOtp with the normalized email', async () => {
    mockAuth.signInWithOtp.mockResolvedValue({ error: null });

    await expect(requestAdminEmailVerification('  Admin@Example.COM ')).resolves.toBe(
      'admin@example.com'
    );
    expect(mockAuth.signInWithOtp).toHaveBeenCalledWith({
      email: 'admin@example.com',
      options: { shouldCreateUser: true },
    });
  });

  it('verifyAdminEmailOtp() calls supabase.auth.verifyOtp and returns the confirmed identity', async () => {
    mockAuth.verifyOtp.mockResolvedValue({
      data: {
        user: {
          id: 'auth-user-1',
          email: 'admin@example.com',
          email_confirmed_at: '2026-09-11T07:00:00Z',
        },
      },
      error: null,
    });

    await expect(verifyAdminEmailOtp('admin@example.com', '123456')).resolves.toEqual({
      userId: 'auth-user-1',
      email: 'admin@example.com',
    });
    expect(mockAuth.verifyOtp).toHaveBeenCalledWith({
      email: 'admin@example.com',
      token: '123456',
      type: 'email',
    });
  });

  it('getVerifiedAdminIdentity() calls supabase.auth.getUser and returns the confirmed identity', async () => {
    mockAuth.getUser.mockResolvedValue({
      data: {
        user: {
          id: 'auth-user-1',
          email: 'admin@example.com',
          confirmed_at: '2026-09-11T07:00:00Z',
        },
      },
      error: null,
    });

    await expect(getVerifiedAdminIdentity()).resolves.toEqual({
      userId: 'auth-user-1',
      email: 'admin@example.com',
    });
    expect(mockAuth.getUser).toHaveBeenCalled();
  });
});

describe('the requireAuthClient()-backed exports in local/demo mode (no Supabase configured)', () => {
  it('every export throws SupabaseNotConfiguredError rather than reaching a null supabase.auth', async () => {
    jest.resetModules();
    jest.doMock('../supabase', () => ({
      supabase: null,
      SupabaseNotConfiguredError: class SupabaseNotConfiguredError extends Error {},
    }));

    const {
      requestAdminEmailVerification: requestAdminEmailVerificationDemo,
      verifyAdminEmailOtp: verifyAdminEmailOtpDemo,
      getVerifiedAdminIdentity: getVerifiedAdminIdentityDemo,
      createVerifiedFamily: createVerifiedFamilyDemo,
      getMyFamilyOnboardingStatus: getMyFamilyOnboardingStatusDemo,
    } = require('../verifiedAdminOnboarding');
    const { SupabaseNotConfiguredError } = require('../supabase');

    // requireAuthClient() is evaluated as an argument to the *WithAuth call
    // before that call ever returns a promise, so each wrapper throws
    // synchronously here rather than returning a rejected promise.
    expect(() => requestAdminEmailVerificationDemo('admin@example.com')).toThrow(
      SupabaseNotConfiguredError
    );
    expect(() => verifyAdminEmailOtpDemo('admin@example.com', '123456')).toThrow(
      SupabaseNotConfiguredError
    );
    expect(() => getVerifiedAdminIdentityDemo()).toThrow(SupabaseNotConfiguredError);
    await expect(createVerifiedFamilyDemo('The Cohens')).rejects.toBeInstanceOf(
      SupabaseNotConfiguredError
    );
    await expect(getMyFamilyOnboardingStatusDemo()).rejects.toBeInstanceOf(
      SupabaseNotConfiguredError
    );

    jest.dontMock('../supabase');
  });
});

describe('createVerifiedFamily', () => {
  const originalDateTimeFormat = Intl.DateTimeFormat;

  beforeEach(() => {
    jest.clearAllMocks();
    // Stubbed so the request body's `timezone` field is deterministic
    // regardless of the host machine/CI runner's own configured TZ.
    (Intl as unknown as { DateTimeFormat: unknown }).DateTimeFormat = () => ({
      resolvedOptions: () => ({ timeZone: 'Asia/Jerusalem' }),
    });
  });

  afterEach(() => {
    (Intl as unknown as { DateTimeFormat: unknown }).DateTimeFormat = originalDateTimeFormat;
  });

  it('trims the family/dog name, sends the device timezone, and calls the server-authoritative Edge Function only', async () => {
    mockInvoke.mockResolvedValue({
      data: {
        family: {
          id: 'family-1',
          name: 'The Cohens',
          inviteCode: 'ABC123',
          approvalStatus: 'active',
        },
        warnings: [],
      },
      error: null,
    });

    const result = await createVerifiedFamily('  The Cohens  ', '  Rex  ');

    expect(mockInvoke).toHaveBeenCalledWith('create-verified-family', {
      body: { familyName: 'The Cohens', dogName: 'Rex', timezone: 'Asia/Jerusalem' },
    });
    expect(result).toEqual({
      id: 'family-1',
      name: 'The Cohens',
      inviteCode: 'ABC123',
      approvalStatus: 'active',
      warnings: [],
    });
  });

  it('sends null for an absent/whitespace-only dog name rather than an empty string', async () => {
    mockInvoke.mockResolvedValue({
      data: {
        family: { id: 'family-1', name: 'x', inviteCode: 'c', approvalStatus: 'pending' },
      },
      error: null,
    });

    await createVerifiedFamily('x', '   ');

    expect(mockInvoke).toHaveBeenCalledWith('create-verified-family', {
      body: { familyName: 'x', dogName: null, timezone: 'Asia/Jerusalem' },
    });
  });

  it('defaults warnings to an empty array when the Edge Function omits it', async () => {
    mockInvoke.mockResolvedValue({
      data: { family: { id: 'family-1', name: 'x', inviteCode: 'c', approvalStatus: 'active' } },
      error: null,
    });

    const result = await createVerifiedFamily('x');

    expect(result.warnings).toEqual([]);
  });

  it('propagates a non-HTTP Edge Function invocation error as-is', async () => {
    const invokeError = new Error('network error');
    mockInvoke.mockResolvedValue({ data: null, error: invokeError });

    await expect(createVerifiedFamily('x')).rejects.toBe(invokeError);
  });

  it('recovers the specific reason from a FunctionsHttpError body instead of its generic message', async () => {
    const response = { json: jest.fn().mockResolvedValue({ error: 'verified email identity required' }) };
    const invokeError = new FunctionsHttpError(response);
    mockInvoke.mockResolvedValue({ data: null, error: invokeError });

    await expect(createVerifiedFamily('x')).rejects.toThrow('verified email identity required');
  });

  it('falls back to the generic FunctionsHttpError when its body has no error string', async () => {
    const response = { json: jest.fn().mockResolvedValue({}) };
    const invokeError = new FunctionsHttpError(response);
    mockInvoke.mockResolvedValue({ data: null, error: invokeError });

    await expect(createVerifiedFamily('x')).rejects.toBe(invokeError);
  });

  it('falls back to the generic FunctionsHttpError when its body is not valid JSON', async () => {
    const response = { json: jest.fn().mockRejectedValue(new Error('not json')) };
    const invokeError = new FunctionsHttpError(response);
    mockInvoke.mockResolvedValue({ data: null, error: invokeError });

    await expect(createVerifiedFamily('x')).rejects.toBe(invokeError);
  });

  it('fails closed on a malformed success response missing required family fields', async () => {
    mockInvoke.mockResolvedValue({
      data: { family: { id: 'family-1', name: 'x', inviteCode: 'c', approvalStatus: 'bogus' } },
      error: null,
    });

    await expect(createVerifiedFamily('x')).rejects.toThrow('יצירת המשפחה נכשלה');
  });
});

describe('getMyFamilyOnboardingStatus', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('calls get_my_family_onboarding_status with no arguments and maps the row', async () => {
    mockRpc.mockResolvedValue({
      data: [{ family_id: 'family-1', family_name: 'The Cohens', approval_status: 'pending' }],
      error: null,
    });

    const result = await getMyFamilyOnboardingStatus();

    expect(mockRpc).toHaveBeenCalledWith('get_my_family_onboarding_status');
    expect(result).toEqual({
      familyId: 'family-1',
      familyName: 'The Cohens',
      approvalStatus: 'pending',
    });
  });

  it('also accepts a single-object (non-array) response shape', async () => {
    mockRpc.mockResolvedValue({
      data: { family_id: 'family-1', family_name: 'The Cohens', approval_status: 'active' },
      error: null,
    });

    const result = await getMyFamilyOnboardingStatus();

    expect(result?.approvalStatus).toBe('active');
  });

  it('returns null when the caller has no onboarding request', async () => {
    mockRpc.mockResolvedValue({ data: [], error: null });

    await expect(getMyFamilyOnboardingStatus()).resolves.toBeNull();
  });

  it('returns null on a null data response', async () => {
    mockRpc.mockResolvedValue({ data: null, error: null });

    await expect(getMyFamilyOnboardingStatus()).resolves.toBeNull();
  });

  it('propagates an RPC error', async () => {
    const rpcError = new Error('network error');
    mockRpc.mockResolvedValue({ data: null, error: rpcError });

    await expect(getMyFamilyOnboardingStatus()).rejects.toBe(rpcError);
  });
});
