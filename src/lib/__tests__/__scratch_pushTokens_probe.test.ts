const ORIGINAL_ENV = process.env;

jest.mock('expo-constants', () => ({
  executionEnvironment: 'standalone',
  expoConfig: { extra: { eas: { projectId: 'test-project-id' } } },
}));
jest.mock('expo-device', () => ({ isDevice: true }));

describe('scratch probe', () => {
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
  });

  it('registerPushToken reaches permission check with mocked native modules', async () => {
    const rpc = jest.fn().mockResolvedValue({ error: null });
    jest.doMock('@supabase/supabase-js', () => ({
      createClient: jest.fn(() => ({
        auth: { getSession: jest.fn(), signInAnonymously: jest.fn() },
        rpc,
        from: jest.fn(),
        storage: { from: jest.fn() },
      })),
    }));
    const Notifications = require('expo-notifications');
    Notifications.getPermissionsAsync = jest.fn().mockResolvedValue({ status: 'granted' });
    Notifications.requestPermissionsAsync = jest.fn().mockResolvedValue({ status: 'granted' });
    Notifications.getExpoPushTokenAsync = jest.fn().mockResolvedValue({ data: 'ExponentPushToken[abc]' });
    const { registerPushToken, getExpoPushTokenIfKnown } = require('../pushTokens');
    await registerPushToken();
    console.log('TOKEN AFTER REGISTER:', getExpoPushTokenIfKnown());
    console.log('RPC CALLS:', JSON.stringify(rpc.mock.calls));
  });
});
