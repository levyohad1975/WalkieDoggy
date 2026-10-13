import { Platform } from 'react-native';
import { supabase, isSupabaseConfigured } from './supabase';
import { getExpoPushTokenIfKnown } from './pushTokens';
import { getCurrentWebPushEndpoint } from './webPush';

/**
 * Batch 2 / Decision 4 / requirement 10: the client-side half of the
 * native-local-vs-server-push duplicate-suppression policy.
 *
 * POLICY (see this batch's correction report for the full explanation):
 *   - The server-side scheduler (supabase/functions/send-walk-reminders,
 *     supabase/migrations/0025_walk_reminder_scheduler.sql) is
 *     AUTHORITATIVE for THIS DEVICE whenever THIS DEVICE has an active
 *     remote push destination registered — its own Expo push token
 *     (src/lib/pushTokens.ts) or its own Web Push subscription
 *     (src/lib/webPush.ts).
 *   - Local notifications (src/notifications/notificationService.ts) are a
 *     FALLBACK, used only when THIS DEVICE has no such channel — in that
 *     case there is no way for the server to ever reach this specific
 *     device at all, so local scheduling is the sole delivery path for it,
 *     not a duplicate of anything.
 *
 * BATCH 2 REVIEW CORRECTION (profile-wide vs device-specific):
 * The first Batch 2 delivery answered a PROFILE-wide question — "does this
 * profile have any active remote channel on any device" — via
 * has_active_remote_push_channel() with no arguments, deriving the answer
 * from real_current_profile_id() alone. That is wrong when the same family
 * profile is signed in on more than one device: Device A registers a push
 * token, Device B (no channel of its own) asks the same profile-wide
 * question, gets `true` because of Device A, and wrongly suppresses its own
 * local fallback — even though the server has no way to reach Device B.
 *
 * The fix keeps the RPC itself as the single source of truth (never a
 * client-side guess) but makes it answer a DEVICE-specific question: it now
 * takes this device's own Expo token and/or Web Push endpoint as parameters
 * and checks only whether THAT SPECIFIC row is active
 * (has_active_remote_push_channel(p_expo_token, p_web_push_endpoint) —
 * migration 0025 Part 5). push_tokens.token and web_push_subscriptions.endpoint
 * are already natural per-device identifiers (no schema change was needed —
 * see the migration's header comment for why). A device that has never
 * registered either passes both as null and — by construction, since the
 * RPC requires a non-null match on at least one — gets `false` without a
 * network round-trip at all (see the early-return below).
 *
 * CACHING: this is still called on every individual walk mutation as well
 * as on every full reconciliation pass, so a short in-memory cache remains
 * worthwhile. Because the answer now depends on which token/endpoint THIS
 * device currently knows about, the cache key is derived from those two
 * values rather than being a single flag: if this device's own known
 * token/endpoint changes (e.g. registerPushToken() or enableWebPush()
 * completes for the first time), the key itself changes and the old cached
 * value is naturally never reused — no separate invalidation call is
 * needed, and none is exported. (An explicit invalidate() would require
 * src/lib/pushTokens.ts and src/lib/webPush.ts to import from this module,
 * while this module now needs to import FROM them to read the device's own
 * identifiers — a circular import. The key-based cache avoids that
 * entirely.) Reminder timing is only ever minute-granular (see
 * REMINDER_STAGE_OFFSET_MINUTES in src/logic/reminderMessages.ts), so a
 * value up to 60s stale here has no observable effect on when a reminder
 * actually fires.
 *
 * Best-effort throughout: any failure (network, RPC error, reading the
 * device's own token/endpoint) resolves to false rather than throwing, so a
 * transient failure degrades to "use local fallback" — matching the
 * fallback framing above — rather than ever silently losing reminders.
 * Local/demo mode (no Supabase) has no concept of a remote channel at all,
 * so this always resolves false there — local scheduling remains
 * unconditional in that mode, unchanged from before this batch.
 */
const CACHE_TTL_MS = 60_000;
let cached: { key: string; value: boolean; expiresAt: number } | null = null;

async function getWebPushEndpointIfApplicable(): Promise<string | null> {
  if (Platform.OS !== 'web') return null;
  try {
    return await getCurrentWebPushEndpoint();
  } catch {
    return null;
  }
}

export async function hasActiveRemoteReminderChannel(): Promise<boolean> {
  if (!isSupabaseConfigured || !supabase) return false;

  const expoToken = getExpoPushTokenIfKnown();
  const webPushEndpoint = await getWebPushEndpointIfApplicable();

  if (!expoToken && !webPushEndpoint) {
    // This device has never registered either kind of remote destination —
    // it cannot possibly have an active channel, and there is nothing
    // device-specific to ask the server about. Skip the network round-trip
    // entirely rather than caching a value for an empty key.
    return false;
  }

  const key = `${expoToken ?? ''}|${webPushEndpoint ?? ''}`;

  if (cached && cached.key === key && cached.expiresAt > Date.now()) {
    return cached.value;
  }

  try {
    const { data, error } = await supabase.rpc('has_active_remote_push_channel', {
      p_expo_token: expoToken,
      p_web_push_endpoint: webPushEndpoint,
    });
    if (error) return false;
    const value = data === true;
    cached = { key, value, expiresAt: Date.now() + CACHE_TTL_MS };
    return value;
  } catch {
    return false;
  }
}
