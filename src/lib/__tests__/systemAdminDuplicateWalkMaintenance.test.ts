import fs from 'fs';
import path from 'path';

const ORIGINAL_ENV = process.env;

function mockSupabaseClient(rpc: jest.Mock) {
  jest.doMock('@supabase/supabase-js', () => ({
    createClient: jest.fn(() => ({
      auth: {
        getSession: jest.fn().mockResolvedValue({ data: { session: { access_token: 'test-token', user: { id: 'test-admin' } } } }),
        signInAnonymously: jest.fn().mockResolvedValue({ error: null }),
      },
      rpc,
      from: jest.fn(),
      storage: { from: jest.fn() },
    })),
  }));
}

/**
 * P0 Staging recovery (PR #150): the two test-generated active walks that
 * block Walk Lifecycle v1.1 belong to a family whose Family Admin is not
 * available, so resolve_duplicate_active_walks_v12() cannot be invoked
 * legitimately. A verified System Admin applies an owner-approved,
 * single-use server authorization instead. Server enforcement is rehearsed
 * in supabase/manual_tests/system_admin_duplicate_walk_repair_v12.sql; these
 * pin the client contract.
 */
describe('lib/systemAdmin — duplicate-walk maintenance', () => {
  beforeEach(async () => {
    jest.resetModules();
    process.env = { ...ORIGINAL_ENV, EXPO_PUBLIC_SUPABASE_URL: 'https://example.supabase.co', EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'anon-key' };
    jest.doMock('../../data', () => ({ repository: {} }));
    await require('@react-native-async-storage/async-storage').clear();
  });

  afterEach(() => {
    process.env = ORIGINAL_ENV;
  });

  it('lists authorizations through the System Admin RPC and maps every field', async () => {
    const rpc = jest.fn().mockResolvedValue({ data: [{
      authorization_id: 'a1', family_id: 'f806158f-eee9-4a6e-87be-72c4a3d64f75', family_name: 'לוי', dog_id: 'd1', dog_name: 'שוקי',
      walk_ids: ['088a73c5-0dd9-47fd-9bd1-fb44bc739eb3', '2a495898-6936-487c-8da9-5fcaeb3b0b60'], unresolved_active_count: 2,
      reason: 'r', expires_at: '2026-10-29T00:00:00Z', consumed_at: null, consumed_group_id: null,
    }], error: null });
    mockSupabaseClient(rpc);
    const { listDuplicateWalkMaintenanceAuthorizations } = require('../systemAdmin');
    const rows = await listDuplicateWalkMaintenanceAuthorizations();
    expect(rpc).toHaveBeenCalledWith('system_admin_list_duplicate_walk_authorizations');
    expect(rows).toEqual([expect.objectContaining({ authorizationId: 'a1', familyName: 'לוי', dogName: 'שוקי', unresolvedActiveCount: 2, consumedAt: null })]);
  });

  it('sends one stable UUID operation id, reused for a retry after a lost response', async () => {
    const rpc = jest.fn()
      .mockResolvedValueOnce({ data: null, error: { message: 'Failed to fetch' } })
      .mockResolvedValueOnce({ data: 'group-1', error: null });
    mockSupabaseClient(rpc);
    const { resolveDuplicateWalkMaintenanceAuthorization } = require('../systemAdmin');
    await expect(resolveDuplicateWalkMaintenanceAuthorization('a1')).rejects.toEqual({ message: 'Failed to fetch' });
    await expect(resolveDuplicateWalkMaintenanceAuthorization('a1')).resolves.toBe('group-1');
    const [first, second] = rpc.mock.calls.map((call: unknown[]) => call[1] as { p_authorization_id: string; p_operation_id: string });
    expect(rpc.mock.calls[0][0]).toBe('system_admin_resolve_authorized_duplicate_walks_v12');
    expect(first.p_authorization_id).toBe('a1');
    expect(first.p_operation_id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(second.p_operation_id).toBe(first.p_operation_id);
  });

  it('propagates a server refusal unchanged and never reports success', async () => {
    const refusal = { code: 'P0001', message: 'verified system admin required' };
    mockSupabaseClient(jest.fn().mockResolvedValue({ data: null, error: refusal }));
    const { resolveDuplicateWalkMaintenanceAuthorization } = require('../systemAdmin');
    await expect(resolveDuplicateWalkMaintenanceAuthorization('a1')).rejects.toBe(refusal);
  });
});

describe('System Admin duplicate-walk maintenance panel (structural)', () => {
  const screen = fs.readFileSync(path.join(__dirname, '..', '..', 'screens', 'SystemAdminScreen.tsx'), 'utf8');
  const panel = fs.readFileSync(path.join(__dirname, '..', '..', 'components', 'SystemAdminDuplicateWalkMaintenancePanel.tsx'), 'utf8');
  const migration = fs.readFileSync(path.join(__dirname, '..', '..', '..', 'supabase', 'migrations', '20261013073000_system_admin_duplicate_walk_repair_v12.sql'), 'utf8');

  it('renders only for a System Admin on the Staging walk-resolution build', () => {
    expect(screen).toContain('{isSystemAdmin && isWalkResolutionStaging ? <SystemAdminDuplicateWalkMaintenancePanel /> : null}');
  });

  it('requires an explicit second confirmation before the server call', () => {
    expect(panel).toContain("onPress={() => setConfirmId(item.authorizationId)}");
    expect(panel).toContain("label={busyId === item.authorizationId ? 'מסמנים…' : 'אישור סופי'}");
    expect(panel.indexOf('resolveDuplicateWalkMaintenanceAuthorization(item.authorizationId)')).toBeGreaterThan(-1);
  });

  it('is ordered before the v1.1 migration it unblocks, and never deletes walk data', () => {
    const migrations = fs.readdirSync(path.join(__dirname, '..', '..', '..', 'supabase', 'migrations')).sort();
    expect(migrations.indexOf('20261013073000_system_admin_duplicate_walk_repair_v12.sql'))
      .toBeLessThan(migrations.indexOf('20261013074334_walk_lifecycle_gps_v11.sql'));
    expect(migrations.indexOf('20261013070000_walk_duplicate_resolution_v12.sql'))
      .toBeLessThan(migrations.indexOf('20261013073000_system_admin_duplicate_walk_repair_v12.sql'));
    expect(migration).not.toMatch(/\bdelete\s+from\s+public\.walk/i);
    expect(migration).not.toMatch(/\bupdate\s+public\.walk_gps/i);
    expect(migration).toMatch(/update public\.walks set duplicate_resolution_group_id = v_group/);
  });
});
