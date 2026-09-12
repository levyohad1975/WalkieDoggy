import {
  getMyFamilyOnboardingStatusWithClient,
  getVerifiedAdminIdentityWithAuth,
  requestAdminEmailVerificationWithAuth,
  verifyAdminEmailOtpWithAuth,
  type VerifiedAdminAuthClient,
} from '../verifiedAdminOnboarding';

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
  it('maps the persisted applicant approval status', async () => {
    const client = {
      rpc: jest.fn().mockResolvedValue({
        data: [{
          family_id: 'family-1',
          family_name: 'משפחת לוי',
          approval_status: 'rejected',
        }],
        error: null,
      }),
    };

    await expect(getMyFamilyOnboardingStatusWithClient(client)).resolves.toEqual({
      familyId: 'family-1',
      familyName: 'משפחת לוי',
      approvalStatus: 'rejected',
    });
    expect(client.rpc).toHaveBeenCalledWith('get_my_family_onboarding_status');
  });

  it('returns null when the verified identity has no onboarding request', async () => {
    const client = { rpc: jest.fn().mockResolvedValue({ data: [], error: null }) };
    await expect(getMyFamilyOnboardingStatusWithClient(client)).resolves.toBeNull();
  });

  it('rejects malformed or failed onboarding status responses', async () => {
    const malformed = {
      rpc: jest.fn().mockResolvedValue({
        data: [{ family_id: 'family-1', family_name: 'Name', approval_status: 'unknown' }],
        error: null,
      }),
    };
    await expect(getMyFamilyOnboardingStatusWithClient(malformed)).rejects.toThrow(
      'סטטוס בקשת המשפחה אינו תקין'
    );

    const failed = { rpc: jest.fn().mockResolvedValue({ data: null, error: new Error('offline') }) };
    await expect(getMyFamilyOnboardingStatusWithClient(failed)).rejects.toThrow('offline');
  });
});
