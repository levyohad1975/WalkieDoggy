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
 * These test the CLIENT side of the invite-code feature only: that each
 * wrapper calls the right RPC with the right params and maps the response
 * correctly. They do NOT (and cannot, from this sandbox) verify the actual
 * RLS/SECURITY DEFINER behavior enforced by the SQL functions themselves —
 * that requires a real Supabase project. See the migration file
 * (0002_invite_codes_and_family_membership.sql) for that logic and its
 * rationale, and test it directly against a live project before relying on
 * it — "two devices land in the same family" and "family A can't read
 * family B" are database-enforced guarantees, not client-testable ones.
 */
describe('lib/supabase — family create/join/lookup (Supabase mode)', () => {
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

  it('findFamilyByInviteCode calls find_family_by_invite_code with just the code, and maps the minimal result', async () => {
    const rpc = jest.fn().mockResolvedValue({
      data: [{ id: 'fam-1', name: 'המשפחה שלנו', dog_name: 'טופי' }],
      error: null,
    });
    mockSupabaseClient(rpc);
    const { findFamilyByInviteCode } = require('../supabase');

    const result = await findFamilyByInviteCode('abc123');

    expect(rpc).toHaveBeenCalledWith('find_family_by_invite_code', { code: 'abc123' });
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ id: 'fam-1', name: 'המשפחה שלנו', dogName: 'טופי' });
  });

  it('findFamilyByInviteCode returns null (not an error) when no family matches', async () => {
    const rpc = jest.fn().mockResolvedValue({ data: [], error: null });
    mockSupabaseClient(rpc);
    const { findFamilyByInviteCode } = require('../supabase');

    expect(await findFamilyByInviteCode('zzzzzz')).toBeNull();
  });

  it('findFamilyByInviteCode rejects when the RPC errors', async () => {
    const rpc = jest.fn().mockResolvedValue({ data: null, error: { message: 'boom' } });
    mockSupabaseClient(rpc);
    const { findFamilyByInviteCode } = require('../supabase');

    await expect(findFamilyByInviteCode('abc123')).rejects.toBeTruthy();
  });

  it('findFamilyByInviteCode accepts a single-row (non-array) response and omits dogName when absent', async () => {
    const rpc = jest.fn().mockResolvedValue({ data: { id: 'fam-4', name: 'משפחה ללא כלב' }, error: null });
    mockSupabaseClient(rpc);
    const { findFamilyByInviteCode } = require('../supabase');

    const result = await findFamilyByInviteCode('nodoge');
    expect(result).toEqual({ id: 'fam-4', name: 'משפחה ללא כלב', dogName: undefined });
  });

  it('joinFamily calls join_family with the code and returns the joined family', async () => {
    const rpc = jest.fn().mockResolvedValue({ data: [{ id: 'fam-1', name: 'המשפחה שלנו' }], error: null });
    mockSupabaseClient(rpc);
    const { joinFamily } = require('../supabase');

    const result = await joinFamily('abc123');
    expect(rpc).toHaveBeenCalledWith('join_family', { code: 'abc123' });
    expect(result).toEqual({ id: 'fam-1', name: 'המשפחה שלנו' });
  });

  it('joinFamily surfaces a rejection when the code does not match any family', async () => {
    const rpc = jest.fn().mockResolvedValue({ data: null, error: { message: 'invalid invite code' } });
    mockSupabaseClient(rpc);
    const { joinFamily } = require('../supabase');

    await expect(joinFamily('nope')).rejects.toBeTruthy();
  });

  it('joinFamily throws a Hebrew error when the RPC succeeds but returns no row', async () => {
    const rpc = jest.fn().mockResolvedValue({ data: [], error: null });
    mockSupabaseClient(rpc);
    const { joinFamily } = require('../supabase');

    await expect(joinFamily('nope')).rejects.toThrow('לא נמצאה משפחה עם הקוד הזה');
  });

  it('joinFamily accepts a single-row (non-array) response', async () => {
    const rpc = jest.fn().mockResolvedValue({ data: { id: 'fam-5', name: 'משפחת אבני' }, error: null });
    mockSupabaseClient(rpc);
    const { joinFamily } = require('../supabase');

    const result = await joinFamily('abc123');
    expect(result).toEqual({ id: 'fam-5', name: 'משפחת אבני' });
  });

  it('createFamily calls create_family with the family name and no forced dog name by default', async () => {
    const rpc = jest.fn().mockResolvedValue({
      data: [{ id: 'fam-2', name: 'משפחת כהן', invite_code: 'XYZ789' }],
      error: null,
    });
    mockSupabaseClient(rpc);
    const { createFamily } = require('../supabase');

    const result = await createFamily('משפחת כהן');

    // A real new family must never be forced into "טופי" — that default is
    // local/demo-mode-only seed data.
    expect(rpc).toHaveBeenCalledWith('create_family', { family_name: 'משפחת כהן', dog_name: null });
    expect(result).toEqual({ id: 'fam-2', name: 'משפחת כהן', inviteCode: 'XYZ789' });
  });

  it('createFamily passes an explicit dog name through when the user gives one', async () => {
    const rpc = jest.fn().mockResolvedValue({
      data: [{ id: 'fam-3', name: 'משפחת לוי', invite_code: 'QWE456' }],
      error: null,
    });
    mockSupabaseClient(rpc);
    const { createFamily } = require('../supabase');

    await createFamily('משפחת לוי', 'ריקי');
    expect(rpc).toHaveBeenCalledWith('create_family', { family_name: 'משפחת לוי', dog_name: 'ריקי' });
  });

  it('createFamily rejects when the RPC errors', async () => {
    const rpc = jest.fn().mockResolvedValue({ data: null, error: { message: 'boom' } });
    mockSupabaseClient(rpc);
    const { createFamily } = require('../supabase');

    await expect(createFamily('משפחה')).rejects.toBeTruthy();
  });

  it('createFamily throws a Hebrew error when the RPC succeeds but returns no row', async () => {
    const rpc = jest.fn().mockResolvedValue({ data: null, error: null });
    mockSupabaseClient(rpc);
    const { createFamily } = require('../supabase');

    await expect(createFamily('משפחה')).rejects.toThrow('יצירת המשפחה נכשלה');
  });

  it('regenerateInviteCode calls regenerate_invite_code with the target family id and returns the new code', async () => {
    const rpc = jest.fn().mockResolvedValue({ data: 'NEWCODE', error: null });
    mockSupabaseClient(rpc);
    const { regenerateInviteCode } = require('../supabase');

    const code = await regenerateInviteCode('fam-1');
    expect(rpc).toHaveBeenCalledWith('regenerate_invite_code', { target_family_id: 'fam-1' });
    expect(code).toBe('NEWCODE');
  });

  it('regenerateInviteCode rejects when the RPC errors (e.g. caller is not a member of the family)', async () => {
    const rpc = jest.fn().mockResolvedValue({ data: null, error: { message: 'not a member' } });
    mockSupabaseClient(rpc);
    const { regenerateInviteCode } = require('../supabase');

    await expect(regenerateInviteCode('fam-1')).rejects.toBeTruthy();
  });

  it.each(['admin', 'member'] as const)('getCurrentFamilyRole calls current_family_role and returns %s as-is', async (role) => {
    const rpc = jest.fn().mockResolvedValue({ data: role, error: null });
    mockSupabaseClient(rpc);
    const { getCurrentFamilyRole } = require('../supabase');

    const result = await getCurrentFamilyRole();
    expect(rpc).toHaveBeenCalledWith('current_family_role');
    expect(result).toBe(role);
  });

  it('getCurrentFamilyRole returns null for any value that is not exactly "admin" or "member" (never trusts an unexpected shape)', async () => {
    const rpc = jest.fn().mockResolvedValue({ data: null, error: null });
    mockSupabaseClient(rpc);
    const { getCurrentFamilyRole } = require('../supabase');

    expect(await getCurrentFamilyRole()).toBeNull();
  });

  it('getCurrentFamilyRole rejects when the RPC errors', async () => {
    const rpc = jest.fn().mockResolvedValue({ data: null, error: { message: 'boom' } });
    mockSupabaseClient(rpc);
    const { getCurrentFamilyRole } = require('../supabase');

    await expect(getCurrentFamilyRole()).rejects.toBeTruthy();
  });

  /**
   * claimFamilyProfile is a thin wrapper over the claim_family_profile
   * SECURITY DEFINER RPC (migrations/0004_*.sql) — it used to be a plain
   * `.update({ auth_user_id })` on `users`, but that can no longer work now
   * that the users UPDATE policy is scoped to self-or-admin (a device
   * claiming a profile for the first time has no "self" row yet). These
   * tests only verify the CLIENT call shape (RPC name/params, error
   * propagation) — the actual "removed profile cannot be claimed" /
   * "not a member of this family" / "active profile can still be claimed"
   * enforcement lives in the SQL function body and can only be verified
   * against a real Supabase project, not from this Jest sandbox.
   */
  it('claimFamilyProfile calls claim_family_profile with target_user_id and resolves when the RPC succeeds (valid active profile can still be claimed)', async () => {
    const rpc = jest.fn().mockResolvedValue({ data: null, error: null });
    mockSupabaseClient(rpc);
    const { claimFamilyProfile } = require('../supabase');

    await expect(claimFamilyProfile('user-1')).resolves.toBeUndefined();
    expect(rpc).toHaveBeenCalledWith('claim_family_profile', { target_user_id: 'user-1' });
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it('claimFamilyProfile rejects when the RPC rejects the claim (e.g. a removed profile cannot be claimed)', async () => {
    const rpc = jest.fn().mockResolvedValue({
      data: null,
      error: { message: 'cannot claim a removed profile' },
    });
    mockSupabaseClient(rpc);
    const { claimFamilyProfile } = require('../supabase');

    await expect(claimFamilyProfile('removed-user')).rejects.toBeTruthy();
  });

  it('claimFamilyProfile rejects when the target user is not in the caller\'s family', async () => {
    const rpc = jest.fn().mockResolvedValue({
      data: null,
      error: { message: 'not a member of this user\'s family' },
    });
    mockSupabaseClient(rpc);
    const { claimFamilyProfile } = require('../supabase');

    await expect(claimFamilyProfile('other-family-user')).rejects.toBeTruthy();
  });

  it('claimFamilyProfile rejects when the profile is already claimed by a different device (anti-takeover)', async () => {
    // The claim_family_profile() RPC itself is what enforces this — see
    // manual_tests/0004_profile_edit_acl.sql for the actual SQL-level
    // coverage of "already claimed by same auth user -> idempotent" vs.
    // "already claimed by a different auth user -> rejected". This test
    // only confirms the client surfaces that rejection rather than
    // swallowing it.
    const rpc = jest.fn().mockResolvedValue({
      data: null,
      error: { message: 'profile already claimed by another device' },
    });
    mockSupabaseClient(rpc);
    const { claimFamilyProfile } = require('../supabase');

    await expect(claimFamilyProfile('already-claimed-user')).rejects.toBeTruthy();
  });
});

describe('lib/supabase — local/demo mode (no env vars): family functions refuse rather than silently misbehave', () => {
  beforeEach(() => {
    jest.resetModules();
    process.env = { ...ORIGINAL_ENV };
    delete process.env.EXPO_PUBLIC_SUPABASE_URL;
    delete process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  });

  afterEach(() => {
    process.env = ORIGINAL_ENV;
  });

  it('isSupabaseConfigured is false, and create/join/lookup all reject instead of touching a null client', async () => {
    const { isSupabaseConfigured, findFamilyByInviteCode, joinFamily, createFamily, regenerateInviteCode } = require('../supabase');

    expect(isSupabaseConfigured).toBe(false);
    await expect(findFamilyByInviteCode('abc123')).rejects.toThrow();
    await expect(joinFamily('abc123')).rejects.toThrow();
    await expect(createFamily('שם')).rejects.toThrow();
    await expect(regenerateInviteCode('fam-1')).rejects.toThrow();
  });

  it('getCurrentFamilyRole resolves to null (not a rejection) — local/demo mode has no server role to ask for; authStore treats local mode as always-admin separately', async () => {
    const { getCurrentFamilyRole } = require('../supabase');
    expect(await getCurrentFamilyRole()).toBeNull();
  });

  it('claimFamilyProfile no-ops (resolves without calling anything) in local/demo mode — there is no server RLS/RPC to claim against', async () => {
    const { claimFamilyProfile } = require('../supabase');
    await expect(claimFamilyProfile('user-1')).resolves.toBeUndefined();
  });
});
