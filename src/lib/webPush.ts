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

  return 'subscribed';
}