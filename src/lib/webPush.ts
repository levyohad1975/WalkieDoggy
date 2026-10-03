import { Platform } from 'react-native';
import { isSupabaseConfigured, supabase } from './supabase';

export type WebPushStatus =
  | 'unsupported'
  | 'default'
  | 'denied'
  | 'granted'
  | 'subscribed';

function urlBase64ToUint8Array(base64String: string): ArrayBuffer {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding)
    .replace(/-/g, '+')
    .replace(/_/g, '/');

  const rawData = window.atob(base64);
  const bytes = new Uint8Array(new ArrayBuffer(rawData.length));

  for (let i = 0; i < rawData.length; i += 1) {
    bytes[i] = rawData.charCodeAt(i);
  }

  return bytes.buffer;
}

function isWebPushSupported(): boolean {
  return (
    Platform.OS === 'web' &&
    typeof window !== 'undefined' &&
    typeof navigator !== 'undefined' &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window
  );
}

/**
 * Batch 2 review correction (device-specific channel selection): mirrors
 * getWebPushStatus()'s own lookup of the current service-worker push
 * subscription, but returns just the endpoint string (this browser/device's
 * natural per-device identifier in web_push_subscriptions — see migration
 * 0021) rather than a status enum. Used by src/lib/remoteReminderChannel.ts
 * to ask has_active_remote_push_channel() about THIS device's own
 * subscription specifically, not "does this profile have any subscription
 * anywhere". Returns null on any failure or when unsupported/unsubscribed —
 * never throws.
 */
export async function getCurrentWebPushEndpoint(): Promise<string | null> {
  if (!isWebPushSupported()) {
    return null;
  }

  try {
    const registration = await navigator.serviceWorker.getRegistration('/');
    if (!registration) {
      return null;
    }

    const subscription = await registration.pushManager.getSubscription();
    return subscription?.endpoint ?? null;
  } catch {
    return null;
  }
}

export async function getWebPushStatus(): Promise<WebPushStatus> {
  if (!isWebPushSupported()) {
    return 'unsupported';
  }

  if (Notification.permission === 'denied') {
    return 'denied';
  }

  if (Notification.permission !== 'granted') {
    return 'default';
  }

  try {
    const registration = await navigator.serviceWorker.getRegistration('/');
    if (!registration) {
      return 'granted';
    }

    const subscription = await registration.pushManager.getSubscription();
    return subscription ? 'subscribed' : 'granted';
  } catch {
    return 'granted';
  }
}

/**
 * Persists a browser Push subscription to web_push_subscriptions via the
 * upsert_web_push_subscription RPC (migration 0021) — the ONE place both
 * enableWebPush() and reconcileWebPushSubscription() below write a
 * subscription, so there is never a second, parallel persistence path to
 * keep in sync. The RPC itself is a plain upsert (ON CONFLICT (endpoint) DO
 * UPDATE), so calling this again for an already-persisted subscription is
 * always safe and cheap — that idempotency is exactly what makes the
 * reconcile path below able to "repair" a subscription by simply
 * re-calling this.
 */
async function persistSubscription(subscription: PushSubscription): Promise<void> {
  if (!supabase) {
    throw new Error('Supabase is not configured');
  }

  const json = subscription.toJSON();
  const endpoint = json.endpoint;
  const p256dh = json.keys?.p256dh;
  const auth = json.keys?.auth;

  if (!endpoint || !p256dh || !auth) {
    throw new Error('Browser returned an incomplete Web Push subscription');
  }

  const { error } = await supabase.rpc('upsert_web_push_subscription', {
    p_endpoint: endpoint,
    p_p256dh: p256dh,
    p_auth: auth,
  });

  if (error) {
    throw error;
  }
}

/**
 * Must be called from a direct user action (button/tap).
 *
 * iPhone/iPad Web Push requires the site to be installed as a Home Screen
 * web app and notification permission must be requested as a result of
 * explicit user interaction.
 */
export async function enableWebPush(): Promise<WebPushStatus> {
  if (!isWebPushSupported()) {
    return 'unsupported';
  }

  if (!isSupabaseConfigured || !supabase) {
    throw new Error('Supabase is not configured');
  }

  const vapidPublicKey = process.env.EXPO_PUBLIC_VAPID_PUBLIC_KEY?.trim();

  if (!vapidPublicKey) {
    throw new Error('VAPID public key is missing');
  }

  let permission = Notification.permission;

  if (permission === 'default') {
    permission = await Notification.requestPermission();
  }

  if (permission === 'denied') {
    return 'denied';
  }

  if (permission !== 'granted') {
    return 'default';
  }

  const registration = await navigator.serviceWorker.register('/sw.js', {
    scope: '/',
  });

  await navigator.serviceWorker.ready;

  let subscription = await registration.pushManager.getSubscription();

  if (!subscription) {
    subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(vapidPublicKey),
    });
  }

  await persistSubscription(subscription);

  return 'subscribed';
}

/**
 * Request-notifications repair — "refresh/reopen recovery". getWebPushStatus()
 * only ever reports what the BROWSER believes locally (Notification.permission
 * + PushManager.getSubscription()); it never confirms the server still has a
 * matching web_push_subscriptions row. A subscription that locally reads
 * 'subscribed' permanently hides RemindersModal's "אפשר התראות" button (it
 * only renders while status !== 'subscribed'), so if the one-time
 * upsert_web_push_subscription() call in enableWebPush() ever failed
 * silently — a dropped network response, or the historical case: this
 * device's real_current_profile_id() not yet resolving before migration
 * 0101's self-heal ran (see that migration's header comment) — there was no
 * way back in short of the person manually clearing site data.
 *
 * Silent, best-effort, idempotent, NEVER throws — safe to call on every
 * app launch/foreground (see App.tsx) and whenever RemindersModal opens,
 * not only in response to an explicit tap:
 *   - An existing local subscription is RE-persisted via the same
 *     persistSubscription() enableWebPush() uses — repairs a silently
 *     failed prior attempt with no user action needed.
 *   - Permission is already 'granted' but no local subscription exists
 *     (the browser invalidated/expired it, or it was granted without ever
 *     subscribing) -> proactively re-subscribes and persists the new one.
 *     This is safe outside a direct tap/gesture: only
 *     Notification.requestPermission() requires one, not
 *     pushManager.subscribe() once permission already reads 'granted' —
 *     true on iOS 16.4+ PWA too.
 * Returns the resulting status, falling back to getWebPushStatus()'s own
 * read-only report if persistence/(re)subscription itself fails, so a
 * caller can always still show an accurate status even when the repair
 * attempt didn't succeed this time.
 */
export async function reconcileWebPushSubscription(): Promise<WebPushStatus> {
  if (!isWebPushSupported()) {
    return 'unsupported';
  }

  if (Notification.permission === 'denied') {
    return 'denied';
  }

  if (Notification.permission !== 'granted') {
    return 'default';
  }

  if (!isSupabaseConfigured || !supabase) {
    return 'granted';
  }

  const vapidPublicKey = process.env.EXPO_PUBLIC_VAPID_PUBLIC_KEY?.trim();
  if (!vapidPublicKey) {
    return 'granted';
  }

  try {
    const registration = await navigator.serviceWorker.register('/sw.js', { scope: '/' });
    await navigator.serviceWorker.ready;

    let subscription = await registration.pushManager.getSubscription();
    if (!subscription) {
      subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(vapidPublicKey),
      });
    }

    await persistSubscription(subscription);
    return 'subscribed';
  } catch {
    return getWebPushStatus();
  }
}