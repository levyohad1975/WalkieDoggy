import { Platform } from 'react-native';

const ORIGINAL_ENV = process.env;
const ORIGINAL_PLATFORM_OS = Platform.OS;

/**
 * registerPushToken()/sendRequestPush() need native modules
 * (expo-constants/expo-notifications/expo-device) and a configured Supabase
 * client. jest-expo's preset already provides non-throwing JS stand-ins for
 * the Expo native modules under Jest (confirmed by
 * notifications/__tests__/debugExpoConstants.test.ts), expo-notifications is
 * globally mocked in jest.setup.js, and this project's established pattern
 * for a configured Supabase client (see supabaseQaAndSession.test.ts) mocks
 * `@supabase/supabase-js` after setting the EXPO_PUBLIC_SUPABASE_* env vars
 * and `jest.resetModules()`. Combining those means this native/Supabase
 * integration path IS exercisable end-to-end here, client-call-shape only —
 * same scope/rationale as supabaseFamily.test.ts — despite pushTokens.ts's
 * own module-load-time doc comment assuming otherwise for
 * `getExpoPushTokenIfKnown()`'s default-value test above.
 *
 * `configureSupabase`/`configureSupabaseUnset` always fully replace
 * `process.env` from `ORIGINAL_ENV` rather than mutating the live
 * `process.env` object in place (including for `NODE_ENV` via the `nodeEnv`
 * param below) — a direct `process.env.NODE_ENV = ...` would mutate
 * `ORIGINAL_ENV` itself whenever it runs before the first
 * `configureSupabase*` call of a test (since `afterEach` merely re-points
 * `process.env` back to the `ORIGINAL_ENV` reference, it can't undo a prior
 * in-place mutation of that same object), permanently leaking a NODE_ENV
 * override into every later test in this file.
 */
function configureSupabase(
  rpc: jest.Mock,
  invoke: jest.Mock = jest.fn().mockResolvedValue({ data: null, error: null }),
  nodeEnv?: 'development' | 'production' | 'test'
) {
  process.env = {
    ...ORIGINAL_ENV,
    EXPO_PUBLIC_SUPABASE_URL: 'https://example.supabase.co',
    EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'anon-key',
    ...(nodeEnv !== undefined ? { NODE_ENV: nodeEnv } : {}),
  };
  jest.doMock('@supabase/supabase-js', () => ({
    createClient: jest.fn(() => ({
      auth: { getSession: jest.fn(), signInAnonymously: jest.fn() },
      rpc,
      from: jest.fn(),
      storage: { from: jest.fn() },
      functions: { invoke },
    })),
  }));
}

function configureSupabaseUnset() {
  process.env = {
    ...ORIGINAL_ENV,
    EXPO_PUBLIC_SUPABASE_URL: '',
    EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY: '',
  };
}

/**
 * Registration-eligible runtime (not Expo Go), with a configured EAS
 * projectId — pass `null` (not `undefined`) to simulate no projectId
 * configured yet, since a JS default parameter also substitutes for an
 * explicitly-passed `undefined`.
 */
function mockEligibleConstants(projectId: string | null = 'test-project-id') {
  jest.doMock('expo-constants', () => ({
    executionEnvironment: 'standalone',
    expoConfig: { extra: { eas: { projectId: projectId ?? undefined } } },
  }));
}

function mockExpoGoConstants() {
  jest.doMock('expo-constants', () => ({
    executionEnvironment: 'storeClient',
    expoGoConfig: { debuggerHost: '127.0.0.1:19000' },
  }));
}

function mockDevice(isDevice: boolean | undefined) {
  jest.doMock('expo-device', () => ({ isDevice }));
}

/**
 * jest.doMock registrations persist across tests within a file (unlike
 * jest.resetModules(), which only clears the require cache, not the mock
 * factory map) — so every test that needs a working expo-notifications must
 * re-register this default here in its own beforeEach, otherwise a *later*
 * test that deliberately makes expo-notifications throw (to cover the
 * require()-failure branch) would leak a broken mock into every test after
 * it in file order.
 */
function mockWorkingNotifications() {
  jest.doMock('expo-notifications', () => ({
    setNotificationHandler: jest.fn(),
    getPermissionsAsync: jest.fn().mockResolvedValue({ status: 'granted' }),
    requestPermissionsAsync: jest.fn().mockResolvedValue({ status: 'granted' }),
    getExpoPushTokenAsync: jest.fn().mockResolvedValue({ data: 'ExponentPushToken[default]' }),
  }));
}

function getNotifications() {
  return require('expo-notifications');
}

describe('registerPushToken (native + Supabase mode)', () => {
  beforeEach(() => {
    jest.resetModules();
    mockWorkingNotifications();
  });

  afterEach(() => {
    process.env = ORIGINAL_ENV;
    (Platform as any).OS = ORIGINAL_PLATFORM_OS;
    jest.restoreAllMocks();
  });

  it('is a no-op in local/demo mode (Supabase not configured) and never touches native permission APIs', async () => {
    configureSupabaseUnset();
    mockEligibleConstants();
    mockDevice(true);
    const Notifications = getNotifications();
    const permSpy = jest.spyOn(Notifications, 'getPermissionsAsync');
    const { registerPushToken } = require('../pushTokens');

    await registerPushToken();

    expect(permSpy).not.toHaveBeenCalled();
  });

  it('is a silent no-op in Expo Go, never loading expo-notifications at all', async () => {
    const rpc = jest.fn();
    configureSupabase(rpc);
    mockExpoGoConstants();
    mockDevice(true);
    const Notifications = getNotifications();
    const permSpy = jest.spyOn(Notifications, 'getPermissionsAsync');
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { registerPushToken } = require('../pushTokens');

    await registerPushToken();

    expect(permSpy).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('fails open to a quiet warn (dev) when expo-constants itself cannot be loaded', async () => {
    const rpc = jest.fn();
    configureSupabase(rpc, undefined, 'development');
    jest.doMock('expo-constants', () => {
      throw new Error('native module missing under this runtime');
    });
    mockDevice(true);
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { registerPushToken } = require('../pushTokens');

    await registerPushToken();

    expect(warnSpy).toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
  });

  it('warns once (dev) and skips registration when no EAS projectId is configured yet', async () => {
    const rpc = jest.fn();
    configureSupabase(rpc, undefined, 'development');
    mockEligibleConstants(null);
    mockDevice(true);
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { registerPushToken } = require('../pushTokens');

    await registerPushToken();

    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(rpc).not.toHaveBeenCalled();
  });

  it('stays silent in production when no EAS projectId is configured yet', async () => {
    const rpc = jest.fn();
    configureSupabase(rpc, undefined, 'production');
    mockEligibleConstants(null);
    mockDevice(true);
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { registerPushToken } = require('../pushTokens');

    await registerPushToken();

    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('returns silently when expo-notifications cannot be loaded, even with a valid projectId', async () => {
    const rpc = jest.fn();
    configureSupabase(rpc);
    mockEligibleConstants();
    mockDevice(true);
    jest.doMock('expo-notifications', () => {
      throw new Error('native module missing under this runtime');
    });
    const { registerPushToken } = require('../pushTokens');

    await expect(registerPushToken()).resolves.toBeUndefined();
    expect(rpc).not.toHaveBeenCalled();
  });

  it('treats an unloadable expo-device as "unknown device" and still proceeds with registration', async () => {
    const rpc = jest.fn().mockResolvedValue({ error: null });
    configureSupabase(rpc);
    mockEligibleConstants();
    jest.doMock('expo-device', () => {
      throw new Error('native module missing under this runtime');
    });
    const Notifications = getNotifications();
    Notifications.getPermissionsAsync = jest.fn().mockResolvedValue({ status: 'granted' });
    Notifications.getExpoPushTokenAsync = jest.fn().mockResolvedValue({ data: 'ExponentPushToken[abc]' });
    const { registerPushToken } = require('../pushTokens');

    await registerPushToken();

    expect(rpc).toHaveBeenCalledWith('upsert_push_token', {
      p_token: 'ExponentPushToken[abc]',
      p_platform: 'ios',
    });
  });

  it('returns without registering when expo-device reports this is not a physical device', async () => {
    const rpc = jest.fn();
    configureSupabase(rpc);
    mockEligibleConstants();
    mockDevice(false);
    const Notifications = getNotifications();
    const permSpy = jest.spyOn(Notifications, 'getPermissionsAsync');
    const { registerPushToken } = require('../pushTokens');

    await registerPushToken();

    expect(permSpy).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
  });

  it('requests permission only when not already granted, then registers on success', async () => {
    const rpc = jest.fn().mockResolvedValue({ error: null });
    configureSupabase(rpc);
    mockEligibleConstants();
    mockDevice(true);
    const Notifications = getNotifications();
    Notifications.getPermissionsAsync = jest.fn().mockResolvedValue({ status: 'undetermined' });
    Notifications.requestPermissionsAsync = jest.fn().mockResolvedValue({ status: 'granted' });
    Notifications.getExpoPushTokenAsync = jest.fn().mockResolvedValue({ data: 'ExponentPushToken[xyz]' });
    const { registerPushToken, getExpoPushTokenIfKnown } = require('../pushTokens');

    await registerPushToken();

    expect(Notifications.requestPermissionsAsync).toHaveBeenCalled();
    expect(getExpoPushTokenIfKnown()).toBe('ExponentPushToken[xyz]');
  });

  it('does not request permission again when already granted', async () => {
    const rpc = jest.fn().mockResolvedValue({ error: null });
    configureSupabase(rpc);
    mockEligibleConstants();
    mockDevice(true);
    const Notifications = getNotifications();
    Notifications.getPermissionsAsync = jest.fn().mockResolvedValue({ status: 'granted' });
    Notifications.requestPermissionsAsync = jest.fn();
    Notifications.getExpoPushTokenAsync = jest.fn().mockResolvedValue({ data: 'ExponentPushToken[xyz]' });
    const { registerPushToken } = require('../pushTokens');

    await registerPushToken();

    expect(Notifications.requestPermissionsAsync).not.toHaveBeenCalled();
    expect(rpc).toHaveBeenCalled();
  });

  it('returns without registering when permission is still denied after requesting', async () => {
    const rpc = jest.fn();
    configureSupabase(rpc);
    mockEligibleConstants();
    mockDevice(true);
    const Notifications = getNotifications();
    Notifications.getPermissionsAsync = jest.fn().mockResolvedValue({ status: 'undetermined' });
    Notifications.requestPermissionsAsync = jest.fn().mockResolvedValue({ status: 'denied' });
    const { registerPushToken, getExpoPushTokenIfKnown } = require('../pushTokens');

    await registerPushToken();

    expect(rpc).not.toHaveBeenCalled();
    expect(getExpoPushTokenIfKnown()).toBeNull();
  });

  it('returns without registering when the token response has no data', async () => {
    const rpc = jest.fn();
    configureSupabase(rpc);
    mockEligibleConstants();
    mockDevice(true);
    const Notifications = getNotifications();
    Notifications.getPermissionsAsync = jest.fn().mockResolvedValue({ status: 'granted' });
    Notifications.getExpoPushTokenAsync = jest.fn().mockResolvedValue({ data: undefined });
    const { registerPushToken, getExpoPushTokenIfKnown } = require('../pushTokens');

    await registerPushToken();

    expect(rpc).not.toHaveBeenCalled();
    expect(getExpoPushTokenIfKnown()).toBeNull();
  });

  it('reports the android platform to upsert_push_token on Android', async () => {
    (Platform as any).OS = 'android';
    const rpc = jest.fn().mockResolvedValue({ error: null });
    configureSupabase(rpc);
    mockEligibleConstants();
    mockDevice(true);
    const Notifications = getNotifications();
    Notifications.getPermissionsAsync = jest.fn().mockResolvedValue({ status: 'granted' });
    Notifications.getExpoPushTokenAsync = jest.fn().mockResolvedValue({ data: 'ExponentPushToken[droid]' });
    const { registerPushToken } = require('../pushTokens');

    await registerPushToken();

    expect(rpc).toHaveBeenCalledWith('upsert_push_token', {
      p_token: 'ExponentPushToken[droid]',
      p_platform: 'android',
    });
  });

  it('reports "unknown" to upsert_push_token on a non-iOS/Android platform', async () => {
    (Platform as any).OS = 'web';
    const rpc = jest.fn().mockResolvedValue({ error: null });
    configureSupabase(rpc);
    mockEligibleConstants();
    mockDevice(true);
    const Notifications = getNotifications();
    Notifications.getPermissionsAsync = jest.fn().mockResolvedValue({ status: 'granted' });
    Notifications.getExpoPushTokenAsync = jest.fn().mockResolvedValue({ data: 'ExponentPushToken[web]' });
    const { registerPushToken } = require('../pushTokens');

    await registerPushToken();

    expect(rpc).toHaveBeenCalledWith('upsert_push_token', {
      p_token: 'ExponentPushToken[web]',
      p_platform: 'unknown',
    });
  });

  it('records the token even when the upsert_push_token RPC fails, and logs (dev) without throwing', async () => {
    const rpc = jest.fn().mockResolvedValue({ error: { message: 'db unavailable' } });
    configureSupabase(rpc, undefined, 'development');
    mockEligibleConstants();
    mockDevice(true);
    const Notifications = getNotifications();
    Notifications.getPermissionsAsync = jest.fn().mockResolvedValue({ status: 'granted' });
    Notifications.getExpoPushTokenAsync = jest.fn().mockResolvedValue({ data: 'ExponentPushToken[abc]' });
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    const { registerPushToken, getExpoPushTokenIfKnown } = require('../pushTokens');

    await expect(registerPushToken()).resolves.toBeUndefined();

    expect(getExpoPushTokenIfKnown()).toBe('ExponentPushToken[abc]');
    expect(errorSpy).toHaveBeenCalled();
  });

  it('does not log an RPC failure in production', async () => {
    const rpc = jest.fn().mockResolvedValue({ error: { message: 'db unavailable' } });
    configureSupabase(rpc, undefined, 'production');
    mockEligibleConstants();
    mockDevice(true);
    const Notifications = getNotifications();
    Notifications.getPermissionsAsync = jest.fn().mockResolvedValue({ status: 'granted' });
    Notifications.getExpoPushTokenAsync = jest.fn().mockResolvedValue({ data: 'ExponentPushToken[abc]' });
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    const { registerPushToken } = require('../pushTokens');

    await registerPushToken();

    expect(errorSpy).not.toHaveBeenCalled();
  });

  it('never throws when an unexpected error occurs mid-registration, and logs it (dev only)', async () => {
    const rpc = jest.fn();
    configureSupabase(rpc, undefined, 'development');
    mockEligibleConstants();
    mockDevice(true);
    const Notifications = getNotifications();
    Notifications.getPermissionsAsync = jest.fn().mockRejectedValue(new Error('permissions API exploded'));
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    const { registerPushToken } = require('../pushTokens');

    await expect(registerPushToken()).resolves.toBeUndefined();

    expect(errorSpy).toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
  });

  it('does not log an unexpected mid-registration error in production', async () => {
    const rpc = jest.fn();
    configureSupabase(rpc, undefined, 'production');
    mockEligibleConstants();
    mockDevice(true);
    const Notifications = getNotifications();
    Notifications.getPermissionsAsync = jest.fn().mockRejectedValue(new Error('permissions API exploded'));
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    const { registerPushToken } = require('../pushTokens');

    await expect(registerPushToken()).resolves.toBeUndefined();

    expect(errorSpy).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
  });
});

describe('sendRequestPush', () => {
  const payload = { requestId: 'req-1', kind: 'swap' as const, event: 'created' as const };

  beforeEach(() => {
    jest.resetModules();
  });

  afterEach(() => {
    process.env = ORIGINAL_ENV;
    jest.restoreAllMocks();
  });

  it('is a no-op in local/demo mode', async () => {
    configureSupabaseUnset();
    const { sendRequestPush } = require('../pushTokens');

    await expect(sendRequestPush(payload)).resolves.toBeUndefined();
  });

  it('invokes send-request-push with only the minimal trigger payload', async () => {
    const invoke = jest.fn().mockResolvedValue({ data: null, error: null });
    configureSupabase(jest.fn(), invoke);
    const { sendRequestPush } = require('../pushTokens');

    await sendRequestPush(payload);

    expect(invoke).toHaveBeenCalledWith('send-request-push', { body: payload });
  });

  it('never throws when the invoke call fails, and logs it (dev only)', async () => {
    const invoke = jest.fn().mockRejectedValue(new Error('function unavailable'));
    configureSupabase(jest.fn(), invoke, 'development');
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    const { sendRequestPush } = require('../pushTokens');

    await expect(sendRequestPush(payload)).resolves.toBeUndefined();

    expect(errorSpy).toHaveBeenCalled();
  });

  it('does not log an invoke failure in production', async () => {
    const invoke = jest.fn().mockRejectedValue(new Error('function unavailable'));
    configureSupabase(jest.fn(), invoke, 'production');
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    const { sendRequestPush } = require('../pushTokens');

    await sendRequestPush(payload);

    expect(errorSpy).not.toHaveBeenCalled();
  });
});
