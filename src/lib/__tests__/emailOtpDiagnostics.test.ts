import {
  acquireOtpRequestLock,
  classifyOtpError,
  createOtpDiagnosticTrace,
  getOtpDiagnosticSummary,
  isOtpDiagnosticsEnabledFor,
} from '../emailOtpDiagnostics';
import {
  requestAdminEmailVerificationWithAuth,
  type VerifiedAdminAuthClient,
} from '../verifiedAdminOnboarding';

function authClient(): jest.Mocked<VerifiedAdminAuthClient> {
  return {
    signInWithOtp: jest.fn(),
    verifyOtp: jest.fn(),
    getUser: jest.fn(),
  };
}

describe('temporary Staging email OTP diagnostics', () => {
  it('enables the diagnostic UI only on the exact Staging hostname and Supabase project', () => {
    const staging = {
      platform: 'web',
      hostname: 'staging.walkielink.co.il',
      supabaseUrl: 'https://czbxhsoxyawprqehkfit.supabase.co',
    };
    expect(isOtpDiagnosticsEnabledFor(staging)).toBe(true);
    expect(isOtpDiagnosticsEnabledFor({ ...staging, hostname: 'walkielink.co.il' })).toBe(false);
    expect(isOtpDiagnosticsEnabledFor({ ...staging, supabaseUrl: 'https://prod.supabase.co' })).toBe(false);
    expect(isOtpDiagnosticsEnabledFor({ ...staging, platform: 'ios' })).toBe(false);
  });

  it('records handler, validation, invocation, and successful promise resolution in order', async () => {
    const auth = authClient();
    auth.signInWithOtp.mockResolvedValue({ error: null });
    const trace = createOtpDiagnosticTrace();
    const log = jest.spyOn(console, 'info').mockImplementation(() => undefined);
    try {
      trace.sink.record('button_handler_entered');
      await expect(requestAdminEmailVerificationWithAuth(
        auth,
        ' Admin@Example.com ',
        true,
        trace.sink
      )).resolves.toBe('admin@example.com');
      expect(trace.snapshot.events.map((event) => event.stage)).toEqual([
        'button_handler_entered',
        'input_validation_completed',
        'sign_in_with_otp_invoked',
        'promise_resolved',
      ]);
      expect(getOtpDiagnosticSummary(trace.snapshot)).toMatchObject({
        category: 'none',
        stage: 'promise_resolved',
      });
      expect(auth.signInWithOtp).toHaveBeenCalledTimes(1);
    } finally {
      log.mockRestore();
    }
  });

  it('records an HTTP/Auth error returned from a resolved promise without exposing its message', async () => {
    const auth = authClient();
    auth.signInWithOtp.mockResolvedValue({
      error: Object.assign(new Error('email alice@example.com OTP 123456'), {
        name: 'AuthApiError',
        status: 429,
        code: 'over_email_send_rate_limit',
      }),
    });
    const trace = createOtpDiagnosticTrace();
    const log = jest.spyOn(console, 'info').mockImplementation(() => undefined);
    try {
      await expect(requestAdminEmailVerificationWithAuth(
        auth,
        'alice@example.com',
        true,
        trace.sink
      )).rejects.toBeTruthy();
      expect(trace.snapshot.events.map((event) => event.stage)).toEqual([
        'input_validation_completed',
        'sign_in_with_otp_invoked',
        'promise_resolved',
        'auth_error_returned',
      ]);
      expect(getOtpDiagnosticSummary(trace.snapshot)).toMatchObject({
        category: 'auth_http',
        httpStatus: 429,
        errorCode: 'over_email_send_rate_limit',
      });
      const serialized = JSON.stringify(trace.snapshot) + JSON.stringify(log.mock.calls);
      expect(serialized).not.toContain('alice@example.com');
      expect(serialized).not.toContain('123456');
    } finally {
      log.mockRestore();
    }
  });

  it.each([
    [new TypeError('Load failed'), 'network'],
    [Object.assign(new Error('request timed out'), { name: 'TimeoutError' }), 'timeout'],
  ] as const)('records a rejected %s as a safe %s failure', async (error, expectedCategory) => {
    const auth = authClient();
    auth.signInWithOtp.mockRejectedValue(error);
    const trace = createOtpDiagnosticTrace();
    await expect(requestAdminEmailVerificationWithAuth(
      auth,
      'admin@example.com',
      true,
      trace.sink
    )).rejects.toBe(error);
    expect(getOtpDiagnosticSummary(trace.snapshot)).toMatchObject({
      category: expectedCategory,
      stage: 'promise_rejected',
    });
  });

  it('records validation failure without invoking Auth or retaining the submitted address', async () => {
    const auth = authClient();
    const trace = createOtpDiagnosticTrace();
    await expect(requestAdminEmailVerificationWithAuth(
      auth,
      'not-an-email',
      true,
      trace.sink
    )).rejects.toThrow();
    expect(auth.signInWithOtp).not.toHaveBeenCalled();
    expect(getOtpDiagnosticSummary(trace.snapshot)).toMatchObject({
      category: 'validation',
      stage: 'input_validation_failed',
    });
    expect(JSON.stringify(trace.snapshot)).not.toContain('not-an-email');
  });

  it('redacts arbitrary error messages, email, OTP, tokens, headers, and unapproved codes', () => {
    const trace = createOtpDiagnosticTrace();
    const log = jest.spyOn(console, 'info').mockImplementation(() => undefined);
    try {
      trace.sink.record('promise_rejected', Object.assign(
        new Error('alice@example.com OTP 123456 access_token=secret refresh_token=secret Authorization: Bearer secret'),
        { code: 'alice@example.com' }
      ));
      const serialized = JSON.stringify(trace.snapshot) + JSON.stringify(log.mock.calls);
      for (const secret of ['alice@example.com', '123456', 'access_token', 'refresh_token', 'Bearer secret']) {
        expect(serialized).not.toContain(secret);
      }
      expect(getOtpDiagnosticSummary(trace.snapshot)).toMatchObject({
        category: 'javascript',
        errorName: 'Error',
      });
      expect(getOtpDiagnosticSummary(trace.snapshot)).not.toHaveProperty('errorCode');
    } finally {
      log.mockRestore();
    }
  });

  it('classifies HTTP responses separately from network and JavaScript failures', () => {
    expect(classifyOtpError(Object.assign(new Error('bad response'), { status: 400 }))).toBe('auth_http');
    expect(classifyOtpError(new TypeError('Load failed'))).toBe('network');
    expect(classifyOtpError(new Error('unexpected'))).toBe('javascript');
  });

  it('locks repeated taps synchronously and permits a retry after the first request settles', () => {
    const lock = { current: false };
    expect(acquireOtpRequestLock(lock)).toBe(true);
    expect(acquireOtpRequestLock(lock)).toBe(false);
    lock.current = false;
    expect(acquireOtpRequestLock(lock)).toBe(true);
  });
});
