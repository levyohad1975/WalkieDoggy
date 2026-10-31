const ORIGINAL_ENV = process.env;

describe('lib/supabase — numeric email OTP client configuration', () => {
  beforeEach(() => {
    jest.resetModules();
    process.env = {
      ...ORIGINAL_ENV,
      EXPO_PUBLIC_SUPABASE_URL: 'https://example.supabase.co',
      EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'publishable-key',
    };
  });

  afterEach(() => {
    process.env = ORIGINAL_ENV;
  });

  it('uses the implicit flow so an iOS OTP request does not depend on PKCE storage before /otp', () => {
    const createClient = jest.fn(() => ({
      auth: {
        getSession: jest.fn(),
        signInAnonymously: jest.fn(),
        onAuthStateChange: jest.fn(),
      },
      rpc: jest.fn(),
      from: jest.fn(),
      storage: { from: jest.fn() },
    }));
    jest.doMock('@supabase/supabase-js', () => ({ createClient }));

    require('../supabase');

    expect(createClient).toHaveBeenCalledWith(
      'https://example.supabase.co',
      'publishable-key',
      expect.objectContaining({
        auth: expect.objectContaining({
          flowType: 'implicit',
          detectSessionInUrl: false,
        }),
      })
    );
  });
});
