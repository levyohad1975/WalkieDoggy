import { Platform } from 'react-native';
import { supabase, isSupabaseConfigured } from './supabase';
import { mapExecutionEnvironment } from './expoRuntime';

/**
 * Section 10: client-side registration for the REMOTE request-lifecycle
 * push (a completely separate system from src/notifications/
 * notificationService.ts's LOCAL scheduled-walk reminders — that module,
 * its "walk-reminders" Android channel, and its own permission flow are
 * untouched by this file).
 *
 * Every step here is guarded: permission denial, no physical device (an
 * Expo push token requires one), and a missing/misconfigured Supabase
 * project must all degrade to "silently don't register a token" rather
 * than crash or block any other part of the app. Best-effort only.
 */
/**
 * RUNTIME COMPLETION CORRECTION: the projectId fix (security-correction
 * pass) only fixed WHERE the value is read from
 * (`Constants.expoConfig?.extra?.eas?.projectId`) — it never addressed
 * what to do when that value is genuinely absent, which is the NORMAL
 * case in Expo Go and in a dev build before `eas init`. Previously that
 * fell straight through into `getExpoPushTokenAsync()` throwing, caught
 * by the generic catch-all below and logged with `console.error` —
 * indistinguishable from a real bug. Real-device Expo Go QA hit exactly
 * that: `No "projectId" found.` logged as an error every launch.
 *
 * Three distinct runtime states, using SDK 54's actual
 * `Constants.executionEnvironment` API (`ExecutionEnvironment.StoreClient`
 * for Expo Go; `Bare`/`Standalone` for a dev/standalone build) — the real
 * SDK-provided way to tell these apart, not a guess:
 *   1. Expo Go (`storeClient`): remote push is categorically unsupported
 *      there — this is expected and permanent, not a failure. Silent
 *      no-op, no console output at any level, regardless of projectId.
 *   2. Dev/standalone build, no projectId configured yet (pre-`eas init`):
 *      a real gap, but a known/expected one during development — a single
 *      `console.warn` (never `console.error`, never thrown, never a red
 *      LogBox screen), then a silent no-op.
 *   3. Dev/standalone build WITH a valid projectId: registration proceeds
 *      exactly as before this correction — unchanged behavior.
 * A genuinely unexpected failure inside that normal registration path
 * (network error, malformed token response, the permissions API itself
 * throwing) still falls through to the existing catch-all below and is
 * still logged the same way as before — only the "projectId legitimately
 * isn't there yet" case was pulled out of that bucket.
 */
export type PushRegistrationExecutionEnv = 'storeClient' | 'bareOrStandalone' | 'unknown';

export type PushRegistrationDecision = 'register' | 'skip-silent' | 'skip-warn';

/**
 * Batch 2 review correction (device-specific channel selection): the
 * server-side has_active_remote_push_channel() RPC (migration 0025) now
 * answers "does THIS SPECIFIC token/endpoint have an active row", not "does
 * this profile have any active row anywhere" — because a profile can be
 * signed in on more than one device, and a device with no channel of its
 * own must not suppress its own local fallback just because a *different*
 * device of the same profile happens to have one (see
 * src/lib/remoteReminderChannel.ts for the full policy).
 *
 * That means the caller now has to supply ITS OWN Expo push token to that
 * RPC. This module is the only place that token is obtained (via
 * getExpoPushTokenAsync() inside registerPushToken()), so it caches the
 * most recently observed value in memory for remoteReminderChannel.ts to
 * read synchronously. This is intentionally NOT persisted or re-fetched —
 * it only needs to reflect what THIS running app instance last registered;
 * a fresh app launch that hasn't registered yet simply has no known token,
 * which correctly falls through to "no remote channel known" until
 * registration completes.
 */
let lastKnownExpoPushToken: string | null = null;

/** Synchronous — this device's most recently registered Expo push token, if registerPushToken() has ever obtained one this app session. Null if none yet (or never eligible for remote push, e.g. Expo Go). */
export function getExpoPushTokenIfKnown(): string | null {
  return lastKnownExpoPushToken;
}

/** Pure decision rule — kept separate from the native-module plumbing so it's unit-testable in this sandbox without a real Expo runtime. */
export function decidePushRegistration(params: {
  executionEnvironment: PushRegistrationExecutionEnv;
  projectId: string | undefined | null;
}): PushRegistrationDecision {
  if (params.executionEnvironment === 'storeClient') {
    // Expo Go can never receive a real remote push token, with or without
    // a projectId — this is an expected, permanent limitation of that
    // client, not something to warn about on every launch.
    return 'skip-silent';
  }
  if (!params.projectId) {
    // Bare/dev/standalone build, no EAS projectId configured yet — a real
    // but expected-during-development gap. Worth a quiet warn, not an error.
    return 'skip-warn';
  }
  return 'register';
}

// mapExecutionEnvironment() now lives in src/lib/expoRuntime.ts, shared with
// notificationService.ts's local-reminder Expo Go guard — re-exported here
// under its original name so nothing importing it from this file breaks.
export { mapExecutionEnvironment };

export async function registerPushToken(): Promise<void> {
  if (!isSupabaseConfigured || !supabase) return;

  // expo-constants is safe to inspect first. We must identify Expo Go
  // BEFORE touching expo-notifications, because that module can throw when
  // loaded inside Android Expo Go.
  let Constants: any = null;
  try {
    Constants = require('expo-constants');
  } catch {
    // Unknown runtime: fail open and let the normal projectId decision below
    // determine whether registration can proceed.
  }

  const constantsModule = Constants?.default ?? Constants;
  const projectId: string | undefined = constantsModule?.expoConfig?.extra?.eas?.projectId;
  const executionEnvironment = mapExecutionEnvironment(constantsModule);
  const decision = decidePushRegistration({ executionEnvironment, projectId });

  if (decision === 'skip-silent') return; // Confirmed Expo Go — never load expo-notifications.

  if (decision === 'skip-warn') {
    if (process.env.NODE_ENV !== 'production') {
      console.warn(
        'registerPushToken: no EAS projectId configured yet (run `eas init` / `eas build:configure`) — skipping remote push registration for now.'
      );
    }
    return;
  }

  // Only a runtime that is eligible for remote push reaches this point.
  let Notifications: any;
  let Device: any = null;

  try {
    Notifications = require('expo-notifications');
  } catch {
    return;
  }

  try {
    Device = require('expo-device');
  } catch {
    Device = null;
  }

  try {
    if (Device && Device.isDevice === false) {
      return;
    }

    const existing = await Notifications.getPermissionsAsync();
    let status = existing.status;

    if (status !== 'granted') {
      const requested = await Notifications.requestPermissionsAsync();
      status = requested.status;
    }

    if (status !== 'granted') return;

    const tokenResponse = await Notifications.getExpoPushTokenAsync({
      projectId: projectId as string,
    });
    const token = tokenResponse?.data;
    if (!token) return;

    // Record this device's own token synchronously for
    // getExpoPushTokenIfKnown() (see its doc comment above) — set as soon as
    // it's obtained, independent of whether the upsert below succeeds, since
    // it's a fact about this device/runtime regardless of network state.
    lastKnownExpoPushToken = token;

    const platform =
      Platform.OS === 'ios'
        ? 'ios'
        : Platform.OS === 'android'
          ? 'android'
          : 'unknown';

    const { error } = await supabase.rpc('upsert_push_token', {
      p_token: token,
      p_platform: platform,
    });

    if (error && process.env.NODE_ENV !== 'production') {
      console.error('registerPushToken: upsert_push_token failed', error);
    }
  } catch (err) {
    if (process.env.NODE_ENV !== 'production') {
      console.error('registerPushToken failed (non-fatal):', err);
    }
  }
}
/**
 * SECURITY CORRECTION: fire-and-forget call to the send-request-push Edge
 * Function — used by requestsStore right after a create/approve/reject RPC
 * succeeds. This payload is now ONLY a minimal trigger (which request, and
 * which lifecycle event) — no recipient list and no message content are
 * sent from the client. The Edge Function authenticates the caller from
 * this client's own Supabase session (supabase-js automatically attaches
 * the current session's Authorization bearer token to a `functions.invoke`
 * call), loads the actual request row itself, and derives who to notify
 * and what to say entirely server-side — see
 * supabase/functions/send-request-push/index.ts's doc comment. Never
 * throws: a failed push must not surface as a failure of the request
 * action itself, which already succeeded server-side by the time this runs.
 */
export async function sendRequestPush(payload: {
  requestId: string;
  kind: 'swap' | 'timeChange';
  event: 'created' | 'approved' | 'rejected';
}): Promise<void> {
  if (!isSupabaseConfigured || !supabase) return;
  try {
    await supabase.functions.invoke('send-request-push', { body: payload });
  } catch (err) {
    if (process.env.NODE_ENV !== 'production') {
      console.error('sendRequestPush failed (non-fatal):', err);
    }
  }
}

