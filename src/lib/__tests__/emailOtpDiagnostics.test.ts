import {
  acquireOtpRequestLock,
  beginOtpFetchTrace,
  classifyOtpError,
  createOtpDiagnosticFetch,
  createOtpDiagnosticTrace,
  getOtpDiagnosticSummary,
  isOtpDiagnosticsEnabledFor,
  probeAuthEndpointConnectivity,
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

  it('probes only the exact Staging Auth endpoint without credentials and reports HTTP status', async () => {
    const fetcher = jest.fn().mockResolvedValue({ status: 401 } as Response);
    const result = await probeAuthEndpointConnectivity(
      'https://czbxhsoxyawprqehkfit.supabase.co',
      fetcher,
    );
    expect(result).toMatchObject({ category: 'http_response', httpStatus: 401 });
    expect(fetcher).toHaveBeenCalledWith(
      'https://czbxhsoxyawprqehkfit.supabase.co/auth/v1/health',
      expect.objectContaining({ method: 'GET', mode: 'cors', credentials: 'omit', cache: 'no-store' }),
    );
    const [, init] = fetcher.mock.calls[0];
    expect(init).not.toHaveProperty('headers');
    expect(JSON.stringify(fetcher.mock.calls)).not.toMatch(/apikey|authorization|token|email/i);
  });

  it('does not send connectivity probes to a non-Staging Supabase URL', async () => {
    const fetcher = jest.fn();
    await expect(probeAuthEndpointConnectivity('https://prod.supabase.co', fetcher))
      .resolves.toMatchObject({ category: 'disabled' });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it.each([
    [new TypeError('Load failed'), 'network'],
    [Object.assign(new Error('probe timeout'), { name: 'TimeoutError' }), 'timeout'],
  ] as const)('classifies a rejected connectivity probe as %s', async (error, category) => {
    const fetcher = jest.fn().mockRejectedValue(error);
    await expect(probeAuthEndpointConnectivity(
      'https://czbxhsoxyawprqehkfit.supabase.co',
      fetcher,
    )).resolves.toMatchObject({ category });
  });

  it('records whether the raw browser fetch ran and whether it returned HTTP or rejected', async () => {
    const trace = createOtpDiagnosticTrace();
    const close = beginOtpFetchTrace(trace.sink);
    const log = jest.spyOn(console, 'info').mockImplementation(() => undefined);
    const fetcher = jest.fn().mockResolvedValue({ ok: false, status: 429 } as Response);
    try {
      const instrumented = createOtpDiagnosticFetch(fetcher, () => true);
      const response = await instrumented(
        'https://czbxhsoxyawprqehkfit.supabase.co/auth/v1/otp',
        { method: 'POST', body: '{"email":"private@example.com"}' },
      );
      expect(response.status).toBe(429);
      expect(close.fetchWasInvoked()).toBe(true);
      expect(trace.snapshot.events.map((event) => event.stage)).toEqual([
        'auth_fetch_invoked', 'auth_fetch_resolved',
      ]);
      expect(getOtpDiagnosticSummary(trace.snapshot)).toMatchObject({
        category: 'auth_http', httpStatus: 429, stage: 'auth_fetch_resolved',
      });
      const serialized = JSON.stringify(trace.snapshot) + JSON.stringify(log.mock.calls);
      expect(serialized).not.toContain('private@example.com');
      expect(serialized).not.toContain('"email"');
    } finally {
      close.close();
      log.mockRestore();
    }
  });

  it('records a raw fetch network rejection without capturing request payloads', async () => {
    const trace = createOtpDiagnosticTrace();
    const close = beginOtpFetchTrace(trace.sink);
    const fetcher = jest.fn().mockRejectedValue(new TypeError('email private@example.com; token 123456'));
    const log = jest.spyOn(console, 'info').mockImplementation(() => undefined);
    try {
      const instrumented = createOtpDiagnosticFetch(fetcher, () => true);
      await expect(instrumented(
        'https://czbxhsoxyawprqehkfit.supabase.co/auth/v1/otp',
        { method: 'POST', body: '{"email":"private@example.com","token":"123456"}' },
      )).rejects.toBeInstanceOf(TypeError);
      expect(trace.snapshot.events.map((event) => event.stage)).toEqual([
        'auth_fetch_invoked', 'auth_fetch_rejected',
      ]);
      expect(JSON.stringify(trace.snapshot) + JSON.stringify(log.mock.calls))
        .not.toMatch(/private@example\.com|123456|token/);
    } finally {
      close.close();
      log.mockRestore();
    }
  });

  it('marks a rejected Auth promise when the raw fetch was never invoked', async () => {
    const auth = authClient();
    auth.signInWithOtp.mockRejectedValue(new Error('local setup failure'));
    const trace = createOtpDiagnosticTrace();
    await expect(requestAdminEmailVerificationWithAuth(
      auth,
      'admin@example.com',
      true,
      trace.sink,
    )).rejects.toBeTruthy();
    expect(trace.snapshot.events.map((event) => event.stage)).toContain('auth_client_rejected_before_fetch');
    expect(getOtpDiagnosticSummary(trace.snapshot)?.stage).toBe('promise_rejected');
  });

  it('locks repeated taps synchronously and permits a retry after the first request settles', () => {
    const lock = { current: false };
    expect(acquireOtpRequestLock(lock)).toBe(true);
    expect(acquireOtpRequestLock(lock)).toBe(false);
    lock.current = false;
    expect(acquireOtpRequestLock(lock)).toBe(true);
  });
});
