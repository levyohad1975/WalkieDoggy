const ORIGINAL_ENV = process.env;

function mockSupabaseClient(rpc: jest.Mock, from: jest.Mock = jest.fn()) {
  jest.doMock('@supabase/supabase-js', () => ({
    createClient: jest.fn(() => ({
      auth: {
        getSession: jest.fn().mockResolvedValue({ data: { session: null } }),
        signInAnonymously: jest.fn().mockResolvedValue({ error: null }),
      },
      rpc,
      from,
      storage: { from: jest.fn() },
    })),
  }));
}

/**
 * Client-side (call-shape / error-propagation) tests for the migration-0023
 * member-permission-override RPC wrappers and raw select — mirrors
 * lib/__tests__/family.test.ts's / requests.test.ts's approach exactly.
 * These cannot verify the actual server-side admin-gating/RLS (that's the
 * job of a real-Supabase manual test, same caveat as those two files) —
 * only that the client sends the right RPC name/params or select shape,
 * and propagates a server error rather than swallowing it.
 */
describe('lib/permissions — Supabase mode', () => {
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

  it('setMemberPermissionOverride calls set_member_permission_override with the right params and resolves on success', async () => {
    const rpc = jest.fn().mockResolvedValue({ data: null, error: null });
    mockSupabaseClient(rpc);
    const { setMemberPermissionOverride } = require('../permissions');

    await expect(setMemberPermissionOverride('user-1', 'view_history', false)).resolves.toBeUndefined();
    expect(rpc).toHaveBeenCalledWith('set_member_permission_override', {
      p_user_id: 'user-1',
      p_permission_key: 'view_history',
      p_allowed: false,
    });
  });

  it('setMemberPermissionOverride surfaces "admin permission required" rather than swallowing it', async () => {
    const rpc = jest.fn().mockResolvedValue({ data: null, error: { message: 'admin permission required' } });
    mockSupabaseClient(rpc);
    const { setMemberPermissionOverride } = require('../permissions');

    await expect(setMemberPermissionOverride('user-1', 'view_statistics', true)).rejects.toBeTruthy();
  });

  it('clearMemberPermissionOverride calls clear_member_permission_override with the right params and resolves on success', async () => {
    const rpc = jest.fn().mockResolvedValue({ data: null, error: null });
    mockSupabaseClient(rpc);
    const { clearMemberPermissionOverride } = require('../permissions');

    await expect(clearMemberPermissionOverride('user-1', 'view_history')).resolves.toBeUndefined();
    expect(rpc).toHaveBeenCalledWith('clear_member_permission_override', {
      p_user_id: 'user-1',
      p_permission_key: 'view_history',
    });
  });

  it('clearMemberPermissionOverride surfaces a server rejection rather than swallowing it', async () => {
    const rpc = jest.fn().mockResolvedValue({ data: null, error: { message: 'admin permission required' } });
    mockSupabaseClient(rpc);
    const { clearMemberPermissionOverride } = require('../permissions');

    await expect(clearMemberPermissionOverride('user-1', 'view_history')).rejects.toBeTruthy();
  });

  it('listMemberPermissionOverrides selects from member_permission_overrides and maps rows to camelCase', async () => {
    const select = jest.fn().mockResolvedValue({
      data: [
        { user_id: 'user-1', permission_key: 'view_history', allowed: false },
        { user_id: 'user-2', permission_key: 'view_statistics', allowed: true },
      ],
      error: null,
    });
    const from = jest.fn(() => ({ select }));
    mockSupabaseClient(jest.fn(), from);
    const { listMemberPermissionOverrides } = require('../permissions');

    const result = await listMemberPermissionOverrides();

    expect(from).toHaveBeenCalledWith('member_permission_overrides');
    expect(select).toHaveBeenCalledWith('user_id, permission_key, allowed');
    expect(result).toEqual([
      { userId: 'user-1', permissionKey: 'view_history', allowed: false },
      { userId: 'user-2', permissionKey: 'view_statistics', allowed: true },
    ]);
  });

  it('listMemberPermissionOverrides defaults to an empty array when the select succeeds with a null data payload', async () => {
    const select = jest.fn().mockResolvedValue({ data: null, error: null });
    const from = jest.fn(() => ({ select }));
    mockSupabaseClient(jest.fn(), from);
    const { listMemberPermissionOverrides } = require('../permissions');

    await expect(listMemberPermissionOverrides()).resolves.toEqual([]);
  });

  it('listMemberPermissionOverrides propagates a select error rather than swallowing it', async () => {
    const select = jest.fn().mockResolvedValue({ data: null, error: { message: 'boom' } });
    const from = jest.fn(() => ({ select }));
    mockSupabaseClient(jest.fn(), from);
    const { listMemberPermissionOverrides } = require('../permissions');

    await expect(listMemberPermissionOverrides()).rejects.toBeTruthy();
  });

  it('local/demo mode (no Supabase configured): every function throws SupabaseNotConfiguredError rather than pretending to succeed', async () => {
    jest.resetModules();
    process.env = { ...ORIGINAL_ENV };
    delete process.env.EXPO_PUBLIC_SUPABASE_URL;
    delete process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
    const { setMemberPermissionOverride, clearMemberPermissionOverride, listMemberPermissionOverrides } = require('../permissions');
    const { SupabaseNotConfiguredError } = require('../supabase');

    await expect(setMemberPermissionOverride('user-1', 'view_history', true)).rejects.toBeInstanceOf(SupabaseNotConfiguredError);
    await expect(clearMemberPermissionOverride('user-1', 'view_history')).rejects.toBeInstanceOf(SupabaseNotConfiguredError);
    await expect(listMemberPermissionOverrides()).rejects.toBeInstanceOf(SupabaseNotConfiguredError);
  });
});
