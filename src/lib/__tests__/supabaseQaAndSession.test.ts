const ORIGINAL_ENV = process.env;

function mockSupabaseClient(opts: {
  rpc?: jest.Mock;
  getSession?: jest.Mock;
  signInAnonymously?: jest.Mock;
}) {
  const rpc = opts.rpc ?? jest.fn().mockResolvedValue({ data: null, error: null });
  const getSession = opts.getSession ?? jest.fn().mockResolvedValue({ data: { session: null } });
  const signInAnonymously = opts.signInAnonymously ?? jest.fn().mockResolvedValue({ error: null });
  jest.doMock('@supabase/supabase-js', () => ({
    createClient: jest.fn(() => ({
      auth: { getSession, signInAnonymously },
      rpc,
      from: jest.fn(),
      storage: { from: jest.fn() },
    })),
  }));
  return { rpc, getSession, signInAnonymously };
}

/**
 * These test the CLIENT side only (RPC name/params, response mapping, error
 * propagation) — same scope/rationale as supabaseFamily.test.ts. The actual
 * SECURITY DEFINER / RLS enforcement lives in the SQL functions and can only
 * be verified against a real Supabase project.
 */
describe('lib/supabase — session, PIN claim, QA sandbox, whoami, impersonation (Supabase mode)', () => {
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

  describe('ensureAnonymousSession', () => {
    it('does nothing when a session already exists', async () => {
      const { getSession, signInAnonymously } = mockSupabaseClient({
        getSession: jest.fn().mockResolvedValue({ data: { session: { access_token: 'tok' } } }),
      });
      const { ensureAnonymousSession } = require('../supabase');

      await ensureAnonymousSession();
      expect(getSession).toHaveBeenCalledTimes(1);
      expect(signInAnonymously).not.toHaveBeenCalled();
    });

    it('signs in anonymously when there is no existing session', async () => {
      const { signInAnonymously } = mockSupabaseClient({
        signInAnonymously: jest.fn().mockResolvedValue({ error: null }),
      });
      const { ensureAnonymousSession } = require('../supabase');

      await ensureAnonymousSession();
      expect(signInAnonymously).toHaveBeenCalledTimes(1);
    });

    it('rejects when anonymous sign-in fails', async () => {
      mockSupabaseClient({
        signInAnonymously: jest.fn().mockResolvedValue({ error: { message: 'anon sign-in disabled' } }),
      });
      const { ensureAnonymousSession } = require('../supabase');

      await expect(ensureAnonymousSession()).rejects.toBeTruthy();
    });
  });

  describe('setProfilePin', () => {
    it('calls set_profile_pin with the user id and pin', async () => {
      const { rpc } = mockSupabaseClient({ rpc: jest.fn().mockResolvedValue({ error: null }) });
      const { setProfilePin } = require('../supabase');

      await setProfilePin('user-1', '1234');
      expect(rpc).toHaveBeenCalledWith('set_profile_pin', { p_user_id: 'user-1', p_pin: '1234' });
    });

    it('passes pin: null through to clear an existing PIN', async () => {
      const { rpc } = mockSupabaseClient({ rpc: jest.fn().mockResolvedValue({ error: null }) });
      const { setProfilePin } = require('../supabase');

      await setProfilePin('user-1', null);
      expect(rpc).toHaveBeenCalledWith('set_profile_pin', { p_user_id: 'user-1', p_pin: null });
    });

    it('rejects when the RPC errors', async () => {
      mockSupabaseClient({ rpc: jest.fn().mockResolvedValue({ error: { message: 'not allowed' } }) });
      const { setProfilePin } = require('../supabase');

      await expect(setProfilePin('user-1', '1234')).rejects.toBeTruthy();
    });
  });

  describe('claimFamilyProfileWithPin', () => {
    it('resolves when the RPC returns success', async () => {
      const { rpc } = mockSupabaseClient({
        rpc: jest.fn().mockResolvedValue({ data: { success: true }, error: null }),
      });
      const { claimFamilyProfileWithPin } = require('../supabase');

      await expect(claimFamilyProfileWithPin('user-1', '1234')).resolves.toBeUndefined();
      expect(rpc).toHaveBeenCalledWith('claim_family_profile_with_pin', {
        p_target_user_id: 'user-1',
        p_pin: '1234',
      });
    });

    it('throws "incorrect PIN" when the RPC reports reason: wrong_pin', async () => {
      mockSupabaseClient({
        rpc: jest.fn().mockResolvedValue({ data: { success: false, reason: 'wrong_pin' }, error: null }),
      });
      const { claimFamilyProfileWithPin } = require('../supabase');

      await expect(claimFamilyProfileWithPin('user-1', 'bad')).rejects.toThrow('incorrect PIN');
    });

    it('throws a distinct cooldown message when the RPC reports reason: cooldown (must never look like a wrong-PIN result)', async () => {
      mockSupabaseClient({
        rpc: jest.fn().mockResolvedValue({ data: { success: false, reason: 'cooldown' }, error: null }),
      });
      const { claimFamilyProfileWithPin } = require('../supabase');

      await expect(claimFamilyProfileWithPin('user-1', '1234')).rejects.toThrow(
        'too many incorrect PIN attempts'
      );
    });

    it('rejects when the RPC itself errors (e.g. not authenticated)', async () => {
      mockSupabaseClient({
        rpc: jest.fn().mockResolvedValue({ data: null, error: { message: 'not authenticated' } }),
      });
      const { claimFamilyProfileWithPin } = require('../supabase');

      await expect(claimFamilyProfileWithPin('user-1', '1234')).rejects.toBeTruthy();
    });
  });

  describe('QA sandbox (enterQaSandbox / exitQaSandbox / getCurrentFamilyIsQa / qaResetData / qaResetFull)', () => {
    it('enterQaSandbox calls enter_qa_sandbox and maps the returned family', async () => {
      const { rpc } = mockSupabaseClient({
        rpc: jest.fn().mockResolvedValue({
          data: [{ id: 'qa-fam-1', name: 'QA Family', invite_code: 'QACODE' }],
          error: null,
        }),
      });
      const { enterQaSandbox } = require('../supabase');

      const result = await enterQaSandbox('QA Family');
      expect(rpc).toHaveBeenCalledWith('enter_qa_sandbox', { p_family_name: 'QA Family' });
      expect(result).toEqual({ id: 'qa-fam-1', name: 'QA Family', inviteCode: 'QACODE' });
    });

    it('enterQaSandbox throws a Hebrew error when the RPC returns no row', async () => {
      mockSupabaseClient({ rpc: jest.fn().mockResolvedValue({ data: null, error: null }) });
      const { enterQaSandbox } = require('../supabase');

      await expect(enterQaSandbox('QA Family')).rejects.toThrow('כניסה לסביבת ה-QA נכשלה');
    });

    it('enterQaSandbox rejects when the RPC errors', async () => {
      mockSupabaseClient({ rpc: jest.fn().mockResolvedValue({ data: null, error: { message: 'boom' } }) });
      const { enterQaSandbox } = require('../supabase');

      await expect(enterQaSandbox('QA Family')).rejects.toBeTruthy();
    });

    it('exitQaSandbox calls exit_qa_sandbox and maps the restored family', async () => {
      const { rpc } = mockSupabaseClient({
        rpc: jest.fn().mockResolvedValue({ data: [{ id: 'real-fam-1', name: 'המשפחה שלנו' }], error: null }),
      });
      const { exitQaSandbox } = require('../supabase');

      const result = await exitQaSandbox();
      expect(rpc).toHaveBeenCalledWith('exit_qa_sandbox');
      expect(result).toEqual({ id: 'real-fam-1', name: 'המשפחה שלנו' });
    });

    it('exitQaSandbox throws a Hebrew error when the RPC returns no row (nothing to restore)', async () => {
      mockSupabaseClient({ rpc: jest.fn().mockResolvedValue({ data: null, error: null }) });
      const { exitQaSandbox } = require('../supabase');

      await expect(exitQaSandbox()).rejects.toThrow('יציאה מסביבת ה-QA נכשלה');
    });

    it('exitQaSandbox rejects when the RPC errors (e.g. this device is not currently in a QA family)', async () => {
      mockSupabaseClient({ rpc: jest.fn().mockResolvedValue({ data: null, error: { message: 'not in a QA family' } }) });
      const { exitQaSandbox } = require('../supabase');

      await expect(exitQaSandbox()).rejects.toBeTruthy();
    });

    it('getCurrentFamilyIsQa returns true only when the RPC returns exactly true', async () => {
      const { rpc } = mockSupabaseClient({ rpc: jest.fn().mockResolvedValue({ data: true, error: null }) });
      const { getCurrentFamilyIsQa } = require('../supabase');

      expect(await getCurrentFamilyIsQa()).toBe(true);
      expect(rpc).toHaveBeenCalledWith('current_family_is_qa');
    });

    it('getCurrentFamilyIsQa returns false for any non-true value', async () => {
      mockSupabaseClient({ rpc: jest.fn().mockResolvedValue({ data: null, error: null }) });
      const { getCurrentFamilyIsQa } = require('../supabase');

      expect(await getCurrentFamilyIsQa()).toBe(false);
    });

    it('getCurrentFamilyIsQa rejects when the RPC errors', async () => {
      mockSupabaseClient({ rpc: jest.fn().mockResolvedValue({ data: null, error: { message: 'boom' } }) });
      const { getCurrentFamilyIsQa } = require('../supabase');

      await expect(getCurrentFamilyIsQa()).rejects.toBeTruthy();
    });

    it('qaResetData calls qa_reset_data with the family id and confirm token, keeping members', async () => {
      const { rpc } = mockSupabaseClient({ rpc: jest.fn().mockResolvedValue({ error: null }) });
      const { qaResetData } = require('../supabase');

      await qaResetData('qa-fam-1');
      expect(rpc).toHaveBeenCalledWith('qa_reset_data', { p_family_id: 'qa-fam-1', p_confirm: 'RESET' });
    });

    it('qaResetData rejects when the RPC errors', async () => {
      mockSupabaseClient({ rpc: jest.fn().mockResolvedValue({ error: { message: 'not a QA family' } }) });
      const { qaResetData } = require('../supabase');

      await expect(qaResetData('not-qa-fam')).rejects.toBeTruthy();
    });

    it('qaResetFull calls qa_reset_full with the family id and confirm token, for a full blank-slate reset', async () => {
      const { rpc } = mockSupabaseClient({ rpc: jest.fn().mockResolvedValue({ error: null }) });
      const { qaResetFull } = require('../supabase');

      await qaResetFull('qa-fam-1');
      expect(rpc).toHaveBeenCalledWith('qa_reset_full', { p_family_id: 'qa-fam-1', p_confirm: 'RESET' });
    });

    it('qaResetFull rejects when the RPC errors', async () => {
      mockSupabaseClient({ rpc: jest.fn().mockResolvedValue({ error: { message: 'not a QA family' } }) });
      const { qaResetFull } = require('../supabase');

      await expect(qaResetFull('not-qa-fam')).rejects.toBeTruthy();
    });
  });

  describe('getWhoAmI', () => {
    it('calls whoami and maps every field, including impersonation state', async () => {
      const { rpc } = mockSupabaseClient({
        rpc: jest.fn().mockResolvedValue({
          data: [
            {
              profile_id: 'user-1',
              real_profile_id: 'admin-1',
              family_role: 'admin',
              is_impersonating: true,
              impersonated_user_id: 'user-1',
            },
          ],
          error: null,
        }),
      });
      const { getWhoAmI } = require('../supabase');

      const result = await getWhoAmI();
      expect(rpc).toHaveBeenCalledWith('whoami');
      expect(result).toEqual({
        profileId: 'user-1',
        realProfileId: 'admin-1',
        familyRole: 'admin',
        isImpersonating: true,
        impersonatedUserId: 'user-1',
      });
    });

    it('never trusts an unexpected family_role shape, mapping it to null', async () => {
      mockSupabaseClient({
        rpc: jest.fn().mockResolvedValue({
          data: [{ profile_id: 'user-1', real_profile_id: 'user-1', family_role: 'owner', is_impersonating: false }],
          error: null,
        }),
      });
      const { getWhoAmI } = require('../supabase');

      const result = await getWhoAmI();
      expect(result?.familyRole).toBeNull();
    });

    it('returns null (not a rejection) when the RPC returns no row', async () => {
      mockSupabaseClient({ rpc: jest.fn().mockResolvedValue({ data: null, error: null }) });
      const { getWhoAmI } = require('../supabase');

      expect(await getWhoAmI()).toBeNull();
    });

    it('rejects when the RPC errors', async () => {
      mockSupabaseClient({ rpc: jest.fn().mockResolvedValue({ data: null, error: { message: 'boom' } }) });
      const { getWhoAmI } = require('../supabase');

      await expect(getWhoAmI()).rejects.toBeTruthy();
    });
  });

  describe('beginImpersonation / endImpersonation', () => {
    it('beginImpersonation calls begin_impersonation with the target user id and returns the token', async () => {
      const { rpc } = mockSupabaseClient({ rpc: jest.fn().mockResolvedValue({ data: 'impersonation-token', error: null }) });
      const { beginImpersonation } = require('../supabase');

      const token = await beginImpersonation('member-1');
      expect(rpc).toHaveBeenCalledWith('begin_impersonation', { p_target_user_id: 'member-1' });
      expect(token).toBe('impersonation-token');
    });

    it('beginImpersonation rejects when the caller is not a real family admin', async () => {
      mockSupabaseClient({ rpc: jest.fn().mockResolvedValue({ data: null, error: { message: 'not a family admin' } }) });
      const { beginImpersonation } = require('../supabase');

      await expect(beginImpersonation('member-1')).rejects.toBeTruthy();
    });

    it('endImpersonation calls end_impersonation', async () => {
      const { rpc } = mockSupabaseClient({ rpc: jest.fn().mockResolvedValue({ error: null }) });
      const { endImpersonation } = require('../supabase');

      await endImpersonation();
      expect(rpc).toHaveBeenCalledWith('end_impersonation');
    });

    it('endImpersonation rejects when the RPC errors', async () => {
      mockSupabaseClient({ rpc: jest.fn().mockResolvedValue({ error: { message: 'boom' } }) });
      const { endImpersonation } = require('../supabase');

      await expect(endImpersonation()).rejects.toBeTruthy();
    });
  });
});

describe('lib/supabase — local/demo mode (no env vars): session/PIN/QA/whoami/impersonation functions refuse or no-op rather than touching a null client', () => {
  beforeEach(() => {
    jest.resetModules();
    process.env = { ...ORIGINAL_ENV };
    delete process.env.EXPO_PUBLIC_SUPABASE_URL;
    delete process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  });

  afterEach(() => {
    process.env = ORIGINAL_ENV;
  });

  it('ensureAnonymousSession no-ops (there is no server session to establish)', async () => {
    const { ensureAnonymousSession } = require('../supabase');
    await expect(ensureAnonymousSession()).resolves.toBeUndefined();
  });

  it('setProfilePin and claimFamilyProfileWithPin reject instead of touching a null client', async () => {
    const { setProfilePin, claimFamilyProfileWithPin } = require('../supabase');
    await expect(setProfilePin('user-1', '1234')).rejects.toThrow();
    await expect(claimFamilyProfileWithPin('user-1', '1234')).rejects.toThrow();
  });

  it('QA sandbox functions reject instead of touching a null client, except getCurrentFamilyIsQa which resolves false', async () => {
    const { enterQaSandbox, exitQaSandbox, getCurrentFamilyIsQa, qaResetData, qaResetFull } = require('../supabase');
    await expect(enterQaSandbox('QA Family')).rejects.toThrow();
    await expect(exitQaSandbox()).rejects.toThrow();
    await expect(getCurrentFamilyIsQa()).resolves.toBe(false);
    await expect(qaResetData('fam-1')).rejects.toThrow();
    await expect(qaResetFull('fam-1')).rejects.toThrow();
  });

  it('getWhoAmI resolves to null (no server identity to resolve in local/demo mode)', async () => {
    const { getWhoAmI } = require('../supabase');
    expect(await getWhoAmI()).toBeNull();
  });

  it('beginImpersonation rejects; endImpersonation no-ops', async () => {
    const { beginImpersonation, endImpersonation } = require('../supabase');
    await expect(beginImpersonation('member-1')).rejects.toThrow();
    await expect(endImpersonation()).resolves.toBeUndefined();
  });
});
