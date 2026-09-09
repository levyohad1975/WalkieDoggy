import { Platform } from 'react-native';

const ORIGINAL_ENV = process.env;
const originalPlatformOS = Platform.OS;

function setPlatformOS(os: typeof Platform.OS) {
  Object.defineProperty(Platform, 'OS', { value: os, configurable: true, writable: true });
}

function mockSupabaseClient(rpc: jest.Mock) {
  jest.doMock('@supabase/supabase-js', () => ({
    createClient: jest.fn(() => ({
      auth: {
        getSession: jest.fn().mockResolvedValue({ data: { session: null } }),
        signInAnonymously: jest.fn().mockResolvedValue({ error: null }),
      },
      rpc,
      from: jest.fn(),
      storage: { from: jest.fn() },
    })),
  }));
}

/**
 * Batch 2 review correction: has_active_remote_push_channel() moved from a
 * profile-wide question (no arguments — "does this profile have any active
 * channel on any device") to a device-specific one (this device's own Expo
 * token / Web Push endpoint passed as parameters — see migration 0025 Part
 * 5 and this file's own doc comment for the full policy). These tests
 * cover the client-side half of that fix: that this device's own known
 * identifiers are what gets sent, that a device with neither identifier
 * never even makes the network call (and so can never be fooled by another
 * device's channel), and that the cache key tracks those identifiers so a
 * newly-registered channel is picked up without any explicit invalidation
 * call.
 */
describe('lib/remoteReminderChannel — device-specific channel selection', () => {
  beforeEach(() => {
    jest.resetModules();
    process.env = {
      ...ORIGINAL_ENV,
      EXPO_PUBLIC_SUPABASE_URL: 'https://example.supabase.co',
      EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'anon-key',
    };
  });

  afterEach(() => {
    process.env = ORIGINAL_ENV;
    setPlatformOS(originalPlatformOS);
  });

  it('never calls the RPC when this device has neither an Expo token nor a Web Push endpoint', async () => {
    setPlatformOS('ios');
    const rpc = jest.fn().mockResolvedValue({ data: true, error: null });
    mockSupabaseClient(rpc);
    jest.doMock('../pushTokens', () => ({ getExpoPushTokenIfKnown: jest.fn(() => null) }));
    jest.doMock('../webPush', () => ({ getCurrentWebPushEndpoint: jest.fn().mockResolvedValue(null) }));

    const { hasActiveRemoteReminderChannel } = require('../remoteReminderChannel');
    const result = await hasActiveRemoteReminderChannel();

    expect(result).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
  });

  it('passes this device own Expo token to the RPC on a native platform, never a Web Push endpoint', async () => {
    setPlatformOS('ios');
    const rpc = jest.fn().mockResolvedValue({ data: true, error: null });
    mockSupabaseClient(rpc);
    jest.doMock('../pushTokens', () => ({ getExpoPushTokenIfKnown: jest.fn(() => 'ExponentPushToken[device-a]') }));
    const getCurrentWebPushEndpoint = jest.fn().mockResolvedValue('should-not-be-used');
    jest.doMock('../webPush', () => ({ getCurrentWebPushEndpoint }));

    const { hasActiveRemoteReminderChannel } = require('../remoteReminderChannel');
    const result = await hasActiveRemoteReminderChannel();

    expect(result).toBe(true);
    expect(rpc).toHaveBeenCalledWith('has_active_remote_push_channel', {
      p_expo_token: 'ExponentPushToken[device-a]',
      p_web_push_endpoint: null,
    });
    // Non-web platforms never even ask for a Web Push endpoint.
    expect(getCurrentWebPushEndpoint).not.toHaveBeenCalled();
  });

  it('passes this device own Web Push endpoint to the RPC on web', async () => {
    setPlatformOS('web');
    const rpc = jest.fn().mockResolvedValue({ data: false, error: null });
    mockSupabaseClient(rpc);
    jest.doMock('../pushTokens', () => ({ getExpoPushTokenIfKnown: jest.fn(() => null) }));
    jest.doMock('../webPush', () => ({
      getCurrentWebPushEndpoint: jest.fn().mockResolvedValue('https://fcm.googleapis.com/device-b'),
    }));

    const { hasActiveRemoteReminderChannel } = require('../remoteReminderChannel');
    const result = await hasActiveRemoteReminderChannel();

    expect(result).toBe(false);
    expect(rpc).toHaveBeenCalledWith('has_active_remote_push_channel', {
      p_expo_token: null,
      p_web_push_endpoint: 'https://fcm.googleapis.com/device-b',
    });
  });

  it('does NOT report true for a device with no channel of its own just because it shares a profile with a device that has one — the RPC is only ever asked about THIS device identifiers', async () => {
    // Simulates Device B: no Expo token, no Web Push endpoint known locally.
    // Device A (a different device on the same profile) having an active
    // channel server-side is irrelevant here because the RPC never receives
    // Device A's identifiers from Device B's process at all.
    setPlatformOS('ios');
    const rpc = jest.fn().mockResolvedValue({ data: true, error: null }); // even if the server would say "profile has a channel"
    mockSupabaseClient(rpc);
    jest.doMock('../pushTokens', () => ({ getExpoPushTokenIfKnown: jest.fn(() => null) }));
    jest.doMock('../webPush', () => ({ getCurrentWebPushEndpoint: jest.fn().mockResolvedValue(null) }));

    const { hasActiveRemoteReminderChannel } = require('../remoteReminderChannel');
    const result = await hasActiveRemoteReminderChannel();

    expect(result).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
  });

  it('caches by (token, endpoint) key so a repeat call with the same identifiers is served from cache', async () => {
    setPlatformOS('ios');
    const rpc = jest.fn().mockResolvedValue({ data: true, error: null });
    mockSupabaseClient(rpc);
    jest.doMock('../pushTokens', () => ({ getExpoPushTokenIfKnown: jest.fn(() => 'token-1') }));
    jest.doMock('../webPush', () => ({ getCurrentWebPushEndpoint: jest.fn().mockResolvedValue(null) }));

    const { hasActiveRemoteReminderChannel } = require('../remoteReminderChannel');
    await hasActiveRemoteReminderChannel();
    await hasActiveRemoteReminderChannel();

    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it('does not reuse the cache once this device own known token changes — no explicit invalidation call needed', async () => {
    setPlatformOS('ios');
    const rpc = jest.fn().mockResolvedValue({ data: true, error: null });
    mockSupabaseClient(rpc);
    const getExpoPushTokenIfKnown = jest.fn();
    getExpoPushTokenIfKnown.mockReturnValueOnce(null).mockReturnValue('newly-registered-token');
    jest.doMock('../pushTokens', () => ({ getExpoPushTokenIfKnown }));
    jest.doMock('../webPush', () => ({ getCurrentWebPushEndpoint: jest.fn().mockResolvedValue(null) }));

    const { hasActiveRemoteReminderChannel } = require('../remoteReminderChannel');

    // First call: no token known yet at all — short-circuits, no RPC call.
    const first = await hasActiveRemoteReminderChannel();
    expect(first).toBe(false);
    expect(rpc).not.toHaveBeenCalled();

    // registerPushToken() completes elsewhere in the app; this device now
    // has a token. The cache key changes, so the new identifier is used
    // immediately rather than waiting out the TTL or requiring an explicit
    // invalidate call (which no longer exists on this module).
    const second = await hasActiveRemoteReminderChannel();
    expect(second).toBe(true);
    expect(rpc).toHaveBeenCalledWith('has_active_remote_push_channel', {
      p_expo_token: 'newly-registered-token',
      p_web_push_endpoint: null,
    });
  });

  it('resolves false (not throwing) when the RPC call itself errors', async () => {
    setPlatformOS('ios');
    const rpc = jest.fn().mockResolvedValue({ data: null, error: { message: 'boom' } });
    mockSupabaseClient(rpc);
    jest.doMock('../pushTokens', () => ({ getExpoPushTokenIfKnown: jest.fn(() => 'token-x') }));
    jest.doMock('../webPush', () => ({ getCurrentWebPushEndpoint: jest.fn().mockResolvedValue(null) }));

    const { hasActiveRemoteReminderChannel } = require('../remoteReminderChannel');
    await expect(hasActiveRemoteReminderChannel()).resolves.toBe(false);
  });

  it('resolves false without a network call in local/demo mode (no Supabase configured)', async () => {
    setPlatformOS('ios');
    process.env = { ...ORIGINAL_ENV, EXPO_PUBLIC_SUPABASE_URL: '', EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY: '' };
    const rpc = jest.fn();
    mockSupabaseClient(rpc);
    jest.doMock('../pushTokens', () => ({ getExpoPushTokenIfKnown: jest.fn(() => 'token-x') }));
    jest.doMock('../webPush', () => ({ getCurrentWebPushEndpoint: jest.fn().mockResolvedValue(null) }));

    const { hasActiveRemoteReminderChannel } = require('../remoteReminderChannel');
    await expect(hasActiveRemoteReminderChannel()).resolves.toBe(false);
    expect(rpc).not.toHaveBeenCalled();
  });
});
