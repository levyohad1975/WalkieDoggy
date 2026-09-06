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
 * Client-side (call-shape / error-propagation) tests for the migration-0005
 * RPC wrappers — mirrors lib/__tests__/supabaseFamily.test.ts's approach.
 * These cannot verify the actual server-side RLS/authorization/atomicity
 * (that's covered by supabase/manual_tests/0005_requests_audit_presence_acl.sql
 * against a real Supabase project) — only that the client sends the right
 * RPC name and params, and propagates a server error rather than swallowing it.
 */
describe('lib/requests — Supabase mode', () => {
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

  it('createSwapRequest calls create_swap_request with p_walk_id/p_target_walk_id and returns the new id', async () => {
    const rpc = jest.fn().mockResolvedValue({ data: 'req-1', error: null });
    mockSupabaseClient(rpc);
    const { createSwapRequest } = require('../requests');

    const id = await createSwapRequest('walk-1', 'walk-2');

    expect(rpc).toHaveBeenCalledWith('create_swap_request', { p_walk_id: 'walk-1', p_target_walk_id: 'walk-2' });
    expect(id).toBe('req-1');
  });

  it('a server rejection (e.g. self-approval) propagates as a thrown error, not a swallowed failure', async () => {
    const rpc = jest.fn().mockResolvedValue({ data: null, error: { message: 'only the requested member can approve this swap' } });
    mockSupabaseClient(rpc);
    const { approveSwapRequest } = require('../requests');

    await expect(approveSwapRequest('req-1')).rejects.toEqual({ message: 'only the requested member can approve this swap' });
  });

  it('rejectSwapRequest calls reject_swap_request with p_request_id', async () => {
    const rpc = jest.fn().mockResolvedValue({ data: null, error: null });
    mockSupabaseClient(rpc);
    const { rejectSwapRequest } = require('../requests');

    await rejectSwapRequest('req-9');

    expect(rpc).toHaveBeenCalledWith('reject_swap_request', { p_request_id: 'req-9' });
  });

  it('createTimeChangeRequest calls create_time_change_request with p_walk_id/p_proposed_time', async () => {
    const rpc = jest.fn().mockResolvedValue({ data: 'req-2', error: null });
    mockSupabaseClient(rpc);
    const { createTimeChangeRequest } = require('../requests');

    const id = await createTimeChangeRequest('walk-3', '19:30');

    expect(rpc).toHaveBeenCalledWith('create_time_change_request', { p_walk_id: 'walk-3', p_proposed_time: '19:30' });
    expect(id).toBe('req-2');
  });

  it('approveTimeChangeRequest / rejectTimeChangeRequest call the right RPC with p_request_id', async () => {
    const rpc = jest.fn().mockResolvedValue({ data: null, error: null });
    mockSupabaseClient(rpc);
    const { approveTimeChangeRequest, rejectTimeChangeRequest } = require('../requests');

    await approveTimeChangeRequest('req-4');
    expect(rpc).toHaveBeenCalledWith('approve_time_change_request', { p_request_id: 'req-4' });

    await rejectTimeChangeRequest('req-5');
    expect(rpc).toHaveBeenCalledWith('reject_time_change_request', { p_request_id: 'req-5' });
  });

  it('adminListFamilyActivity/adminListAuditLog call their RPCs and return the rows', async () => {
    const rpc = jest
      .fn()
      .mockResolvedValueOnce({ data: [{ user_id: 'u1', name: 'א', avatar: '🐶', role: 'admin', removed_at: null, last_seen_at: null }], error: null })
      .mockResolvedValueOnce({ data: [{ id: 'log-1', actor_user_id: 'u1', actor_name: 'א', action: 'profile_edited', target_type: null, target_id: null, metadata: {}, created_at: '2026-01-01T00:00:00Z' }], error: null });
    mockSupabaseClient(rpc);
    const { adminListFamilyActivity, adminListAuditLog } = require('../requests');

    const activity = await adminListFamilyActivity();
    expect(rpc).toHaveBeenCalledWith('admin_list_family_activity');
    expect(activity).toHaveLength(1);

    const log = await adminListAuditLog(25, 10);
    expect(rpc).toHaveBeenCalledWith('admin_list_audit_log', { p_limit: 25, p_offset: 10 });
    expect(log).toHaveLength(1);
  });

  it('touchLastSeen calls touch_last_seen with no params', async () => {
    const rpc = jest.fn().mockResolvedValue({ data: null, error: null });
    mockSupabaseClient(rpc);
    const { touchLastSeen } = require('../requests');

    await touchLastSeen();

    expect(rpc).toHaveBeenCalledWith('touch_last_seen');
  });

  it('listSwapRequests/listTimeChangeRequests select from the right table, ordered by created_at desc', async () => {
    const order = jest.fn().mockResolvedValue({ data: [], error: null });
    const select = jest.fn(() => ({ order }));
    const from = jest.fn(() => ({ select }));
    mockSupabaseClient(jest.fn(), from);
    const { listSwapRequests, listTimeChangeRequests } = require('../requests');

    await listSwapRequests();
    expect(from).toHaveBeenCalledWith('walk_swap_requests');
    expect(order).toHaveBeenCalledWith('created_at', { ascending: false });

    await listTimeChangeRequests();
    expect(from).toHaveBeenCalledWith('time_change_requests');
  });
});

describe('lib/requests — local/demo mode (no Supabase configured)', () => {
  beforeEach(() => {
    jest.resetModules();
    process.env = { ...ORIGINAL_ENV };
    delete process.env.EXPO_PUBLIC_SUPABASE_URL;
    delete process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  });

  afterEach(() => {
    process.env = ORIGINAL_ENV;
  });

  it('every approval-workflow call throws SupabaseNotConfiguredError rather than silently no-op-ing', async () => {
    const { createSwapRequest, approveSwapRequest, createTimeChangeRequest, adminListFamilyActivity, adminListAuditLog, SupabaseNotConfiguredError } = {
      ...require('../requests'),
      SupabaseNotConfiguredError: require('../supabase').SupabaseNotConfiguredError,
    };

    await expect(createSwapRequest('w', 'target-w')).rejects.toBeInstanceOf(SupabaseNotConfiguredError);
    await expect(approveSwapRequest('r')).rejects.toBeInstanceOf(SupabaseNotConfiguredError);
    await expect(createTimeChangeRequest('w', '10:00')).rejects.toBeInstanceOf(SupabaseNotConfiguredError);
    await expect(adminListFamilyActivity()).rejects.toBeInstanceOf(SupabaseNotConfiguredError);
    await expect(adminListAuditLog()).rejects.toBeInstanceOf(SupabaseNotConfiguredError);
  });

  it('touchLastSeen is a harmless no-op in local/demo mode (presence is a nice-to-have, not a hard requirement)', async () => {
    const { touchLastSeen } = require('../requests');
    await expect(touchLastSeen()).resolves.toBeUndefined();
  });
});
