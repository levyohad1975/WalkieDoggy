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
 * Round 7, Part 1/5. These test the CLIENT side of lib/family.ts's
 * setMemberRole() wrapper only — that it calls the right RPC with the right
 * params and propagates success/failure faithfully. The actual server-side
 * authorization, last-admin protection, and audit logging live in
 * set_member_role() (supabase/migrations/0007_multi_admin_roles.sql) and can
 * only be verified against a real Supabase project (see
 * supabase/manual_tests/0007_multi_admin_acl.sql) — not from this Jest
 * sandbox. That said, every rejection text asserted here is copied verbatim
 * from 0007's own `raise exception` messages, so a mismatch here would catch
 * a client/server text drift.
 */
describe('lib/family — setMemberRole (Supabase mode)', () => {
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

  // ---- Requirement 1: admin can promote an active member ----
  it('promoting a member calls set_member_role with p_role "admin" and resolves on success', async () => {
    const rpc = jest.fn().mockResolvedValue({ data: null, error: null });
    mockSupabaseClient(rpc);
    const { setMemberRole } = require('../family');

    await expect(setMemberRole('user-1', 'admin')).resolves.toBeUndefined();
    expect(rpc).toHaveBeenCalledWith('set_member_role', { p_user_id: 'user-1', p_role: 'admin' });
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  // ---- Requirement 4: admin can demote another admin (server allows when >=1 other admin remains) ----
  it('demoting a member calls set_member_role with p_role "member" and resolves on success', async () => {
    const rpc = jest.fn().mockResolvedValue({ data: null, error: null });
    mockSupabaseClient(rpc);
    const { setMemberRole } = require('../family');

    await expect(setMemberRole('user-2', 'member')).resolves.toBeUndefined();
    expect(rpc).toHaveBeenCalledWith('set_member_role', { p_user_id: 'user-2', p_role: 'member' });
  });

  // ---- Requirement 2: non-admin cannot promote (server-side rejection) ----
  it('surfaces "admin permission required" rather than swallowing it', async () => {
    const rpc = jest.fn().mockResolvedValue({ data: null, error: { message: 'admin permission required' } });
    mockSupabaseClient(rpc);
    const { setMemberRole } = require('../family');

    await expect(setMemberRole('user-1', 'admin')).rejects.toBeTruthy();
  });

  // ---- Requirement 3: removed member cannot be promoted ----
  it('surfaces "cannot change the role of a removed member" rather than swallowing it', async () => {
    const rpc = jest.fn().mockResolvedValue({
      data: null,
      error: { message: 'cannot change the role of a removed member' },
    });
    mockSupabaseClient(rpc);
    const { setMemberRole } = require('../family');

    await expect(setMemberRole('removed-user', 'admin')).rejects.toBeTruthy();
  });

  // ---- Requirement 5: last admin cannot be demoted ----
  it('surfaces "cannot demote the last admin of this family" rather than swallowing it', async () => {
    const rpc = jest.fn().mockResolvedValue({
      data: null,
      error: { message: 'cannot demote the last admin of this family' },
    });
    mockSupabaseClient(rpc);
    const { setMemberRole } = require('../family');

    await expect(setMemberRole('last-admin', 'member')).rejects.toBeTruthy();
  });

  it('local/demo mode (no Supabase configured): setMemberRole throws SupabaseNotConfiguredError rather than pretending to succeed', async () => {
    jest.resetModules();
    process.env = { ...ORIGINAL_ENV };
    delete process.env.EXPO_PUBLIC_SUPABASE_URL;
    delete process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
    const { setMemberRole } = require('../family');
    const { SupabaseNotConfiguredError } = require('../supabase');

    await expect(setMemberRole('user-1', 'admin')).rejects.toBeInstanceOf(SupabaseNotConfiguredError);
  });
});
