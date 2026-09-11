const mockSignInWithOtp = jest.fn();
const mockVerifyOtp = jest.fn();
const mockGetUser = jest.fn();

jest.mock('../supabase', () => ({
  supabase: {
    auth: {
      signInWithOtp: mockSignInWithOtp,
      verifyOtp: mockVerifyOtp,
      getUser: mockGetUser,
    },
  },
  SupabaseNotConfiguredError: class SupabaseNotConfiguredError extends Error {},
}));

import {
  getVerifiedAdminIdentity,
  requestAdminEmailVerification,
  verifyAdminEmailOtp,
} from '../verifiedAdminOnboarding';

describe('verified admin onboarding', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('normalizes the email and requests a passwordless verification code', async () => {
    mockSignInWithOtp.mockResolvedValue({ error: null });

    await expect(requestAdminEmailVerification('  Admin@Example.COM ')).resolves.toBe(
      'admin@example.com'
    );
    expect(mockSignInWithOtp).toHaveBeenCalledWith({
      email: 'admin@example.com',
      options: { shouldCreateUser: true },
    });
  });

  it('rejects an invalid email before calling Supabase', async () => {
    await expect(requestAdminEmailVerification('not-an-email')).rejects.toThrow(
      'כתובת דוא״ל תקינה'
    );
    expect(mockSignInWithOtp).not.toHaveBeenCalled();
  });

  it('returns only an identity established by a confirmed email OTP', async () => {
    mockVerifyOtp.mockResolvedValue({
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

    await expect(verifyAdminEmailOtp('admin@example.com', ' 123456 ')).resolves.toEqual({
      userId: 'auth-user-1',
      email: 'admin@example.com',
    });
    expect(mockVerifyOtp).toHaveBeenCalledWith({
      email: 'admin@example.com',
      token: '123456',
      type: 'email',
    });
  });

  it('fails closed when Supabase does not report a confirmed email', async () => {
    mockVerifyOtp.mockResolvedValue({
      data: {
        user: { id: 'auth-user-1', email: 'admin@example.com', email_confirmed_at: null },
        session: null,
      },
      error: null,
    });

    await expect(verifyAdminEmailOtp('admin@example.com', '123456')).rejects.toThrow(
      'אימות הדוא״ל לא הושלם'
    );
  });

  it('revalidates the current verified identity before family creation', async () => {
    mockGetUser.mockResolvedValue({
      data: {
        user: {
          id: 'auth-user-1',
          email: 'ADMIN@example.com',
          confirmed_at: '2026-09-11T07:00:00Z',
        },
      },
      error: null,
    });

    await expect(getVerifiedAdminIdentity()).resolves.toEqual({
      userId: 'auth-user-1',
      email: 'admin@example.com',
    });
  });
});
