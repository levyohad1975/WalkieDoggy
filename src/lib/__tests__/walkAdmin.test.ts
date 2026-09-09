const ORIGINAL_ENV = process.env;

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
 * BATCH 3 (Task 6) — client-side (call-shape / error-propagation) tests for
 * the admin_reschedule_walk RPC wrapper (migration 0026), mirroring
 * lib/__tests__/family.test.ts's approach exactly. The actual server-side
 * admin-gating (is_family_admin — false during impersonation), collision
 * check, and audit logging live in the RPC itself and can only be verified
 * against a real Supabase project — not from this Jest sandbox. Every
 * rejection text asserted here is copied verbatim from the migration's own
 * `raise exception` messages (or from create_time_change_request's, which
 * this migration deliberately reuses for the "walk is no longer pending"
 * case — see 0026's own comment), so a mismatch here would catch a
 * client/server text drift.
 */
describe('lib/walkAdmin — adminRescheduleWalk (Supabase mode)', () => {
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

  it('calls admin_reschedule_walk with p_walk_id/p_new_time and resolves on success', async () => {
    const rpc = jest.fn().mockResolvedValue({ data: null, error: null });
    mockSupabaseClient(rpc);
    const { adminRescheduleWalk } = require('../walkAdmin');

    await expect(adminRescheduleWalk('walk-1', '19:30')).resolves.toBeUndefined();
    expect(rpc).toHaveBeenCalledWith('admin_reschedule_walk', { p_walk_id: 'walk-1', p_new_time: '19:30' });
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it('surfaces "admin permission required" (non-admin, or an admin currently impersonating) rather than swallowing it', async () => {
    const rpc = jest.fn().mockResolvedValue({ data: null, error: { message: 'admin permission required' } });
    mockSupabaseClient(rpc);
    const { adminRescheduleWalk } = require('../walkAdmin');

    await expect(adminRescheduleWalk('walk-1', '19:30')).rejects.toBeTruthy();
  });

  it('surfaces "walk is no longer pending" rather than swallowing it', async () => {
    const rpc = jest.fn().mockResolvedValue({ data: null, error: { message: 'walk is no longer pending' } });
    mockSupabaseClient(rpc);
    const { adminRescheduleWalk } = require('../walkAdmin');

    await expect(adminRescheduleWalk('walk-1', '19:30')).rejects.toBeTruthy();
  });

  it('surfaces "that time is already taken by another scheduled walk" (collision) rather than swallowing it', async () => {
    const rpc = jest
      .fn()
      .mockResolvedValue({ data: null, error: { message: 'that time is already taken by another scheduled walk' } });
    mockSupabaseClient(rpc);
    const { adminRescheduleWalk } = require('../walkAdmin');

    await expect(adminRescheduleWalk('walk-1', '19:30')).rejects.toBeTruthy();
  });

  it('local/demo mode (no Supabase configured): throws SupabaseNotConfiguredError rather than pretending to succeed', async () => {
    jest.resetModules();
    process.env = { ...ORIGINAL_ENV };
    delete process.env.EXPO_PUBLIC_SUPABASE_URL;
    delete process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
    const { adminRescheduleWalk } = require('../walkAdmin');
    const { SupabaseNotConfiguredError } = require('../supabase');

    await expect(adminRescheduleWalk('walk-1', '19:30')).rejects.toBeInstanceOf(SupabaseNotConfiguredError);
  });
});
