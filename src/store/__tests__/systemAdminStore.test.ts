const ORIGINAL_ENV = process.env;

// systemAdminStore imports lib/supabase (for isSupabaseConfigured), which
// calls @supabase/supabase-js's createClient() unconditionally at module
// load whenever the env vars are present — mocked here (same pattern as
// lib/__tests__/invites.test.ts's mockSupabaseClient) purely so requiring
// the store in "Supabase mode" doesn't depend on the real package's
// construction behavior. lib/systemAdmin itself is mocked separately below
// per test, so this mock's `rpc` is never actually invoked.
function mockSupabaseJs() {
  jest.doMock('@supabase/supabase-js', () => ({
    createClient: jest.fn(() => ({
      auth: {
        getSession: jest.fn().mockResolvedValue({ data: { session: null } }),
        signInAnonymously: jest.fn().mockResolvedValue({ error: null }),
      },
      rpc: jest.fn(),
      from: jest.fn(),
      storage: { from: jest.fn() },
    })),
  }));
}

/**
 * BATCH 4 (item A — System Admin V1). Direct behavioral tests of
 * useSystemAdminStore: fails closed on any error (never shows the entry
 * point on an ambiguous/failed check), and is unconditionally false in
 * local/demo mode regardless of what checkIsSystemAdmin() would return.
 */
describe('store/systemAdminStore — useSystemAdminStore', () => {
  beforeEach(() => {
    jest.resetModules();
  });

  afterEach(() => {
    process.env = ORIGINAL_ENV;
  });

  it('refresh() sets isSystemAdmin true when checkIsSystemAdmin() resolves true (Supabase mode)', async () => {
    process.env = { ...ORIGINAL_ENV, EXPO_PUBLIC_SUPABASE_URL: 'https://example.supabase.co', EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'anon-key' };
    mockSupabaseJs();
    jest.doMock('../../lib/systemAdmin', () => ({ checkIsSystemAdmin: jest.fn().mockResolvedValue(true) }));
    const { useSystemAdminStore } = require('../systemAdminStore');

    await useSystemAdminStore.getState().refresh();
    expect(useSystemAdminStore.getState().isSystemAdmin).toBe(true);
    expect(useSystemAdminStore.getState().checked).toBe(true);
  });

  it('refresh() sets isSystemAdmin false when checkIsSystemAdmin() resolves false', async () => {
    process.env = { ...ORIGINAL_ENV, EXPO_PUBLIC_SUPABASE_URL: 'https://example.supabase.co', EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'anon-key' };
    mockSupabaseJs();
    jest.doMock('../../lib/systemAdmin', () => ({ checkIsSystemAdmin: jest.fn().mockResolvedValue(false) }));
    const { useSystemAdminStore } = require('../systemAdminStore');

    await useSystemAdminStore.getState().refresh();
    expect(useSystemAdminStore.getState().isSystemAdmin).toBe(false);
  });

  it('FAILS CLOSED: a rejected checkIsSystemAdmin() call never leaves isSystemAdmin true — the entry point must never show on an ambiguous/errored check', async () => {
    process.env = { ...ORIGINAL_ENV, EXPO_PUBLIC_SUPABASE_URL: 'https://example.supabase.co', EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'anon-key' };
    mockSupabaseJs();
    jest.doMock('../../lib/systemAdmin', () => ({ checkIsSystemAdmin: jest.fn().mockRejectedValue(new Error('network error')) }));
    const { useSystemAdminStore } = require('../systemAdminStore');

    await useSystemAdminStore.getState().refresh();
    expect(useSystemAdminStore.getState().isSystemAdmin).toBe(false);
    expect(useSystemAdminStore.getState().checked).toBe(true);
  });

  it('local/demo mode (no Supabase configured): always false, and never even calls checkIsSystemAdmin()', async () => {
    process.env = { ...ORIGINAL_ENV };
    delete process.env.EXPO_PUBLIC_SUPABASE_URL;
    delete process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
    const checkIsSystemAdmin = jest.fn().mockResolvedValue(true);
    jest.doMock('../../lib/systemAdmin', () => ({ checkIsSystemAdmin }));
    const { useSystemAdminStore } = require('../systemAdminStore');

    await useSystemAdminStore.getState().refresh();
    expect(useSystemAdminStore.getState().isSystemAdmin).toBe(false);
    expect(checkIsSystemAdmin).not.toHaveBeenCalled();
  });

  it('refresh() re-entrancy guard: a second concurrent call while the first is still in flight does not call checkIsSystemAdmin() again', async () => {
    process.env = { ...ORIGINAL_ENV, EXPO_PUBLIC_SUPABASE_URL: 'https://example.supabase.co', EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'anon-key' };
    mockSupabaseJs();
    let resolveCheck: (value: boolean) => void = () => {};
    const checkIsSystemAdmin = jest.fn(() => new Promise<boolean>((resolve) => { resolveCheck = resolve; }));
    jest.doMock('../../lib/systemAdmin', () => ({ checkIsSystemAdmin }));
    const { useSystemAdminStore } = require('../systemAdminStore');

    const firstCall = useSystemAdminStore.getState().refresh();
    expect(useSystemAdminStore.getState().checking).toBe(true);

    const secondCall = useSystemAdminStore.getState().refresh();
    expect(checkIsSystemAdmin).toHaveBeenCalledTimes(1);

    resolveCheck(true);
    await Promise.all([firstCall, secondCall]);

    expect(checkIsSystemAdmin).toHaveBeenCalledTimes(1);
    expect(useSystemAdminStore.getState().isSystemAdmin).toBe(true);
    expect(useSystemAdminStore.getState().checking).toBe(false);
  });

  it('reset() returns to the initial unchecked state', async () => {
    process.env = { ...ORIGINAL_ENV, EXPO_PUBLIC_SUPABASE_URL: 'https://example.supabase.co', EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'anon-key' };
    mockSupabaseJs();
    jest.doMock('../../lib/systemAdmin', () => ({ checkIsSystemAdmin: jest.fn().mockResolvedValue(true) }));
    const { useSystemAdminStore } = require('../systemAdminStore');

    await useSystemAdminStore.getState().refresh();
    expect(useSystemAdminStore.getState().isSystemAdmin).toBe(true);

    useSystemAdminStore.getState().reset();
    expect(useSystemAdminStore.getState().isSystemAdmin).toBe(false);
    expect(useSystemAdminStore.getState().checked).toBe(false);
  });
});
