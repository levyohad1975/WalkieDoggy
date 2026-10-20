import { Platform } from 'react-native';
import { supabaseProjectUrl } from './supabase';

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
  if (Platform.OS !== 'web' || typeof window === 'undefined') return false;
  return isOtpDiagnosticsEnabledFor({
    platform: Platform.OS,
    hostname: window.location.hostname,
    supabaseUrl: supabaseProjectUrl,
  });
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
  const name = typeof value.name === 'string' && SAFE_ERROR_NAMES.has(value.name)
    ? value.name
    : 'OtherError';
  const status = typeof value.status === 'number' && Number.isInteger(value.status)
    && value.status >= 100 && value.status <= 599
    ? value.status
    : undefined;
  const code = typeof value.code === 'string' && SAFE_ERROR_CODES.has(value.code)
    ? value.code
    : undefined;
  return {
    errorName: name,
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

