import { Platform } from 'react-native';

/**
 * Temporary, in-memory diagnostics for the Staging iPhone Safari OTP issue.
 * Keep this allow-list narrow: never retain or emit raw error messages,
 * request bodies, email addresses, OTPs, sessions, or headers.
 * Remove this module after the Staging device issue is diagnosed.
 */
export type OtpDiagnosticCategory =
  | 'none'
  | 'validation'
  | 'network'
  | 'timeout'
  | 'auth_http'
  | 'javascript';

export type OtpDiagnosticStage =
  | 'button_handler_entered'
  | 'input_validation_completed'
  | 'input_validation_failed'
  | 'sign_in_with_otp_invoked'
  | 'promise_resolved'
  | 'auth_error_returned'
  | 'promise_rejected'
  | 'auth_fetch_invoked'
  | 'auth_fetch_resolved'
  | 'auth_fetch_rejected'
  | 'auth_client_rejected_before_fetch'
  | 'handler_failed_before_auth';

export type OtpDiagnosticEvent = {
  stage: OtpDiagnosticStage;
  category: OtpDiagnosticCategory;
  elapsedMs: number;
  errorName?: string;
  httpStatus?: number;
  errorCode?: string;
};

export type OtpDiagnosticSnapshot = {
  reference: string;
  events: OtpDiagnosticEvent[];
  startedAt: number;
};

export type OtpDiagnosticSink = {
  record: (stage: OtpDiagnosticStage, error?: unknown, category?: OtpDiagnosticCategory) => void;
};

export type OtpConnectivityResult = {
  category: 'http_response' | 'network' | 'timeout' | 'javascript' | 'disabled';
  elapsedMs: number;
  httpStatus?: number;
  errorName?: string;
};

type OtpSdkProbeClient = {
  signInWithOtp: (args: {
    email: string;
    options: { shouldCreateUser: boolean };
  }) => Promise<{ error: unknown | null }>;
};

/** Synchronous lock used before React state has time to re-render the button. */
export function acquireOtpRequestLock(lock: { current: boolean }): boolean {
  if (lock.current) return false;
  lock.current = true;
  return true;
}

const STAGING_SUPABASE_URL = 'https://czbxhsoxyawprqehkfit.supabase.co';
const SAFE_ERROR_CODES = new Set([
  'email_address_invalid',
  'email_not_confirmed',
  'email_provider_disabled',
  'over_email_send_rate_limit',
  'signup_disabled',
  'too_many_requests',
  'unexpected_failure',
  'validation_failed',
]);
const SAFE_ERROR_NAMES = new Set([
  'AbortError',
  'AuthApiError',
  'AuthError',
  'AuthRetryableFetchError',
  'Error',
  'TimeoutError',
  'TypeError',
]);

export function isOtpDiagnosticsEnabledFor(input: {
  platform: string;
  hostname?: string | null;
  supabaseUrl?: string | null;
}): boolean {
  return input.platform === 'web'
    && input.hostname?.toLowerCase() === 'staging.walkielink.co.il'
    && input.supabaseUrl === STAGING_SUPABASE_URL;
}

export function isOtpDiagnosticsEnabled(): boolean {
  if (Platform.OS !== 'web' || typeof window === 'undefined' || !window.location) return false;
  return isOtpDiagnosticsEnabledFor({
    platform: Platform.OS,
    hostname: window.location.hostname,
    supabaseUrl: process.env.EXPO_PUBLIC_SUPABASE_URL,
  });
}

type ActiveOtpFetchTrace = { sink: OtpDiagnosticSink; fetchInvoked: boolean };
let activeOtpFetchTrace: ActiveOtpFetchTrace | null = null;

export function beginOtpFetchTrace(sink: OtpDiagnosticSink): {
  fetchWasInvoked: () => boolean;
  close: () => void;
} {
  const previous = activeOtpFetchTrace;
  const current: ActiveOtpFetchTrace = { sink, fetchInvoked: false };
  activeOtpFetchTrace = current;
  return {
    fetchWasInvoked: () => current.fetchInvoked,
    close: () => {
      if (activeOtpFetchTrace === current) activeOtpFetchTrace = previous;
    },
  };
}

function getAuthOtpPath(input: RequestInfo | URL): string | null {
  try {
    const rawUrl = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    return new URL(rawUrl, STAGING_SUPABASE_URL).pathname;
  } catch {
    return null;
  }
}

/**
 * Instruments only the final browser fetch for /auth/v1/otp. It forwards the
 * original arguments unchanged and records no URL query, headers, or body.
 */
export function createOtpDiagnosticFetch(
  fetcher: typeof fetch,
  enabled: () => boolean
): typeof fetch {
  return async (input, init) => {
    const trace = enabled() && getAuthOtpPath(input) === '/auth/v1/otp'
      ? activeOtpFetchTrace
      : null;
    if (!trace) return fetcher(input, init);

    trace.fetchInvoked = true;
    trace.sink.record('auth_fetch_invoked');
    try {
      const response = await fetcher(input, init);
      trace.sink.record(
        'auth_fetch_resolved',
        { status: response.status },
        response.ok ? 'none' : 'auth_http'
      );
      return response;
    } catch (error) {
      trace.sink.record('auth_fetch_rejected', error);
      throw error;
    }
  };
}

/**
 * A Staging-only transport probe for the exact Auth OTP route. It deliberately
 * omits both email and phone, so Auth cannot send a message or create a user.
 * The public publishable key is already present in the app and is needed to
 * exercise the same gateway route; no session/token is used. Any HTTP response
 * proves that the browser completed CORS and reached an HTTP handler, but does
 * not test email delivery or verification.
 */
export async function probeOtpEndpointConnectivity(
  supabaseUrl: string,
  publishableKey: string,
  fetcher: typeof fetch = globalThis.fetch,
  timeoutMs = 8000
): Promise<OtpConnectivityResult> {
  if (supabaseUrl !== STAGING_SUPABASE_URL || !publishableKey || typeof fetcher !== 'function') {
    return { category: 'disabled', elapsedMs: 0 };
  }

  const startedAt = Date.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetcher(`${STAGING_SUPABASE_URL}/auth/v1/otp`, {
      method: 'POST',
      mode: 'cors',
      credentials: 'omit',
      cache: 'no-store',
      headers: {
        apikey: publishableKey,
        Authorization: 'Bearer staging-otp-transport-probe',
        'Content-Type': 'application/json;charset=UTF-8',
        'X-Client-Info': 'walkie-otp-transport-probe',
        'X-Supabase-Api-Version': '2024-01-01',
      },
      body: '{}',
      signal: controller.signal,
    });
    return {
      category: 'http_response',
      elapsedMs: Math.max(0, Date.now() - startedAt),
      httpStatus: response.status,
    };
  } catch (error) {
    const errorCategory = classifyOtpError(error);
    return {
      category: errorCategory === 'network' || errorCategory === 'timeout' ? errorCategory : 'javascript',
      elapsedMs: Math.max(0, Date.now() - startedAt),
      ...getSafeErrorDetails(error),
    };
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Exercises the real Supabase Auth SDK and its configured fetch/headers while
 * sending an empty email. Auth cannot send a message or create an account from
 * this request; an HTTP validation response is the expected result. This is
 * only exposed by the exact Staging-only UI gate.
 */
export async function probeOtpSdkTransport(
  auth: OtpSdkProbeClient | null | undefined,
  timeoutMs = 8000
): Promise<OtpConnectivityResult> {
  if (!auth || typeof auth.signInWithOtp !== 'function') {
    return { category: 'disabled', elapsedMs: 0 };
  }

  const startedAt = Date.now();
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const request = Promise.resolve()
    .then(() => auth.signInWithOtp({ email: '', options: { shouldCreateUser: true } }))
    .then(({ error }) => {
      const status = getSafeErrorDetails(error).httpStatus;
      return {
        category: 'http_response' as const,
        elapsedMs: Math.max(0, Date.now() - startedAt),
        httpStatus: status ?? 200,
      };
    })
    .catch((error: unknown) => {
      const category = classifyOtpError(error);
      return {
        category: category === 'network' || category === 'timeout' ? category : 'javascript',
        elapsedMs: Math.max(0, Date.now() - startedAt),
        ...getSafeErrorDetails(error),
      } satisfies OtpConnectivityResult;
    });
  const deadline = new Promise<OtpConnectivityResult>((resolve) => {
    timeout = setTimeout(() => resolve({
      category: 'timeout',
      elapsedMs: Math.max(0, Date.now() - startedAt),
      errorName: 'TimeoutError',
    }), timeoutMs);
  });

  try {
    return await Promise.race([request, deadline]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

function randomReference(): string {
  // The reference is a non-secret correlation label, not an auth token.
  const bytes = new Uint8Array(4);
  try {
    globalThis.crypto?.getRandomValues?.(bytes);
  } catch {
    // Math.random is sufficient for a short, non-security identifier.
  }
  const value = bytes.some((byte) => byte !== 0)
    ? Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
    : Math.random().toString(16).slice(2, 10).padEnd(8, '0');
  return value.slice(0, 8).toUpperCase();
}

function getSafeErrorDetails(error: unknown): Pick<OtpDiagnosticEvent, 'errorName' | 'httpStatus' | 'errorCode'> {
  if (typeof error !== 'object' || error === null) return {};
  const value = error as { name?: unknown; status?: unknown; code?: unknown };
  const name = typeof value.name === 'string'
    ? SAFE_ERROR_NAMES.has(value.name) ? value.name : 'OtherError'
    : undefined;
  const status = typeof value.status === 'number' && Number.isInteger(value.status)
    && value.status >= 100 && value.status <= 599
    ? value.status
    : undefined;
  const code = typeof value.code === 'string' && SAFE_ERROR_CODES.has(value.code)
    ? value.code
    : undefined;
  return {
    ...(name === undefined ? {} : { errorName: name }),
    ...(status === undefined ? {} : { httpStatus: status }),
    ...(code === undefined ? {} : { errorCode: code }),
  };
}

export function classifyOtpError(error: unknown): OtpDiagnosticCategory {
  const details = getSafeErrorDetails(error);
  if (details.httpStatus !== undefined || details.errorCode !== undefined
    || details.errorName === 'AuthApiError') return 'auth_http';

  const value = typeof error === 'object' && error !== null
    ? error as { name?: unknown; code?: unknown; message?: unknown }
    : {};
  const name = typeof value.name === 'string' ? value.name : '';
  const code = typeof value.code === 'string' ? value.code : '';
  const message = typeof value.message === 'string' ? value.message.toLowerCase() : '';
  if (name === 'TimeoutError' || name === 'AbortError'
    || ['ETIMEDOUT', 'ECONNABORTED', 'UND_ERR_CONNECT_TIMEOUT'].includes(code)
    || message.includes('timed out') || message.includes('timeout')) return 'timeout';
  if (name === 'TypeError' || name === 'AuthRetryableFetchError'
    || ['failed to fetch', 'load failed', 'networkerror', 'network request failed'].some((text) => message.includes(text))) {
    return 'network';
  }
  return 'javascript';
}

export function createOtpDiagnosticTrace(): {
  snapshot: OtpDiagnosticSnapshot;
  sink: OtpDiagnosticSink;
} {
  const snapshot: OtpDiagnosticSnapshot = {
    reference: randomReference(),
    events: [],
    startedAt: Date.now(),
  };
  return {
    snapshot,
    sink: {
      record(stage, error, category) {
        const event: OtpDiagnosticEvent = {
          stage,
          category: category ?? (error === undefined ? 'none' : classifyOtpError(error)),
          elapsedMs: Math.max(0, Date.now() - snapshot.startedAt),
          ...getSafeErrorDetails(error),
        };
        snapshot.events.push(event);
        // The gate is checked before a trace is created and this event object
        // contains only allow-listed metadata. It is never persisted.
        console.info('[staging-otp-diagnostic]', JSON.stringify({ reference: snapshot.reference, ...event }));
      },
    },
  };
}

export function getOtpDiagnosticSummary(snapshot: OtpDiagnosticSnapshot): OtpDiagnosticEvent | null {
  return snapshot.events[snapshot.events.length - 1] ?? null;
}

