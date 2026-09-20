import { Platform } from 'react-native';
import { getCurrentWebPushEndpoint, getWebPushStatus } from '../webPush';

const ORIGINAL_ENV = process.env;
const originalPlatformOS = Platform.OS;

function setPlatformOS(os: typeof Platform.OS) {
  Object.defineProperty(Platform, 'OS', { value: os, configurable: true, writable: true });
}

/**
 * jest-expo's test environment is Node, so none of `window`/`navigator`/
 * `Notification` exist unless a test stubs them — that absence is exactly
 * what `isWebPushSupported()` checks for on native platforms, and it's why
 * this file was the project's one remaining 0%-covered `src/lib` module.
 * `window.Notification` and the bare global `Notification` reference used
 * by the module's own permission checks must be the *same* object, the way
 * a real browser aliases them.
 */
function stubBrowserGlobals(notification: Record<string, unknown>) {
  (global as any).Notification = notification;
  (global as any).window = {
    PushManager: {},
    Notification: notification,
    atob: (base64: string) => Buffer.from(base64, 'base64').toString('binary'),
  };
}

function setNavigatorServiceWorker(serviceWorker: Record<string, unknown>) {
  (global as any).navigator = { serviceWorker };
}

function clearBrowserGlobals() {
  delete (global as any).window;
  delete (global as any).navigator;
  delete (global as any).Notification;
}

function urlBase64ToBytes(base64String: string): number[] {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  return Array.from(Buffer.from(base64, 'base64'));
}

const VAPID_KEY = 'BEl62iUYgUivxIkv69yViEuiBIa-Ib9-SkvMeAtA3LFgDzkrxZJjSgSnfckjBJuBkr3qBUYIHBQFLXYp5Nksh8U';

afterEach(() => {
  process.env = ORIGINAL_ENV;
  setPlatformOS(originalPlatformOS);
  clearBrowserGlobals();
  jest.resetModules();
});

describe('lib/webPush — getCurrentWebPushEndpoint', () => {
  it('returns null on a native platform (unsupported, no browser globals needed)', async () => {
    setPlatformOS('ios');
    await expect(getCurrentWebPushEndpoint()).resolves.toBeNull();
  });

  it('returns null when the browser globals exist but are missing required APIs', async () => {
    setPlatformOS('web');
    // No PushManager/Notification present on window — still unsupported.
    (global as any).window = {};
    (global as any).navigator = { serviceWorker: {} };
    await expect(getCurrentWebPushEndpoint()).resolves.toBeNull();
  });

  it('returns null when there is no existing service worker registration', async () => {
    setPlatformOS('web');
    stubBrowserGlobals({ permission: 'granted' });
    setNavigatorServiceWorker({ getRegistration: jest.fn().mockResolvedValue(undefined) });

    await expect(getCurrentWebPushEndpoint()).resolves.toBeNull();
  });

  it('returns null when the registration has no Push subscription', async () => {
    setPlatformOS('web');
    stubBrowserGlobals({ permission: 'granted' });
    setNavigatorServiceWorker({
      getRegistration: jest.fn().mockResolvedValue({
        pushManager: { getSubscription: jest.fn().mockResolvedValue(null) },
      }),
    });

    await expect(getCurrentWebPushEndpoint()).resolves.toBeNull();
  });

  it('returns the subscription endpoint when one exists', async () => {
    setPlatformOS('web');
    stubBrowserGlobals({ permission: 'granted' });
    setNavigatorServiceWorker({
      getRegistration: jest.fn().mockResolvedValue({
        pushManager: {
          getSubscription: jest.fn().mockResolvedValue({ endpoint: 'https://push.example/device-a' }),
        },
      }),
    });

    await expect(getCurrentWebPushEndpoint()).resolves.toBe('https://push.example/device-a');
  });

  it('resolves null (not throwing) when the registration lookup itself throws', async () => {
    setPlatformOS('web');
    stubBrowserGlobals({ permission: 'granted' });
    setNavigatorServiceWorker({
      getRegistration: jest.fn().mockRejectedValue(new Error('registration lookup failed')),
    });

    await expect(getCurrentWebPushEndpoint()).resolves.toBeNull();
  });
});

describe('lib/webPush — getWebPushStatus', () => {
  it('returns "unsupported" on a native platform', async () => {
    setPlatformOS('ios');
    await expect(getWebPushStatus()).resolves.toBe('unsupported');
  });

  it('returns "denied" when Notification.permission is denied', async () => {
    setPlatformOS('web');
    stubBrowserGlobals({ permission: 'denied' });
    setNavigatorServiceWorker({ getRegistration: jest.fn() });

    await expect(getWebPushStatus()).resolves.toBe('denied');
  });

  it('returns "default" when permission has not been requested yet', async () => {
    setPlatformOS('web');
    stubBrowserGlobals({ permission: 'default' });
    setNavigatorServiceWorker({ getRegistration: jest.fn() });

    await expect(getWebPushStatus()).resolves.toBe('default');
  });

  it('returns "granted" when permission is granted but there is no registration yet', async () => {
    setPlatformOS('web');
    stubBrowserGlobals({ permission: 'granted' });
    setNavigatorServiceWorker({ getRegistration: jest.fn().mockResolvedValue(undefined) });

    await expect(getWebPushStatus()).resolves.toBe('granted');
  });

  it('returns "granted" when registered but not yet subscribed to Push', async () => {
    setPlatformOS('web');
    stubBrowserGlobals({ permission: 'granted' });
    setNavigatorServiceWorker({
      getRegistration: jest.fn().mockResolvedValue({
        pushManager: { getSubscription: jest.fn().mockResolvedValue(null) },
      }),
    });

    await expect(getWebPushStatus()).resolves.toBe('granted');
  });

  it('returns "subscribed" when a Push subscription already exists', async () => {
    setPlatformOS('web');
    stubBrowserGlobals({ permission: 'granted' });
    setNavigatorServiceWorker({
      getRegistration: jest.fn().mockResolvedValue({
        pushManager: { getSubscription: jest.fn().mockResolvedValue({ endpoint: 'https://push.example/x' }) },
      }),
    });

    await expect(getWebPushStatus()).resolves.toBe('subscribed');
  });

  it('falls back to "granted" (not throwing) when the registration lookup throws', async () => {
    setPlatformOS('web');
    stubBrowserGlobals({ permission: 'granted' });
    setNavigatorServiceWorker({
      getRegistration: jest.fn().mockRejectedValue(new Error('registration lookup failed')),
    });

    await expect(getWebPushStatus()).resolves.toBe('granted');
  });
});

describe('lib/webPush — enableWebPush', () => {
  function mockSupabase(overrides: { isSupabaseConfigured: boolean; rpc?: jest.Mock }) {
    jest.doMock('../supabase', () => ({
      isSupabaseConfigured: overrides.isSupabaseConfigured,
      supabase: overrides.isSupabaseConfigured ? { rpc: overrides.rpc } : null,
    }));
  }

  function requireEnableWebPush() {
    return require('../webPush').enableWebPush as typeof import('../webPush').enableWebPush;
  }

  beforeEach(() => {
    jest.resetModules();
  });

  it('returns "unsupported" on a native platform before touching Supabase or permissions', async () => {
    setPlatformOS('ios');
    mockSupabase({ isSupabaseConfigured: false });

    const enableWebPush = requireEnableWebPush();
    await expect(enableWebPush()).resolves.toBe('unsupported');
  });

  it('throws when Supabase is not configured', async () => {
    setPlatformOS('web');
    stubBrowserGlobals({ permission: 'granted' });
    setNavigatorServiceWorker({ getRegistration: jest.fn() });
    mockSupabase({ isSupabaseConfigured: false });

    const enableWebPush = requireEnableWebPush();
    await expect(enableWebPush()).rejects.toThrow('Supabase is not configured');
  });

  it('throws when the VAPID public key env var is missing', async () => {
    setPlatformOS('web');
    stubBrowserGlobals({ permission: 'granted' });
    setNavigatorServiceWorker({ getRegistration: jest.fn() });
    mockSupabase({ isSupabaseConfigured: true, rpc: jest.fn() });
    process.env = { ...ORIGINAL_ENV, EXPO_PUBLIC_VAPID_PUBLIC_KEY: '   ' };

    const enableWebPush = requireEnableWebPush();
    await expect(enableWebPush()).rejects.toThrow('VAPID public key is missing');
  });

  it('requests permission when not yet decided, and returns "denied" without registering a service worker if the user declines', async () => {
    setPlatformOS('web');
    const requestPermission = jest.fn().mockResolvedValue('denied');
    stubBrowserGlobals({ permission: 'default', requestPermission });
    const register = jest.fn();
    setNavigatorServiceWorker({ register });
    mockSupabase({ isSupabaseConfigured: true, rpc: jest.fn() });
    process.env = { ...ORIGINAL_ENV, EXPO_PUBLIC_VAPID_PUBLIC_KEY: VAPID_KEY };

    const enableWebPush = requireEnableWebPush();
    await expect(enableWebPush()).resolves.toBe('denied');
    expect(requestPermission).toHaveBeenCalled();
    expect(register).not.toHaveBeenCalled();
  });

  it('requests permission and returns "default" if the browser prompt is dismissed without a decision', async () => {
    setPlatformOS('web');
    const requestPermission = jest.fn().mockResolvedValue('default');
    stubBrowserGlobals({ permission: 'default', requestPermission });
    const register = jest.fn();
    setNavigatorServiceWorker({ register });
    mockSupabase({ isSupabaseConfigured: true, rpc: jest.fn() });
    process.env = { ...ORIGINAL_ENV, EXPO_PUBLIC_VAPID_PUBLIC_KEY: VAPID_KEY };

    const enableWebPush = requireEnableWebPush();
    await expect(enableWebPush()).resolves.toBe('default');
    expect(register).not.toHaveBeenCalled();
  });

  it('reuses an existing Push subscription instead of creating a new one, and upserts it via RPC', async () => {
    setPlatformOS('web');
    stubBrowserGlobals({ permission: 'granted' });
    const subscribe = jest.fn();
    const getSubscription = jest.fn().mockResolvedValue({
      toJSON: () => ({ endpoint: 'https://push.example/existing', keys: { p256dh: 'p256dh-key', auth: 'auth-key' } }),
    });
    const register = jest.fn().mockResolvedValue({
      pushManager: { getSubscription, subscribe },
    });
    setNavigatorServiceWorker({ register, ready: Promise.resolve() });
    const rpc = jest.fn().mockResolvedValue({ error: null });
    mockSupabase({ isSupabaseConfigured: true, rpc });
    process.env = { ...ORIGINAL_ENV, EXPO_PUBLIC_VAPID_PUBLIC_KEY: VAPID_KEY };

    const enableWebPush = requireEnableWebPush();
    await expect(enableWebPush()).resolves.toBe('subscribed');

    expect(register).toHaveBeenCalledWith('/sw.js', { scope: '/' });
    expect(subscribe).not.toHaveBeenCalled();
    expect(rpc).toHaveBeenCalledWith('upsert_web_push_subscription', {
      p_endpoint: 'https://push.example/existing',
      p_p256dh: 'p256dh-key',
      p_auth: 'auth-key',
    });
  });

  it('creates a new Push subscription from the VAPID key when none exists yet', async () => {
    setPlatformOS('web');
    stubBrowserGlobals({ permission: 'granted' });
    const subscribe = jest.fn().mockResolvedValue({
      toJSON: () => ({ endpoint: 'https://push.example/new', keys: { p256dh: 'p256dh-new', auth: 'auth-new' } }),
    });
    const getSubscription = jest.fn().mockResolvedValue(null);
    const register = jest.fn().mockResolvedValue({
      pushManager: { getSubscription, subscribe },
    });
    setNavigatorServiceWorker({ register, ready: Promise.resolve() });
    const rpc = jest.fn().mockResolvedValue({ error: null });
    mockSupabase({ isSupabaseConfigured: true, rpc });
    process.env = { ...ORIGINAL_ENV, EXPO_PUBLIC_VAPID_PUBLIC_KEY: VAPID_KEY };

    const enableWebPush = requireEnableWebPush();
    await expect(enableWebPush()).resolves.toBe('subscribed');

    expect(subscribe).toHaveBeenCalledTimes(1);
    const subscribeArgs = subscribe.mock.calls[0][0];
    expect(subscribeArgs.userVisibleOnly).toBe(true);
    expect(Array.from(new Uint8Array(subscribeArgs.applicationServerKey))).toEqual(urlBase64ToBytes(VAPID_KEY));
    expect(rpc).toHaveBeenCalledWith('upsert_web_push_subscription', {
      p_endpoint: 'https://push.example/new',
      p_p256dh: 'p256dh-new',
      p_auth: 'auth-new',
    });
  });

  it('throws when the browser returns a subscription missing required keys', async () => {
    setPlatformOS('web');
    stubBrowserGlobals({ permission: 'granted' });
    const getSubscription = jest.fn().mockResolvedValue({
      toJSON: () => ({ endpoint: 'https://push.example/incomplete', keys: {} }),
    });
    const register = jest.fn().mockResolvedValue({
      pushManager: { getSubscription, subscribe: jest.fn() },
    });
    setNavigatorServiceWorker({ register, ready: Promise.resolve() });
    const rpc = jest.fn();
    mockSupabase({ isSupabaseConfigured: true, rpc });
    process.env = { ...ORIGINAL_ENV, EXPO_PUBLIC_VAPID_PUBLIC_KEY: VAPID_KEY };

    const enableWebPush = requireEnableWebPush();
    await expect(enableWebPush()).rejects.toThrow('Browser returned an incomplete Web Push subscription');
    expect(rpc).not.toHaveBeenCalled();
  });

  it('propagates the RPC error when the server rejects the subscription upsert', async () => {
    setPlatformOS('web');
    stubBrowserGlobals({ permission: 'granted' });
    const getSubscription = jest.fn().mockResolvedValue({
      toJSON: () => ({ endpoint: 'https://push.example/x', keys: { p256dh: 'p', auth: 'a' } }),
    });
    const register = jest.fn().mockResolvedValue({
      pushManager: { getSubscription, subscribe: jest.fn() },
    });
    setNavigatorServiceWorker({ register, ready: Promise.resolve() });
    const rpcError = new Error('row level security violation');
    const rpc = jest.fn().mockResolvedValue({ error: rpcError });
    mockSupabase({ isSupabaseConfigured: true, rpc });
    process.env = { ...ORIGINAL_ENV, EXPO_PUBLIC_VAPID_PUBLIC_KEY: VAPID_KEY };

    const enableWebPush = requireEnableWebPush();
    await expect(enableWebPush()).rejects.toBe(rpcError);
  });
});
