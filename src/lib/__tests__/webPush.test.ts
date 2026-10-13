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

/**
 * Request-notifications repair — "refresh/reopen recovery". This repairs
 * the exact gap a real-device QA pass found: web_push_subscriptions stayed
 * empty even though notification permission was already granted, because
 * getWebPushStatus() only ever trusted the browser's local state and never
 * verified/repaired server-side persistence. These tests cover fresh
 * subscribe, repair-on-reopen, and re-subscribe-after-expiry — the three
 * P0 scenarios explicitly required: "fresh supported device → permission
 * granted → subscription persisted" and "reopening an already-subscribed
 * PWA preserves/repairs registration".
 */
describe('lib/webPush — reconcileWebPushSubscription (refresh/reopen recovery)', () => {
  function mockSupabase(overrides: { isSupabaseConfigured: boolean; rpc?: jest.Mock }) {
    jest.doMock('../supabase', () => ({
      isSupabaseConfigured: overrides.isSupabaseConfigured,
      supabase: overrides.isSupabaseConfigured ? { rpc: overrides.rpc } : null,
    }));
  }

  function requireReconcile() {
    return require('../webPush').reconcileWebPushSubscription as typeof import('../webPush').reconcileWebPushSubscription;
  }

  beforeEach(() => {
    jest.resetModules();
  });

  it('is a complete no-op (never prompts) when permission has not been granted yet', async () => {
    setPlatformOS('web');
    stubBrowserGlobals({ permission: 'default' });
    const register = jest.fn();
    setNavigatorServiceWorker({ register });
    mockSupabase({ isSupabaseConfigured: true, rpc: jest.fn() });

    const reconcile = requireReconcile();
    await expect(reconcile()).resolves.toBe('default');
    expect(register).not.toHaveBeenCalled();
  });

  it('FRESH DEVICE: permission already granted, no subscription yet -> subscribes and persists it', async () => {
    setPlatformOS('web');
    stubBrowserGlobals({ permission: 'granted' });
    const subscribe = jest.fn().mockResolvedValue({
      toJSON: () => ({ endpoint: 'https://push.example/fresh', keys: { p256dh: 'p1', auth: 'a1' } }),
    });
    const getSubscription = jest.fn().mockResolvedValue(null);
    const register = jest.fn().mockResolvedValue({ pushManager: { getSubscription, subscribe } });
    setNavigatorServiceWorker({ register, ready: Promise.resolve() });
    const rpc = jest.fn().mockResolvedValue({ error: null });
    mockSupabase({ isSupabaseConfigured: true, rpc });
    process.env = { ...ORIGINAL_ENV, EXPO_PUBLIC_VAPID_PUBLIC_KEY: VAPID_KEY };

    const reconcile = requireReconcile();
    await expect(reconcile()).resolves.toBe('subscribed');
    expect(subscribe).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith('upsert_web_push_subscription', {
      p_endpoint: 'https://push.example/fresh',
      p_p256dh: 'p1',
      p_auth: 'a1',
    });
  });

  it('REOPEN REPAIR: an existing local subscription is RE-persisted even though the browser already considers it subscribed — repairs a silently-failed prior upsert', async () => {
    setPlatformOS('web');
    stubBrowserGlobals({ permission: 'granted' });
    const subscribe = jest.fn();
    const getSubscription = jest.fn().mockResolvedValue({
      toJSON: () => ({ endpoint: 'https://push.example/already-subscribed', keys: { p256dh: 'p2', auth: 'a2' } }),
    });
    const register = jest.fn().mockResolvedValue({ pushManager: { getSubscription, subscribe } });
    setNavigatorServiceWorker({ register, ready: Promise.resolve() });
    const rpc = jest.fn().mockResolvedValue({ error: null });
    mockSupabase({ isSupabaseConfigured: true, rpc });
    process.env = { ...ORIGINAL_ENV, EXPO_PUBLIC_VAPID_PUBLIC_KEY: VAPID_KEY };

    const reconcile = requireReconcile();
    await expect(reconcile()).resolves.toBe('subscribed');
    // Never re-subscribes when a local subscription already exists —
    // only re-persists it.
    expect(subscribe).not.toHaveBeenCalled();
    expect(rpc).toHaveBeenCalledWith('upsert_web_push_subscription', {
      p_endpoint: 'https://push.example/already-subscribed',
      p_p256dh: 'p2',
      p_auth: 'a2',
    });
  });

  it('EXPIRY/REPLACEMENT: permission granted but the browser no longer has a subscription (expired/invalidated) -> re-subscribes without needing a fresh user gesture', async () => {
    setPlatformOS('web');
    stubBrowserGlobals({ permission: 'granted' });
    const subscribe = jest.fn().mockResolvedValue({
      toJSON: () => ({ endpoint: 'https://push.example/replacement', keys: { p256dh: 'p3', auth: 'a3' } }),
    });
    const getSubscription = jest.fn().mockResolvedValue(null);
    const register = jest.fn().mockResolvedValue({ pushManager: { getSubscription, subscribe } });
    setNavigatorServiceWorker({ register, ready: Promise.resolve() });
    const rpc = jest.fn().mockResolvedValue({ error: null });
    mockSupabase({ isSupabaseConfigured: true, rpc });
    process.env = { ...ORIGINAL_ENV, EXPO_PUBLIC_VAPID_PUBLIC_KEY: VAPID_KEY };

    const reconcile = requireReconcile();
    await expect(reconcile()).resolves.toBe('subscribed');
    expect(subscribe).toHaveBeenCalledTimes(1);
  });

  // REAL-DEVICE QA FIX: this used to assert the OLD, buggy behavior —
  // persistence failing silently fell back to a local-only status read,
  // which reported 'subscribed' purely because the browser already held a
  // local subscription, with the actual server-side failure discarded
  // entirely. That is precisely the bug a real iPhone pass found: zero
  // rows in web_push_subscriptions while the device looked fully
  // "subscribed". Persistence failure must now be its own distinct,
  // observable, retryable 'error' status — never silently reported as
  // success just because the local browser state looks fine.
  it('PERSISTENCE FAILURE: never throws, but reports a distinct "error" status (never "subscribed") and logs the failure for diagnosis', async () => {
    setPlatformOS('web');
    stubBrowserGlobals({ permission: 'granted' });
    const getSubscription = jest.fn().mockResolvedValue({
      toJSON: () => ({ endpoint: 'https://push.example/x', keys: { p256dh: 'p', auth: 'a' } }),
    });
    const registration = { pushManager: { getSubscription, subscribe: jest.fn() } };
    const register = jest.fn().mockResolvedValue(registration);
    setNavigatorServiceWorker({ register, ready: Promise.resolve() });
    const rpcError = new Error('network error');
    const rpc = jest.fn().mockResolvedValue({ error: rpcError });
    mockSupabase({ isSupabaseConfigured: true, rpc });
    process.env = { ...ORIGINAL_ENV, EXPO_PUBLIC_VAPID_PUBLIC_KEY: VAPID_KEY };
    const consoleError = jest.spyOn(console, 'error').mockImplementation(() => undefined);

    const reconcile = requireReconcile();
    await expect(reconcile()).resolves.toBe('error');
    expect(rpc).toHaveBeenCalledWith('upsert_web_push_subscription', {
      p_endpoint: 'https://push.example/x',
      p_p256dh: 'p',
      p_auth: 'a',
    });
    expect(consoleError).toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it('REGISTRATION FAILURE: a genuine local/browser-capability failure (never reached persistence) still falls back to a plain local status read', async () => {
    setPlatformOS('web');
    stubBrowserGlobals({ permission: 'granted' });
    const register = jest.fn().mockRejectedValue(new Error('registration failed'));
    const getRegistration = jest.fn().mockResolvedValue(undefined);
    setNavigatorServiceWorker({ register, getRegistration, ready: Promise.resolve() });
    const rpc = jest.fn();
    mockSupabase({ isSupabaseConfigured: true, rpc });
    process.env = { ...ORIGINAL_ENV, EXPO_PUBLIC_VAPID_PUBLIC_KEY: VAPID_KEY };
    const consoleError = jest.spyOn(console, 'error').mockImplementation(() => undefined);

    const reconcile = requireReconcile();
    await expect(reconcile()).resolves.toBe('granted');
    expect(rpc).not.toHaveBeenCalled();
    expect(consoleError).toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it('is a no-op when Supabase is not configured (local/demo mode) — never throws', async () => {
    setPlatformOS('web');
    stubBrowserGlobals({ permission: 'granted' });
    setNavigatorServiceWorker({ register: jest.fn() });
    mockSupabase({ isSupabaseConfigured: false });

    const reconcile = requireReconcile();
    await expect(reconcile()).resolves.toBe('granted');
  });
});

describe('lib/webPush — verifyServerSubscription', () => {
  function mockSupabase(overrides: { isSupabaseConfigured: boolean; rpc?: jest.Mock }) {
    jest.doMock('../supabase', () => ({
      isSupabaseConfigured: overrides.isSupabaseConfigured,
      supabase: overrides.isSupabaseConfigured ? { rpc: overrides.rpc } : null,
    }));
  }

  function requireVerify() {
    return require('../webPush').verifyServerSubscription as typeof import('../webPush').verifyServerSubscription;
  }

  beforeEach(() => {
    jest.resetModules();
  });

  it('P0 notification-delivery investigation: returns true when the server confirms an active row for this device\'s own endpoint', async () => {
    setPlatformOS('web');
    stubBrowserGlobals({ permission: 'granted' });
    const getSubscription = jest.fn().mockResolvedValue({ endpoint: 'https://push.example/mine' });
    const getRegistration = jest.fn().mockResolvedValue({ pushManager: { getSubscription } });
    setNavigatorServiceWorker({ getRegistration });
    const rpc = jest.fn().mockResolvedValue({ data: true, error: null });
    mockSupabase({ isSupabaseConfigured: true, rpc });

    const verifyServerSubscription = requireVerify();
    await expect(verifyServerSubscription()).resolves.toBe(true);
    expect(rpc).toHaveBeenCalledWith('has_active_remote_push_channel', {
      p_web_push_endpoint: 'https://push.example/mine',
    });
  });

  it('returns false (not null) when the server has no active row for this device — a real subscription exists locally but the server disagrees', async () => {
    setPlatformOS('web');
    stubBrowserGlobals({ permission: 'granted' });
    const getSubscription = jest.fn().mockResolvedValue({ endpoint: 'https://push.example/mine' });
    const getRegistration = jest.fn().mockResolvedValue({ pushManager: { getSubscription } });
    setNavigatorServiceWorker({ getRegistration });
    const rpc = jest.fn().mockResolvedValue({ data: false, error: null });
    mockSupabase({ isSupabaseConfigured: true, rpc });

    const verifyServerSubscription = requireVerify();
    await expect(verifyServerSubscription()).resolves.toBe(false);
  });

  it('returns null (not false) when there is no local subscription to check at all', async () => {
    setPlatformOS('web');
    stubBrowserGlobals({ permission: 'granted' });
    const getRegistration = jest.fn().mockResolvedValue(undefined);
    setNavigatorServiceWorker({ getRegistration });
    const rpc = jest.fn();
    mockSupabase({ isSupabaseConfigured: true, rpc });

    const verifyServerSubscription = requireVerify();
    await expect(verifyServerSubscription()).resolves.toBeNull();
    expect(rpc).not.toHaveBeenCalled();
  });

  it('returns null (never throws) when the RPC call itself fails', async () => {
    setPlatformOS('web');
    stubBrowserGlobals({ permission: 'granted' });
    const getSubscription = jest.fn().mockResolvedValue({ endpoint: 'https://push.example/mine' });
    const getRegistration = jest.fn().mockResolvedValue({ pushManager: { getSubscription } });
    setNavigatorServiceWorker({ getRegistration });
    const rpc = jest.fn().mockRejectedValue(new Error('offline'));
    mockSupabase({ isSupabaseConfigured: true, rpc });

    const verifyServerSubscription = requireVerify();
    await expect(verifyServerSubscription()).resolves.toBeNull();
  });

  it('returns null when Supabase is not configured', async () => {
    setPlatformOS('web');
    mockSupabase({ isSupabaseConfigured: false });

    const verifyServerSubscription = requireVerify();
    await expect(verifyServerSubscription()).resolves.toBeNull();
  });
});
