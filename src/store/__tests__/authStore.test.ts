import { DEMO_FAMILY } from '../../data/demoData';

const ORIGINAL_ENV = process.env;

function mockSupabaseModule(rpc: jest.Mock = jest.fn().mockResolvedValue({ data: null, error: null })) {
  jest.doMock('@supabase/supabase-js', () => ({
    createClient: jest.fn(() => ({
      auth: {
        getSession: jest.fn().mockResolvedValue({ data: { session: { user: { id: 'auth-1' } } } }),
        signInAnonymously: jest.fn().mockResolvedValue({ error: null }),
      },
      rpc,
      from: jest.fn(),
      storage: { from: jest.fn() },
    })),
  }));
}

/**
 * Routes a mocked `.rpc(name, args)` call to a per-function-name handler —
 * needed for tests below that exercise more than one distinct RPC in the
 * same test (e.g. restoreSession() calling both end_impersonation and
 * whoami). Any RPC name not given a handler resolves to `{ data: null,
 * error: null }`, matching mockSupabaseModule()'s own default — EXCEPT
 * 'whoami', which defaults to confirming whatever user id was most recently
 * passed to claim_family_profile (mirroring a real, healthy claim: the
 * server's own authoritative lookup agrees with what was just claimed).
 * This is what lets every EXISTING signIn()-exercising test above keep
 * working unchanged now that signIn() verifies its own claim via whoami()
 * (see the round-2 "Idan investigation" fix in authStore.ts) — only tests
 * that care about a whoami MISMATCH need to pass their own explicit
 * 'whoami' handler to override this default.
 */
function rpcRouter(handlers: Record<string, (args?: unknown) => { data: unknown; error: unknown }>) {
  let lastClaimedUserId: string | null = null;
  return jest.fn((name: string, args?: unknown) => {
    if (name === 'claim_family_profile' && args && typeof args === 'object' && 'target_user_id' in args) {
      lastClaimedUserId = (args as { target_user_id: string }).target_user_id;
    }
    // COMPLETION PASS: claim_family_profile_with_pin() (0016) is the second
    // RPC that can actually claim a profile — track it here too so the same
    // default whoami-confirms-the-last-claim behavior works for
    // signInWithPin() tests exactly like it already does for signIn().
    if (name === 'claim_family_profile_with_pin' && args && typeof args === 'object' && 'p_target_user_id' in args) {
      lastClaimedUserId = (args as { p_target_user_id: string }).p_target_user_id;
    }
    const handler = handlers[name];
    if (handler) return Promise.resolve(handler(args));
    if (name === 'whoami') {
      return Promise.resolve(whoAmIRow({ profile_id: lastClaimedUserId, real_profile_id: lastClaimedUserId }));
    }
    return Promise.resolve({ data: null, error: null });
  });
}

function whoAmIRow(overrides: Partial<{
  profile_id: string | null;
  real_profile_id: string | null;
  family_role: string | null;
  is_impersonating: boolean;
  impersonated_user_id: string | null;
}> = {}) {
  return {
    data: [
      {
        profile_id: null,
        real_profile_id: null,
        family_role: null,
        is_impersonating: false,
        impersonated_user_id: null,
        ...overrides,
      },
    ],
    error: null,
  };
}

/**
 * Regression tests for the multi-device invite-code feature: authStore now
 * tracks a device-local `familyId` (which family this device belongs to),
 * separate from `currentUserId` (which family member this device is signed
 * in as) — requirement: currentUserId stays device-local, never shared
 * between phones, and local/demo mode must never show the create/join
 * onboarding.
 */
describe('authStore — familyId', () => {
  afterEach(() => {
    process.env = ORIGINAL_ENV;
  });

  it('local/demo mode (no Supabase env vars) always resolves familyId to the seeded demo family', async () => {
    jest.resetModules();
    process.env = { ...ORIGINAL_ENV };
    delete process.env.EXPO_PUBLIC_SUPABASE_URL;
    delete process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
    const AsyncStorage = require('@react-native-async-storage/async-storage');
    await AsyncStorage.clear();
    const { useAuthStore } = require('../authStore');

    await useAuthStore.getState().restoreSession();

    expect(useAuthStore.getState().hydrated).toBe(true);
    expect(useAuthStore.getState().familyId).toBe(DEMO_FAMILY.id);
  });

  it('Supabase mode: a device with nothing saved yet resolves familyId to null (onboarding needed)', async () => {
    jest.resetModules();
    process.env = {
      ...ORIGINAL_ENV,
      EXPO_PUBLIC_SUPABASE_URL: 'https://example.supabase.co',
      EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'anon-key',
    };
    mockSupabaseModule();
    const AsyncStorage = require('@react-native-async-storage/async-storage');
    await AsyncStorage.clear();
    const { useAuthStore } = require('../authStore');

    await useAuthStore.getState().restoreSession();

    expect(useAuthStore.getState().familyId).toBeNull();
  });

  it('Supabase mode: setFamilyId persists device-locally and a later restoreSession reads it back from storage (not stale in-memory state)', async () => {
    jest.resetModules();
    process.env = {
      ...ORIGINAL_ENV,
      EXPO_PUBLIC_SUPABASE_URL: 'https://example.supabase.co',
      EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'anon-key',
    };
    mockSupabaseModule();
    const AsyncStorage = require('@react-native-async-storage/async-storage');
    await AsyncStorage.clear();
    const { useAuthStore } = require('../authStore');

    await useAuthStore.getState().restoreSession();
    await useAuthStore.getState().setFamilyId('fam-42');
    expect(useAuthStore.getState().familyId).toBe('fam-42');

    // Prove this came from persisted storage, not leftover in-memory state.
    useAuthStore.setState({ familyId: null, currentUserId: null, hydrated: false });
    await useAuthStore.getState().restoreSession();
    expect(useAuthStore.getState().familyId).toBe('fam-42');
  });

  it('signIn (currentUserId) is device-local and untouched by familyId', async () => {
    jest.resetModules();
    process.env = { ...ORIGINAL_ENV };
    delete process.env.EXPO_PUBLIC_SUPABASE_URL;
    delete process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
    const AsyncStorage = require('@react-native-async-storage/async-storage');
    await AsyncStorage.clear();
    const { useAuthStore } = require('../authStore');

    await useAuthStore.getState().restoreSession();
    await useAuthStore.getState().signIn('user-aba');

    expect(useAuthStore.getState().currentUserId).toBe('user-aba');
    expect(useAuthStore.getState().familyId).toBe(DEMO_FAMILY.id); // unaffected

    await useAuthStore.getState().signOut();
    expect(useAuthStore.getState().currentUserId).toBeNull();
    expect(useAuthStore.getState().familyId).toBe(DEMO_FAMILY.id); // signing out keeps this device's family
  });
});

/**
 * FINAL CORRECTION PASS — Deliverable 1 (persona-vs-authorization bug fix).
 * These tests cover the CLIENT-side half of the fix: __signInCore() (both
 * signIn() and signInWithPin()) must refresh familyRole/isQaFamily AFTER a
 * successful claim, because — per migrations/0016_*.sql's Part 0 rework —
 * admin authority now genuinely depends on WHICH PERSONA was just claimed,
 * not just on this device's permanent family membership. The actual
 * server-side authorization fix (current_family_role()/is_family_admin()
 * deriving from users.role of the claimed persona) lives in SQL and is
 * covered by the migration's own extensive SECURITY WALKTHROUGH comment and
 * the adversarial reasoning in the final report — these tests confirm the
 * client correctly PICKS UP whatever the server now says after a claim,
 * rather than continuing to show a stale pre-claim role.
 */
describe('authStore — familyRole refresh after a claim (persona-vs-authorization fix)', () => {
  afterEach(() => {
    process.env = ORIGINAL_ENV;
  });

  function setupSupabaseMode(rpc: jest.Mock) {
    process.env = {
      ...ORIGINAL_ENV,
      EXPO_PUBLIC_SUPABASE_URL: 'https://example.supabase.co',
      EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'anon-key',
    };
    mockSupabaseModule(rpc);
    jest.doMock('../../data', () => ({
      repository: {
        trySync: jest.fn().mockResolvedValue(undefined),
        hasPendingForOtherUser: jest.fn().mockResolvedValue(false),
      },
    }));
  }

  it('signIn() as a MEMBER persona resolves familyRole to member, even if this device was previously admin under a different persona', async () => {
    jest.resetModules();
    const rpc = rpcRouter({
      current_family_role: () => ({ data: 'member', error: null }),
      current_family_is_qa: () => ({ data: false, error: null }),
    });
    setupSupabaseMode(rpc);
    const AsyncStorage = require('@react-native-async-storage/async-storage');
    await AsyncStorage.clear();
    const { useAuthStore } = require('../authStore');
    // Simulate this device having previously resolved as admin (e.g. under
    // its own real persona, or stale from a prior session).
    useAuthStore.setState({ familyRole: 'admin' });

    await useAuthStore.getState().signIn('idan');

    expect(rpc).toHaveBeenCalledWith('current_family_role');
    expect(useAuthStore.getState().familyRole).toBe('member');
  });

  it('signInWithPin() (claim TRANSFER) as an ADMIN persona resolves familyRole to admin — the core Dad<->Idan scenario', async () => {
    jest.resetModules();
    const rpc = rpcRouter({
      whoami: () => whoAmIRow({ profile_id: 'dad', real_profile_id: 'dad', family_role: 'admin' }),
      current_family_role: () => ({ data: 'admin', error: null }),
      current_family_is_qa: () => ({ data: false, error: null }),
    });
    setupSupabaseMode(rpc);
    const AsyncStorage = require('@react-native-async-storage/async-storage');
    await AsyncStorage.clear();
    const { useAuthStore } = require('../authStore');
    // This device was just Idan (a member) a moment ago.
    useAuthStore.setState({ familyRole: 'member' });

    await useAuthStore.getState().signInWithPin('dad', '4321');

    expect(rpc).toHaveBeenCalledWith('claim_family_profile_with_pin', { p_target_user_id: 'dad', p_pin: '4321' });
    expect(useAuthStore.getState().familyRole).toBe('admin');
  });

  it('signInWithPin() (claim TRANSFER) as a MEMBER persona resolves familyRole to member — symmetric Dad->Idan scenario', async () => {
    jest.resetModules();
    const rpc = rpcRouter({
      whoami: () => whoAmIRow({ profile_id: 'idan', real_profile_id: 'idan', family_role: 'member' }),
      current_family_role: () => ({ data: 'member', error: null }),
      current_family_is_qa: () => ({ data: false, error: null }),
    });
    setupSupabaseMode(rpc);
    const AsyncStorage = require('@react-native-async-storage/async-storage');
    await AsyncStorage.clear();
    const { useAuthStore } = require('../authStore');
    // This device was just Dad (an admin) a moment ago.
    useAuthStore.setState({ familyRole: 'admin', currentUserId: 'dad' });

    await useAuthStore.getState().signInWithPin('idan', '1234');

    expect(rpc).toHaveBeenCalledWith('claim_family_profile_with_pin', { p_target_user_id: 'idan', p_pin: '1234' });
    expect(useAuthStore.getState().currentUserId).toBe('idan');
    expect(useAuthStore.getState().familyRole).toBe('member');
  });

  /**
   * NARROW CLIENT-FLOW FIX — "החלף משתמש" must never leave partial state: a
   * wrong PIN (or, at the UI layer, Cancel — which never even calls this
   * function, see the new SettingsScreen structural test) must leave BOTH
   * this device's local currentUserId AND its server-side claim completely
   * untouched. The PIN check DOES reach claim_family_profile_with_pin() (the
   * server verifies the PIN and rejects — see that function's own doc
   * comment in migrations/0016_*.sql: PIN is checked BEFORE either write, so
   * a rejection here means the server-side release-then-claim pair never
   * ran at all, leaving the old claim row exactly as it was). What's
   * asserted client-side, the only thing observable from here: no local
   * state changes on rejection — currentUserId (the local mirror of the
   * still-untouched server claim) and familyRole both stay exactly as they
   * were, and nothing is persisted to AsyncStorage.
   */
  it('a wrong PIN rejects, never changes familyRole, and leaves currentUserId (the old claim) completely untouched', async () => {
    jest.resetModules();
    const rpc = jest.fn().mockResolvedValue({ data: null, error: { message: 'incorrect PIN' } });
    setupSupabaseMode(rpc);
    const AsyncStorage = require('@react-native-async-storage/async-storage');
    await AsyncStorage.clear();
    await AsyncStorage.setItem('dog-walk-family:current-user-id', 'dad');
    const { useAuthStore } = require('../authStore');
    useAuthStore.setState({ familyRole: 'admin', currentUserId: 'dad' });

    await expect(useAuthStore.getState().signInWithPin('idan', '0000')).rejects.toBeTruthy();

    expect(rpc).toHaveBeenCalledWith('claim_family_profile_with_pin', { p_target_user_id: 'idan', p_pin: '0000' });
    expect(useAuthStore.getState().familyRole).toBe('admin'); // untouched
    expect(useAuthStore.getState().currentUserId).toBe('dad'); // untouched — still Dad
    expect(await AsyncStorage.getItem('dog-walk-family:current-user-id')).toBe('dad'); // untouched
  });
});

/**
 * FINAL CORRECTION PASS — Deliverable 2 (QA sandbox reversibility). Covers
 * setFamilyId()'s new currentUserId resync (the fix that makes
 * enter/exit_qa_sandbox() actually usable — see its own doc comment in
 * authStore.ts): a family switch must never leave a STALE persona id from
 * the family just left cached client-side.
 */
describe('authStore — setFamilyId resyncs currentUserId from the server (QA sandbox enter/exit)', () => {
  afterEach(() => {
    process.env = ORIGINAL_ENV;
  });

  function setupSupabaseMode(rpc: jest.Mock) {
    process.env = {
      ...ORIGINAL_ENV,
      EXPO_PUBLIC_SUPABASE_URL: 'https://example.supabase.co',
      EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'anon-key',
    };
    mockSupabaseModule(rpc);
  }

  it('entering a QA sandbox (nothing claimed yet) clears the stale real-family currentUserId', async () => {
    jest.resetModules();
    const rpc = rpcRouter({
      current_family_role: () => ({ data: 'admin', error: null }),
      current_family_is_qa: () => ({ data: true, error: null }),
      whoami: () => whoAmIRow({ profile_id: null, real_profile_id: null }),
    });
    setupSupabaseMode(rpc);
    const AsyncStorage = require('@react-native-async-storage/async-storage');
    await AsyncStorage.clear();
    const { useAuthStore } = require('../authStore');
    useAuthStore.setState({ currentUserId: 'real-dad-id' });
    await AsyncStorage.setItem('dog-walk-family:current-user-id', 'real-dad-id');

    await useAuthStore.getState().setFamilyId('qa-family-1');

    expect(useAuthStore.getState().currentUserId).toBeNull();
    expect(await AsyncStorage.getItem('dog-walk-family:current-user-id')).toBeNull();
  });

  it('exiting a QA sandbox re-adopts the server-restored real persona automatically', async () => {
    jest.resetModules();
    const rpc = rpcRouter({
      current_family_role: () => ({ data: 'admin', error: null }),
      current_family_is_qa: () => ({ data: false, error: null }),
      whoami: () => whoAmIRow({ profile_id: 'real-dad-id', real_profile_id: 'real-dad-id', family_role: 'admin' }),
    });
    setupSupabaseMode(rpc);
    const AsyncStorage = require('@react-native-async-storage/async-storage');
    await AsyncStorage.clear();
    const { useAuthStore } = require('../authStore');
    useAuthStore.setState({ currentUserId: 'qa-persona-id' });

    await useAuthStore.getState().setFamilyId('real-family-1');

    expect(useAuthStore.getState().currentUserId).toBe('real-dad-id');
    expect(await AsyncStorage.getItem('dog-walk-family:current-user-id')).toBe('real-dad-id');
  });
});

/**
 * authStore.familyRole is the single source of truth for admin/member
 * permission checks (ScheduleScreen, FamilyScreen, SettingsScreen all read
 * it from here instead of each independently calling getCurrentFamilyRole).
 */
describe('authStore — familyRole', () => {
  afterEach(() => {
    process.env = ORIGINAL_ENV;
  });

  it('local/demo mode: restoreSession resolves familyRole to admin (a single device fully controls its own demo family)', async () => {
    jest.resetModules();
    process.env = { ...ORIGINAL_ENV };
    delete process.env.EXPO_PUBLIC_SUPABASE_URL;
    delete process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
    const AsyncStorage = require('@react-native-async-storage/async-storage');
    await AsyncStorage.clear();
    const { useAuthStore } = require('../authStore');

    await useAuthStore.getState().restoreSession();

    expect(useAuthStore.getState().familyRole).toBe('admin');
  });

  it('Supabase mode: restoreSession resolves familyRole from current_family_role() once a familyId is known', async () => {
    jest.resetModules();
    process.env = {
      ...ORIGINAL_ENV,
      EXPO_PUBLIC_SUPABASE_URL: 'https://example.supabase.co',
      EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'anon-key',
    };
    const rpc = jest.fn().mockResolvedValue({ data: 'member', error: null });
    mockSupabaseModule(rpc);
    const AsyncStorage = require('@react-native-async-storage/async-storage');
    await AsyncStorage.clear();
    await AsyncStorage.setItem('dog-walk-family:current-family-id', 'fam-42');
    const { useAuthStore } = require('../authStore');

    await useAuthStore.getState().restoreSession();

    expect(rpc).toHaveBeenCalledWith('current_family_role');
    expect(useAuthStore.getState().familyRole).toBe('member');
  });

  it('Supabase mode: setFamilyId (just created/joined a family) re-resolves familyRole immediately', async () => {
    jest.resetModules();
    process.env = {
      ...ORIGINAL_ENV,
      EXPO_PUBLIC_SUPABASE_URL: 'https://example.supabase.co',
      EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'anon-key',
    };
    const rpc = jest.fn().mockResolvedValue({ data: 'admin', error: null });
    mockSupabaseModule(rpc);
    const AsyncStorage = require('@react-native-async-storage/async-storage');
    await AsyncStorage.clear();
    const { useAuthStore } = require('../authStore');

    expect(useAuthStore.getState().familyRole).toBeNull();
    await useAuthStore.getState().setFamilyId('fam-new');

    expect(useAuthStore.getState().familyRole).toBe('admin');
  });

  it('a failed role lookup leaves familyRole null instead of throwing (so a Member is never mistakenly treated as admin on error)', async () => {
    jest.resetModules();
    process.env = {
      ...ORIGINAL_ENV,
      EXPO_PUBLIC_SUPABASE_URL: 'https://example.supabase.co',
      EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'anon-key',
    };
    const rpc = jest.fn().mockResolvedValue({ data: null, error: { message: 'network error' } });
    mockSupabaseModule(rpc);
    const AsyncStorage = require('@react-native-async-storage/async-storage');
    await AsyncStorage.clear();
    const { useAuthStore } = require('../authStore');

    await useAuthStore.getState().refreshFamilyRole();

    expect(useAuthStore.getState().familyRole).toBeNull();
  });
});

/**
 * Round 7, Part 2: MemberDetailsModal/FamilyScreen call
 * refreshOwnRoleAfterChange(changedUserId) after set_member_role() has
 * ALREADY succeeded server-side, so authStore.familyRole never goes stale
 * when the CURRENT device's own role is the one that changed (e.g. an admin
 * demoting themselves while another admin remains). See
 * refreshOwnRoleAfterChange's doc comment in authStore.ts for the full
 * design, including the fail-closed roleRefreshNotice fallback.
 */
describe('authStore — refreshOwnRoleAfterChange (round 7, Part 2 self-role-change fix)', () => {
  afterEach(() => {
    process.env = ORIGINAL_ENV;
  });

  async function setupAdminInSupabaseMode(rpc: jest.Mock) {
    jest.resetModules();
    process.env = {
      ...ORIGINAL_ENV,
      EXPO_PUBLIC_SUPABASE_URL: 'https://example.supabase.co',
      EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'anon-key',
    };
    mockSupabaseModule(rpc);
    jest.doMock('../../data', () => ({
      repository: { trySync: jest.fn().mockResolvedValue(undefined), hasPendingForOtherUser: jest.fn().mockResolvedValue(false) },
    }));
    const AsyncStorage = require('@react-native-async-storage/async-storage');
    await AsyncStorage.clear();
    const { useAuthStore } = require('../authStore');
    useAuthStore.setState({ familyRole: 'admin', familyId: 'fam-1', hydrated: true });
    await useAuthStore.getState().signIn('admin-1');
    return useAuthStore;
  }

  // Item 1: changing ANOTHER member's role must not touch this device's
  // own familyRole, and must not even call the server for it.
  it('1. another member\'s role changed -> is a no-op: familyRole untouched, current_family_role never called', async () => {
    const rpc = rpcRouter({ current_family_role: () => ({ data: 'admin', error: null }) });
    const useAuthStore = await setupAdminInSupabaseMode(rpc);
    rpc.mockClear();

    await useAuthStore.getState().refreshOwnRoleAfterChange('some-other-member');

    expect(rpc).not.toHaveBeenCalledWith('current_family_role');
    expect(useAuthStore.getState().familyRole).toBe('admin'); // still the value set up above, untouched
    expect(useAuthStore.getState().roleRefreshNotice).toBeNull();
  });

  // Item 2: self-demotion (another admin remains) -> familyRole becomes
  // 'member' and isRealFamilyAdmin() now reflects that, once
  // refreshOwnRoleAfterChange's own await resolves.
  it('2. self-demotion -> refreshFamilyRole is called and awaited, familyRole becomes member, isRealFamilyAdmin() now false', async () => {
    const rpc = rpcRouter({ current_family_role: () => ({ data: 'member', error: null }) });
    const useAuthStore = await setupAdminInSupabaseMode(rpc);
    rpc.mockClear();

    await useAuthStore.getState().refreshOwnRoleAfterChange('admin-1'); // admin-1 is the signed-in id

    expect(rpc).toHaveBeenCalledWith('current_family_role');
    expect(useAuthStore.getState().familyRole).toBe('member');
    const { isRealFamilyAdmin } = require('../authStore');
    expect(isRealFamilyAdmin(useAuthStore.getState().familyRole, useAuthStore.getState().impersonatingUserId)).toBe(false);
    expect(useAuthStore.getState().roleRefreshNotice).toBeNull();
  });

  // Item 2 (promotion direction): the exact same code path — no branching on
  // promote vs demote anywhere in this function — also covers a self
  // PROMOTION consistently.
  it('2b. self-promotion goes through the identical code path (no separate handling needed)', async () => {
    const rpc = rpcRouter({ current_family_role: () => ({ data: 'admin', error: null }) });
    const useAuthStore = await setupAdminInSupabaseMode(rpc);
    useAuthStore.setState({ familyRole: 'member' });
    rpc.mockClear();

    await useAuthStore.getState().refreshOwnRoleAfterChange('admin-1');

    expect(rpc).toHaveBeenCalledWith('current_family_role');
    expect(useAuthStore.getState().familyRole).toBe('admin');
  });

  // Item 4: the role change itself already succeeded (this function is only
  // ever reached after it did — see its own doc comment), but the FOLLOW-UP
  // refreshFamilyRole() read fails. Chosen fail-closed behavior: reuse
  // refreshFamilyRole()'s own existing convention (set familyRole to null,
  // never leave the stale OLD role looking authoritative) and additionally
  // set roleRefreshNotice so the UI can tell the admin to manually refresh.
  it('4. post-success refreshFamilyRole() failure -> familyRole becomes null (existing fail-closed convention) and roleRefreshNotice is set', async () => {
    const rpc = rpcRouter({ current_family_role: () => ({ data: null, error: { message: 'network error' } }) });
    const useAuthStore = await setupAdminInSupabaseMode(rpc);
    rpc.mockClear();

    await useAuthStore.getState().refreshOwnRoleAfterChange('admin-1');

    expect(useAuthStore.getState().familyRole).toBeNull();
    expect(useAuthStore.getState().roleRefreshNotice).toMatch(/אירעה שגיאה ברענון ההרשאות/);
    const { isRealFamilyAdmin } = require('../authStore');
    // familyRole null -> admin-only UI stays hidden rather than trusting a
    // stale 'admin' value.
    expect(isRealFamilyAdmin(useAuthStore.getState().familyRole, useAuthStore.getState().impersonatingUserId)).toBe(false);
  });

  it('clearRoleRefreshNotice clears the one-time notice', async () => {
    const rpc = rpcRouter({ current_family_role: () => ({ data: null, error: { message: 'network error' } }) });
    const useAuthStore = await setupAdminInSupabaseMode(rpc);
    await useAuthStore.getState().refreshOwnRoleAfterChange('admin-1');
    expect(useAuthStore.getState().roleRefreshNotice).not.toBeNull();

    useAuthStore.getState().clearRoleRefreshNotice();

    expect(useAuthStore.getState().roleRefreshNotice).toBeNull();
  });

  // Item 3 (RPC failure for the role change ITSELF, e.g. the last-admin
  // guard rejecting a self-demotion): MemberDetailsModal only calls
  // onRoleChanged() (which is what eventually calls
  // refreshOwnRoleAfterChange) INSIDE its try block AFTER `await
  // setMemberRole(...)` resolves without throwing — a thrown
  // setMemberRole() goes straight to the catch block and onRoleChanged is
  // never invoked at all (see MemberDetailsModal.tsx's applyRoleChange:
  // `await setMemberRole(...); setPendingRole(null); await
  // onRoleChanged(user.id);` all inside one try, with nothing calling
  // onRoleChanged from the catch). This repo has no React Native
  // component-rendering test infra for any existing modal (no
  // @testing-library/react-native usage anywhere under src/, despite it
  // being a devDependency), so — consistent with how isRealFamilyAdmin()
  // was itself extracted as a plain function for direct unit testing
  // rather than tested via FamilyScreen rendering — this is verified by
  // code inspection of that control flow rather than a rendered-component
  // test. What IS directly testable and covered above is
  // refreshOwnRoleAfterChange()'s own contract: it never mutates
  // familyRole for a role that was never this device's own (test 1), which
  // is the piece that would matter if it were ever miscalled.
});

/**
 * ADMIN TEST MODE — testModeUserId is a display-only overlay (see its doc
 * comment in authStore.ts): the REAL currentUserId/familyRole must never be
 * touched by entering/exiting it, only an Admin may enter it, and it must
 * be cleared automatically by the safety nets (sign out, family change,
 * simulated member no longer active) rather than surviving confusingly.
 */
describe('authStore — Admin Test Mode', () => {
  afterEach(() => {
    process.env = ORIGINAL_ENV;
  });

  async function setupLocalAdmin() {
    jest.resetModules();
    process.env = { ...ORIGINAL_ENV };
    delete process.env.EXPO_PUBLIC_SUPABASE_URL;
    delete process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
    const AsyncStorage = require('@react-native-async-storage/async-storage');
    await AsyncStorage.clear();
    const { useAuthStore } = require('../authStore');
    await useAuthStore.getState().restoreSession(); // local/demo mode -> familyRole 'admin'
    await useAuthStore.getState().signIn('admin-user');
    return useAuthStore;
  }

  it('only an admin can enter test mode', async () => {
    const useAuthStore = await setupLocalAdmin();
    useAuthStore.setState({ familyRole: 'member' });

    expect(() => useAuthStore.getState().enterTestMode('member-1')).toThrow();
    expect(useAuthStore.getState().testModeUserId).toBeNull();
  });

  it('entering test mode never touches the real currentUserId/familyRole', async () => {
    const useAuthStore = await setupLocalAdmin();

    useAuthStore.getState().enterTestMode('member-1');

    expect(useAuthStore.getState().testModeUserId).toBe('member-1');
    expect(useAuthStore.getState().currentUserId).toBe('admin-user'); // unchanged
    expect(useAuthStore.getState().familyRole).toBe('admin'); // unchanged
  });

  it('exiting test mode restores normal (non-simulated) behavior', async () => {
    const useAuthStore = await setupLocalAdmin();
    useAuthStore.getState().enterTestMode('member-1');
    useAuthStore.getState().exitTestMode();
    expect(useAuthStore.getState().testModeUserId).toBeNull();
  });

  it('simulating yourself is a no-op (nothing meaningful to test)', async () => {
    const useAuthStore = await setupLocalAdmin();
    useAuthStore.getState().enterTestMode('admin-user');
    expect(useAuthStore.getState().testModeUserId).toBeNull();
  });

  it('signOut clears test mode', async () => {
    const useAuthStore = await setupLocalAdmin();
    useAuthStore.getState().enterTestMode('member-1');
    await useAuthStore.getState().signOut();
    expect(useAuthStore.getState().testModeUserId).toBeNull();
  });

  it('changing family clears test mode', async () => {
    const useAuthStore = await setupLocalAdmin();
    useAuthStore.getState().enterTestMode('member-1');
    await useAuthStore.getState().setFamilyId('some-other-family');
    expect(useAuthStore.getState().testModeUserId).toBeNull();
  });

  it('clearTestModeIfInvalid exits test mode once the simulated member is no longer active', async () => {
    const useAuthStore = await setupLocalAdmin();
    useAuthStore.getState().enterTestMode('member-1');
    expect(useAuthStore.getState().testModeUserId).toBe('member-1');

    useAuthStore.getState().clearTestModeIfInvalid(['admin-user', 'member-2']); // member-1 no longer active
    expect(useAuthStore.getState().testModeUserId).toBeNull();
  });

  it('clearTestModeIfInvalid leaves test mode alone while the simulated member is still active', async () => {
    const useAuthStore = await setupLocalAdmin();
    useAuthStore.getState().enterTestMode('member-1');

    useAuthStore.getState().clearTestModeIfInvalid(['admin-user', 'member-1']);
    expect(useAuthStore.getState().testModeUserId).toBe('member-1');
  });
});

/**
 * authStore.signIn() in Supabase mode must gate on claimFamilyProfile()
 * (claim_family_profile() RPC, migrations/0004_*.sql) actually succeeding
 * BEFORE persisting/setting currentUserId. Swallowing a claim rejection
 * here would let a device "sign in" locally as a profile the server just
 * refused to hand it — e.g. one already claimed by a different device —
 * defeating the whole Self + Admin / anti-takeover model. These tests cover
 * only the client-side gating (signIn must propagate the rejection and must
 * not touch currentUserId on failure); the RPC's own accept/reject logic is
 * covered separately in supabase/manual_tests/0004_profile_edit_acl.sql.
 */
describe('authStore — signIn (Supabase mode: claim gating)', () => {
  afterEach(() => {
    process.env = ORIGINAL_ENV;
  });

  function setupSupabaseMode(rpc: jest.Mock) {
    process.env = {
      ...ORIGINAL_ENV,
      EXPO_PUBLIC_SUPABASE_URL: 'https://example.supabase.co',
      EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'anon-key',
    };
    mockSupabaseModule(rpc);
    // signIn() now also calls repository.trySync()/hasPendingForOtherUser()
    // (the audit-integrity queue guard below) before claiming — stub the
    // data layer here so these claim-gating tests exercise only what they're
    // actually about, not a real OfflineFirstRepository/NetInfo round trip.
    // The guard itself is covered by the dedicated describe block below.
    jest.doMock('../../data', () => ({
      repository: {
        trySync: jest.fn().mockResolvedValue(undefined),
        hasPendingForOtherUser: jest.fn().mockResolvedValue(false),
      },
    }));
  }

  it('successful claim -> currentUserId is persisted (both in-memory and in AsyncStorage)', async () => {
    jest.resetModules();
    const rpc = rpcRouter({});
    setupSupabaseMode(rpc);
    const AsyncStorage = require('@react-native-async-storage/async-storage');
    await AsyncStorage.clear();
    const { useAuthStore } = require('../authStore');

    await useAuthStore.getState().signIn('user-1');

    expect(rpc).toHaveBeenCalledWith('claim_family_profile', { target_user_id: 'user-1' });
    expect(useAuthStore.getState().currentUserId).toBe('user-1');
    expect(await AsyncStorage.getItem('dog-walk-family:current-user-id')).toBe('user-1');
  });

  /**
   * POST-CLAIM VERIFICATION (round-2 security review, item A/B) — see
   * authStore.signIn()'s own doc comment for why claim_family_profile()
   * resolving without error is not, by itself, proof this device's
   * authoritative identity actually resolves to the claimed profile. These
   * two tests are the explicit A/B pair requested in that review, spelled
   * out separately from "successful claim..." above (which now also
   * exercises this path via rpcRouter()'s default whoami behavior) so the
   * verification step itself has its own dedicated, unambiguous coverage.
   */
  it('A. claim RPC succeeds AND whoami confirms the same user -> signIn succeeds', async () => {
    jest.resetModules();
    const rpc = rpcRouter({
      claim_family_profile: () => ({ data: null, error: null }),
      whoami: () => whoAmIRow({ profile_id: 'idan', real_profile_id: 'idan', family_role: 'member' }),
    });
    setupSupabaseMode(rpc);
    const AsyncStorage = require('@react-native-async-storage/async-storage');
    await AsyncStorage.clear();
    const { useAuthStore } = require('../authStore');

    await useAuthStore.getState().signIn('idan');

    expect(useAuthStore.getState().currentUserId).toBe('idan');
    expect(await AsyncStorage.getItem('dog-walk-family:current-user-id')).toBe('idan');
  });

  it('B. claim RPC reports success BUT whoami returns null/a different user -> signIn REJECTS and does NOT persist currentUserId', async () => {
    jest.resetModules();
    const rpc = rpcRouter({
      claim_family_profile: () => ({ data: null, error: null }), // reports success...
      whoami: () => whoAmIRow({ profile_id: null, real_profile_id: null, family_role: null }), // ...but this does not confirm it
    });
    setupSupabaseMode(rpc);
    const AsyncStorage = require('@react-native-async-storage/async-storage');
    await AsyncStorage.clear();
    const { useAuthStore } = require('../authStore');

    await expect(useAuthStore.getState().signIn('idan')).rejects.toBeTruthy();

    expect(useAuthStore.getState().currentUserId).toBeNull();
    expect(await AsyncStorage.getItem('dog-walk-family:current-user-id')).toBeNull();
  });

  it('B2. claim RPC succeeds but whoami confirms a DIFFERENT profile than the one requested -> signIn REJECTS', async () => {
    jest.resetModules();
    const rpc = rpcRouter({
      claim_family_profile: () => ({ data: null, error: null }),
      // Confirms SOME profile is claimed, just not the one signIn() asked
      // for — e.g. a stale/duplicate users row (see
      // idan_claim_diagnostic.sql's step 1) resolving instead.
      whoami: () => whoAmIRow({ profile_id: 'some-other-user', real_profile_id: 'some-other-user', family_role: 'member' }),
    });
    setupSupabaseMode(rpc);
    const AsyncStorage = require('@react-native-async-storage/async-storage');
    await AsyncStorage.clear();
    const { useAuthStore } = require('../authStore');

    await expect(useAuthStore.getState().signIn('idan')).rejects.toBeTruthy();

    expect(useAuthStore.getState().currentUserId).toBeNull();
  });

  it('failed claim -> signIn rejects and currentUserId is NOT set/persisted', async () => {
    jest.resetModules();
    const rpc = jest.fn().mockResolvedValue({
      data: null,
      error: { message: 'profile already claimed by another device' },
    });
    setupSupabaseMode(rpc);
    const AsyncStorage = require('@react-native-async-storage/async-storage');
    await AsyncStorage.clear();
    const { useAuthStore } = require('../authStore');

    await expect(useAuthStore.getState().signIn('user-1')).rejects.toBeTruthy();

    expect(useAuthStore.getState().currentUserId).toBeNull();
    expect(await AsyncStorage.getItem('dog-walk-family:current-user-id')).toBeNull();
  });

  it('failed claim leaves a PREVIOUSLY signed-in currentUserId unchanged (does not clear it either)', async () => {
    jest.resetModules();
    const rpc = rpcRouter({});
    setupSupabaseMode(rpc);
    const AsyncStorage = require('@react-native-async-storage/async-storage');
    await AsyncStorage.clear();
    const { useAuthStore } = require('../authStore');

    await useAuthStore.getState().signIn('user-1');
    expect(useAuthStore.getState().currentUserId).toBe('user-1');

    rpc.mockResolvedValueOnce({ data: null, error: { message: 'cannot claim a removed profile' } });
    await expect(useAuthStore.getState().signIn('user-2')).rejects.toBeTruthy();

    expect(useAuthStore.getState().currentUserId).toBe('user-1');
    expect(await AsyncStorage.getItem('dog-walk-family:current-user-id')).toBe('user-1');
  });

  it('already-claimed-by-other: the rejection message surfaces through, and LoginScreen\'s claimErrorMessage() maps it to a visible, friendly login error', async () => {
    jest.resetModules();
    const rpc = jest.fn().mockResolvedValue({
      data: null,
      error: { message: 'profile already claimed by another device' },
    });
    setupSupabaseMode(rpc);
    const AsyncStorage = require('@react-native-async-storage/async-storage');
    await AsyncStorage.clear();
    const { useAuthStore } = require('../authStore');
    const { claimErrorMessage } = require('../../screens/LoginScreen');

    let caught: unknown;
    try {
      await useAuthStore.getState().signIn('user-1');
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeTruthy();
    const message = claimErrorMessage(caught);
    expect(message).toMatch(/כבר בשימוש במכשיר אחר/);
    expect(useAuthStore.getState().currentUserId).toBeNull();
  });
});

/**
 * COMPLETION PASS — Priority 1 (7B). signInWithPin() shares __signInCore()
 * with signIn() above (same post-claim finalize sequence) — these tests
 * cover the parts that are actually DIFFERENT: which RPC gets called, that
 * a wrong/missing PIN rejects exactly like a rejected plain claim (no
 * partial local state), and that a successful PIN claim persists
 * currentUserId exactly like a successful plain claim does.
 */
describe('authStore — signInWithPin (Supabase mode: PIN-based claim transfer)', () => {
  afterEach(() => {
    process.env = ORIGINAL_ENV;
  });

  function setupSupabaseMode(rpc: jest.Mock) {
    process.env = {
      ...ORIGINAL_ENV,
      EXPO_PUBLIC_SUPABASE_URL: 'https://example.supabase.co',
      EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'anon-key',
    };
    mockSupabaseModule(rpc);
    jest.doMock('../../data', () => ({
      repository: {
        trySync: jest.fn().mockResolvedValue(undefined),
        hasPendingForOtherUser: jest.fn().mockResolvedValue(false),
      },
    }));
  }

  it('correct PIN -> claims via claim_family_profile_with_pin and persists currentUserId', async () => {
    jest.resetModules();
    const rpc = rpcRouter({});
    setupSupabaseMode(rpc);
    const AsyncStorage = require('@react-native-async-storage/async-storage');
    await AsyncStorage.clear();
    const { useAuthStore } = require('../authStore');

    await useAuthStore.getState().signInWithPin('idan', '1234');

    expect(rpc).toHaveBeenCalledWith('claim_family_profile_with_pin', { p_target_user_id: 'idan', p_pin: '1234' });
    // claim_family_profile (the OTHER RPC) must never also be called — this
    // is a distinct claim path, not a fallback/retry of the plain one.
    expect(rpc).not.toHaveBeenCalledWith('claim_family_profile', expect.anything());
    expect(useAuthStore.getState().currentUserId).toBe('idan');
    expect(await AsyncStorage.getItem('dog-walk-family:current-user-id')).toBe('idan');
  });

  it('wrong PIN -> rejects and does NOT persist currentUserId', async () => {
    jest.resetModules();
    const rpc = jest.fn().mockResolvedValue({ data: null, error: { message: 'incorrect PIN' } });
    setupSupabaseMode(rpc);
    const AsyncStorage = require('@react-native-async-storage/async-storage');
    await AsyncStorage.clear();
    const { useAuthStore } = require('../authStore');

    await expect(useAuthStore.getState().signInWithPin('idan', '0000')).rejects.toBeTruthy();

    expect(useAuthStore.getState().currentUserId).toBeNull();
    expect(await AsyncStorage.getItem('dog-walk-family:current-user-id')).toBeNull();
  });

  /**
   * NARROW FIX PASS (real Jest failure, Windows run against final6): this
   * test previously asserted `.rejects.toThrow(/no PIN set/)` — a
   * content-matching toThrow() against a REJECTION VALUE THAT IS A PLAIN
   * `{ message }` OBJECT, not a real `Error` instance (claimFamilyProfileWithPin()
   * in lib/supabase.ts does `if (error) throw error;`, re-throwing the RPC's
   * error exactly as Supabase's client returns it — never wrapped in `new
   * Error(...)`). This is the EXACT same pitfall this file's OWN comments
   * already call out twice elsewhere (see "a server-side rejection ..."
   * and "endImpersonation leaves impersonatingUserId ... when the RPC
   * fails", both a few hundred lines below this one): a
   * content-matching `.rejects.toThrow(regex)` does not reliably match
   * against a non-Error rejection value in this project's Jest/RN preset —
   * it can report "did not throw at all" even though the promise
   * genuinely DID reject with the right message, which is exactly the
   * real Windows Jest failure reported for this test. This was a TEST
   * ASSERTION defect, not a production or migration defect — confirmed by
   * reading migrations/0016_*.sql's claim_family_profile_with_pin()
   * directly: it checks `if target_pin_hash is null then raise exception
   * 'no PIN set for this profile ...'; end if;` BEFORE any release/claim
   * mutation (before app.trusted_write is even set), and the neighboring
   * "wrong PIN" test above already avoids this exact trap by using
   * `.rejects.toBeTruthy()` instead of a content-matching toThrow(). Fixed
   * here the same way this file's other two documented instances were
   * fixed: a manual try/catch with an explicit `.message` regex assertion,
   * which unambiguously proves both "it rejected" and "with the right
   * reason" regardless of the rejection value's shape — plus the
   * additional required assertions (familyRole, persisted AsyncStorage
   * identity, and that the post-claim finalize path — whoami() — was
   * never reached).
   */
  it('no PIN set for the target profile -> rejects with the distinct "no PIN set" rejection, and leaves every piece of local/persisted state completely untouched', async () => {
    jest.resetModules();
    const rpc = jest.fn().mockResolvedValue({ data: null, error: { message: 'no PIN set for this profile — ask your family admin to set one, or reclaim from the original device' } });
    setupSupabaseMode(rpc);
    const AsyncStorage = require('@react-native-async-storage/async-storage');
    await AsyncStorage.clear();
    const { useAuthStore } = require('../authStore');
    // A known baseline to prove stays untouched — matching "the previous
    // server claim remains intact" (nothing here ever attempts to change
    // it) and "familyRole unchanged".
    useAuthStore.setState({ familyRole: 'admin' });

    let caught: unknown;
    let resolved = false;
    try {
      await useAuthStore.getState().signInWithPin('idan', '1234');
      resolved = true;
    } catch (err) {
      caught = err;
    }

    expect(resolved).toBe(false);
    expect(caught).toBeTruthy();
    expect(String((caught as { message?: string })?.message)).toMatch(/no PIN set/);

    // Required: currentUserId unchanged.
    expect(useAuthStore.getState().currentUserId).toBeNull();
    // Required: familyRole unchanged.
    expect(useAuthStore.getState().familyRole).toBe('admin');
    // Required: persisted identity unchanged.
    expect(await AsyncStorage.getItem('dog-walk-family:current-user-id')).toBeNull();
    // Required: the shared post-claim finalize path (whoami() — see
    // __signInCore()'s POST-CLAIM VERIFICATION step) was never reached at
    // all — the rejection happens inside claimFamilyProfileWithPin()
    // itself, before __signInCore() ever gets to that step.
    expect(rpc).not.toHaveBeenCalledWith('whoami');
  });

  /**
   * FINAL HARDENING PASS — server-side PIN attempt limiting
   * (migrations/0016_*.sql's profile_pin_attempts table + return-shape
   * change on claim_family_profile_with_pin(), from `void` to a structured
   * jsonb result for the wrong-PIN and cooldown cases specifically — see
   * that function's own doc comment, and claimFamilyProfileWithPin() in
   * lib/supabase.ts, for exactly why). These tests exercise the REAL
   * claimFamilyProfileWithPin() wrapper (only '@supabase/supabase-js' is
   * mocked here, not lib/supabase.ts itself) against the two new structured
   * result shapes it must now translate into a thrown, distinct-message
   * rejection — the counting/threshold/cooldown-timing logic itself lives
   * entirely in Postgres and cannot be exercised by a Jest-mocked RPC layer;
   * see this pass's MANIFEST.txt for a manual Supabase integration-test
   * checklist covering those real transaction/locking/timing properties.
   */
  it('wrong PIN, reported via the new structured {success:false, reason:"wrong_pin"} result -> rejects with the distinct "incorrect PIN" message and leaves local/persisted state untouched', async () => {
    jest.resetModules();
    const rpc = jest.fn().mockResolvedValue({
      data: { success: false, reason: 'wrong_pin' },
      error: null,
    });
    setupSupabaseMode(rpc);
    const AsyncStorage = require('@react-native-async-storage/async-storage');
    await AsyncStorage.clear();
    const { useAuthStore } = require('../authStore');
    useAuthStore.setState({ familyRole: 'admin' });

    let caught: unknown;
    let resolved = false;
    try {
      await useAuthStore.getState().signInWithPin('idan', '0000');
      resolved = true;
    } catch (err) {
      caught = err;
    }

    expect(resolved).toBe(false);
    expect(String((caught as { message?: string })?.message)).toMatch(/incorrect PIN/);
    expect(useAuthStore.getState().currentUserId).toBeNull();
    expect(useAuthStore.getState().familyRole).toBe('admin');
    expect(await AsyncStorage.getItem('dog-walk-family:current-user-id')).toBeNull();
    // The finalize path (whoami) must never be reached — the rejection
    // happens inside claimFamilyProfileWithPin() itself.
    expect(rpc).not.toHaveBeenCalledWith('whoami');
  });

  it('active cooldown, reported via the new structured {success:false, reason:"cooldown"} result -> rejects with a message DISTINCT from a plain wrong-PIN rejection, and leaves local/persisted state untouched', async () => {
    jest.resetModules();
    const rpc = jest.fn().mockResolvedValue({
      data: { success: false, reason: 'cooldown' },
      error: null,
    });
    setupSupabaseMode(rpc);
    const AsyncStorage = require('@react-native-async-storage/async-storage');
    await AsyncStorage.clear();
    const { useAuthStore } = require('../authStore');
    useAuthStore.setState({ familyRole: 'admin' });

    let caught: unknown;
    let resolved = false;
    try {
      // Deliberately passing what would, hypothetically, be the CORRECT
      // PIN — the client has no way to know that, and neither should the
      // resulting error: this only proves the client faithfully surfaces
      // whatever `reason` the server returned, never second-guessing it
      // into the wrong-PIN message. The actual "even a correct PIN is
      // rejected during cooldown, without leaking that fact" guarantee is a
      // SERVER-SIDE (SQL) property — see the migration's own doc comment
      // and this pass's manual integration-test checklist in MANIFEST.txt.
      await useAuthStore.getState().signInWithPin('idan', '1234');
      resolved = true;
    } catch (err) {
      caught = err;
    }

    expect(resolved).toBe(false);
    const message = String((caught as { message?: string })?.message);
    expect(message).toMatch(/too many incorrect PIN attempts/);
    // Distinct from the plain wrong-PIN message — required so the client
    // (and errorMessages.ts) can tell the two cases apart.
    expect(message).not.toBe('incorrect PIN');
    expect(useAuthStore.getState().currentUserId).toBeNull();
    expect(useAuthStore.getState().familyRole).toBe('admin');
    expect(await AsyncStorage.getItem('dog-walk-family:current-user-id')).toBeNull();
    expect(rpc).not.toHaveBeenCalledWith('whoami');
  });

  it('a successful PIN claim (structured {success:true} result) still completes normally — the new return shape does not interfere with the success path', async () => {
    jest.resetModules();
    const rpc = rpcRouter({
      claim_family_profile_with_pin: () => ({ data: { success: true }, error: null }),
      whoami: () => whoAmIRow({ profile_id: 'idan', real_profile_id: 'idan', family_role: 'member' }),
      current_family_role: () => ({ data: 'member', error: null }),
    });
    setupSupabaseMode(rpc);
    const AsyncStorage = require('@react-native-async-storage/async-storage');
    await AsyncStorage.clear();
    const { useAuthStore } = require('../authStore');

    await useAuthStore.getState().signInWithPin('idan', '1234');

    expect(useAuthStore.getState().currentUserId).toBe('idan');
    expect(useAuthStore.getState().familyRole).toBe('member');
    expect(await AsyncStorage.getItem('dog-walk-family:current-user-id')).toBe('idan');
  });

  it('a successful PIN claim also runs the shared post-claim finalize: whoami verification and impersonation cleanup', async () => {
    jest.resetModules();
    const rpc = rpcRouter({
      whoami: () => whoAmIRow({ profile_id: 'idan', real_profile_id: 'idan', family_role: 'member' }),
    });
    setupSupabaseMode(rpc);
    const AsyncStorage = require('@react-native-async-storage/async-storage');
    await AsyncStorage.clear();
    const { useAuthStore } = require('../authStore');

    await useAuthStore.getState().signInWithPin('idan', '1234');

    expect(rpc).toHaveBeenCalledWith('whoami');
    expect(rpc).toHaveBeenCalledWith('end_impersonation');
    expect(useAuthStore.getState().impersonatingUserId).toBeNull();
  });

  it('whoami fails to confirm the claimed profile after a successful PIN claim -> rejects, does not persist (same guarantee as plain signIn)', async () => {
    jest.resetModules();
    const rpc = rpcRouter({
      claim_family_profile_with_pin: () => ({ data: null, error: null }),
      whoami: () => whoAmIRow({ profile_id: null, real_profile_id: null }),
    });
    setupSupabaseMode(rpc);
    const AsyncStorage = require('@react-native-async-storage/async-storage');
    await AsyncStorage.clear();
    const { useAuthStore } = require('../authStore');

    await expect(useAuthStore.getState().signInWithPin('idan', '1234')).rejects.toBeTruthy();
    expect(useAuthStore.getState().currentUserId).toBeNull();
  });
});

/**
 * AUDIT-INTEGRITY GUARD (Round 3, issue 3): a shared device's SyncQueue can
 * hold a write enqueued under one claimed profile that hasn't reached
 * Supabase yet. If a DIFFERENT family member then signs in on the same
 * device before that flush happens, migrations/0005_*.sql's audit triggers
 * would resolve the actor as the NEW profile once the queued write finally
 * syncs — misattributing an action the original member took, from a
 * client-supplied value the server correctly never trusted in the first
 * place. signIn() must try to flush first (the common, already-online case)
 * and — if writes for a different profile are still stuck afterwards —
 * refuse the profile switch outright rather than let that misattribution
 * happen silently. `repository` is mocked here (rather than exercised for
 * real through SyncQueue/NetInfo) so these tests can deterministically
 * control "flush succeeded" vs. "still offline" without a real network
 * layer; SyncQueue.hasPendingForOtherUser's own tagging/flushing behavior is
 * covered directly in data/__tests__/syncQueue.test.ts.
 */
describe('authStore — signIn (Supabase mode: offline-queue audit-integrity guard)', () => {
  afterEach(() => {
    process.env = ORIGINAL_ENV;
  });

  function setupSupabaseModeWithQueueGuard(opts: { hasPendingForOtherUser: boolean; claimRpc?: jest.Mock }) {
    process.env = {
      ...ORIGINAL_ENV,
      EXPO_PUBLIC_SUPABASE_URL: 'https://example.supabase.co',
      EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'anon-key',
    };
    const rpc = opts.claimRpc ?? rpcRouter({});
    mockSupabaseModule(rpc);
    const trySync = jest.fn().mockResolvedValue(undefined);
    const hasPendingForOtherUser = jest.fn().mockResolvedValue(opts.hasPendingForOtherUser);
    jest.doMock('../../data', () => ({
      repository: { trySync, hasPendingForOtherUser },
    }));
    return { rpc, trySync, hasPendingForOtherUser };
  }

  it('blocks a profile switch while a different profile still has writes stuck in the offline queue', async () => {
    jest.resetModules();
    const { rpc, trySync, hasPendingForOtherUser } = setupSupabaseModeWithQueueGuard({ hasPendingForOtherUser: true });
    const AsyncStorage = require('@react-native-async-storage/async-storage');
    await AsyncStorage.clear();
    const { useAuthStore } = require('../authStore');

    await expect(useAuthStore.getState().signIn('user-2')).rejects.toBeTruthy();

    expect(trySync).toHaveBeenCalled(); // tries to flush under the OLD claim first
    expect(hasPendingForOtherUser).toHaveBeenCalledWith('user-2');
    expect(rpc).not.toHaveBeenCalledWith('claim_family_profile', expect.anything()); // never even attempts the claim
    expect(useAuthStore.getState().currentUserId).toBeNull();
  });

  it('the blocked-switch error surfaces through claimErrorMessage() as a friendly, specific message', async () => {
    jest.resetModules();
    setupSupabaseModeWithQueueGuard({ hasPendingForOtherUser: true });
    const AsyncStorage = require('@react-native-async-storage/async-storage');
    await AsyncStorage.clear();
    const { useAuthStore } = require('../authStore');
    const { claimErrorMessage } = require('../../screens/LoginScreen');

    let caught: unknown;
    try {
      await useAuthStore.getState().signIn('user-2');
    } catch (err) {
      caught = err;
    }

    expect(claimErrorMessage(caught)).toMatch(/פעולות ממתינות לסנכרון/);
  });

  it('proceeds normally once nothing is pending for a different profile (the common, already-synced case)', async () => {
    jest.resetModules();
    const { rpc } = setupSupabaseModeWithQueueGuard({ hasPendingForOtherUser: false });
    const AsyncStorage = require('@react-native-async-storage/async-storage');
    await AsyncStorage.clear();
    const { useAuthStore } = require('../authStore');

    await useAuthStore.getState().signIn('user-2');

    expect(rpc).toHaveBeenCalledWith('claim_family_profile', { target_user_id: 'user-2' });
    expect(useAuthStore.getState().currentUserId).toBe('user-2');
  });

  // COMPLETION PASS — 7E adversarial check: the SAME guard must also cover
  // signInWithPin() (the claim-TRANSFER path), not just the plain claim
  // path — a device with unflushed writes for its OLD profile must not be
  // able to transfer a DIFFERENT profile's claim onto itself either.
  it('also blocks a PIN-based claim TRANSFER while a different profile still has writes stuck in the offline queue', async () => {
    jest.resetModules();
    const { rpc, hasPendingForOtherUser } = setupSupabaseModeWithQueueGuard({ hasPendingForOtherUser: true });
    const AsyncStorage = require('@react-native-async-storage/async-storage');
    await AsyncStorage.clear();
    const { useAuthStore } = require('../authStore');

    await expect(useAuthStore.getState().signInWithPin('user-2', '1234')).rejects.toBeTruthy();

    expect(hasPendingForOtherUser).toHaveBeenCalledWith('user-2');
    expect(rpc).not.toHaveBeenCalledWith('claim_family_profile_with_pin', expect.anything());
    expect(useAuthStore.getState().currentUserId).toBeNull();
  });
});

/**
 * ROOT-CAUSE FIX regression tests for "no active profile claimed on this
 * family" (see the final report's Idan investigation and
 * checkClaimStillValid()'s doc comment in authStore.ts): restoreSession()
 * must detect — via the new whoami() round trip — when this device's
 * locally-cached currentUserId no longer matches what the server's own
 * auth identity has actually claimed, and recover by clearing it rather
 * than silently proceeding into a broken "signed in but every write fails"
 * state that a plain sign-out/sign-in could never fix on its own.
 */
describe('authStore — stale claim detection (whoami)', () => {
  afterEach(() => {
    process.env = ORIGINAL_ENV;
  });

  // ROUND-3 FIX (test-only, root cause of 4 real-Jest failures): restoreSession()
  // has a pre-existing, UNRELATED-to-whoami sanitization guard —
  // `if (isSupabaseConfigured && savedUser && !isUuid(savedUser))` — that
  // treats any non-UUID-shaped cached currentUserId as corrupted AsyncStorage
  // and discards it (see authStore.ts). These tests previously seeded
  // AsyncStorage with the literal string 'idan' as a stand-in for "Idan's
  // profile id" — a human-readable placeholder, not a real users.id. In
  // Supabase mode (which every test in this describe block runs in), that
  // guard fires on 'idan' BEFORE the whoami-based check ever runs, wiping
  // currentUserId to null unconditionally — exactly the symptom reported
  // ("Expected currentUserId = 'idan', Received null"), for a reason that
  // has nothing to do with whoami()/end_impersonation mock routing. This is
  // a test-fixture defect (category B), not a restoreSession() implementation
  // defect: the guard itself is correct and existed to protect against real
  // AsyncStorage corruption, and every real users.id in this app IS a uuid.
  // Fixed by using a real UUID-shaped id for "Idan" throughout this describe
  // block instead of the bare word.
  const IDAN_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

  function setupSupabaseModeForRestore() {
    jest.resetModules();
    process.env = {
      ...ORIGINAL_ENV,
      EXPO_PUBLIC_SUPABASE_URL: 'https://example.supabase.co',
      EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'anon-key',
    };
  }

  it('a cached currentUserId that still matches the server claim survives restoreSession unchanged', async () => {
    setupSupabaseModeForRestore();
    const rpc = rpcRouter({
      current_family_role: () => ({ data: 'member', error: null }),
      whoami: () => whoAmIRow({ profile_id: IDAN_ID, real_profile_id: IDAN_ID, family_role: 'member' }),
    });
    mockSupabaseModule(rpc);
    const AsyncStorage = require('@react-native-async-storage/async-storage');
    await AsyncStorage.clear();
    await AsyncStorage.setItem('dog-walk-family:current-family-id', 'fam-1');
    await AsyncStorage.setItem('dog-walk-family:current-user-id', IDAN_ID);
    const { useAuthStore } = require('../authStore');

    await useAuthStore.getState().restoreSession();

    expect(useAuthStore.getState().currentUserId).toBe(IDAN_ID);
    expect(useAuthStore.getState().staleClaimRecovered).toBe(false);
  });

  it('a STALE cached currentUserId (server claim no longer matches) is cleared and flagged — the actual Idan scenario', async () => {
    setupSupabaseModeForRestore();
    const rpc = rpcRouter({
      current_family_role: () => ({ data: 'member', error: null }),
      // The server's real, auth.uid()-derived claim no longer resolves to
      // 'idan' at all (e.g. this device's anonymous session was silently
      // replaced) — exactly the drift a plain sign-out/sign-in cannot see.
      whoami: () => whoAmIRow({ profile_id: null, real_profile_id: null, family_role: 'member' }),
    });
    mockSupabaseModule(rpc);
    const AsyncStorage = require('@react-native-async-storage/async-storage');
    await AsyncStorage.clear();
    await AsyncStorage.setItem('dog-walk-family:current-family-id', 'fam-1');
    await AsyncStorage.setItem('dog-walk-family:current-user-id', IDAN_ID);
    const { useAuthStore } = require('../authStore');

    await useAuthStore.getState().restoreSession();

    expect(useAuthStore.getState().currentUserId).toBeNull();
    expect(useAuthStore.getState().staleClaimRecovered).toBe(true);
    expect(await AsyncStorage.getItem('dog-walk-family:current-user-id')).toBeNull();
    // COMPLETION PASS — 7D: staleClaimUserId names WHICH profile was lost,
    // captured before currentUserId was cleared, so LoginScreen can offer a
    // direct "התחבר מחדש כ-X" PIN-reclaim action instead of generic wording.
    expect(useAuthStore.getState().staleClaimUserId).toBe(IDAN_ID);
  });

  it('an offline/failed whoami() check does NOT sign anyone out — "no information" is never treated as a mismatch', async () => {
    setupSupabaseModeForRestore();
    const rpc = rpcRouter({
      current_family_role: () => ({ data: 'member', error: null }),
      whoami: () => ({ data: null, error: { message: 'network error' } }),
    });
    mockSupabaseModule(rpc);
    const AsyncStorage = require('@react-native-async-storage/async-storage');
    await AsyncStorage.clear();
    await AsyncStorage.setItem('dog-walk-family:current-family-id', 'fam-1');
    await AsyncStorage.setItem('dog-walk-family:current-user-id', IDAN_ID);
    const { useAuthStore } = require('../authStore');

    await useAuthStore.getState().restoreSession();

    expect(useAuthStore.getState().currentUserId).toBe(IDAN_ID);
    expect(useAuthStore.getState().staleClaimRecovered).toBe(false);
  });

  it('restoreSession ends any orphaned server-side impersonation session unconditionally, before resolving anything else (restart safety)', async () => {
    setupSupabaseModeForRestore();
    const rpc = rpcRouter({
      current_family_role: () => ({ data: 'admin', error: null }),
      whoami: () => whoAmIRow({ profile_id: 'admin-1', real_profile_id: 'admin-1', family_role: 'admin' }),
    });
    mockSupabaseModule(rpc);
    const AsyncStorage = require('@react-native-async-storage/async-storage');
    await AsyncStorage.clear();
    const { useAuthStore } = require('../authStore');

    await useAuthStore.getState().restoreSession();

    expect(rpc).toHaveBeenCalledWith('end_impersonation');
    expect(useAuthStore.getState().impersonatingUserId).toBeNull();
  });

  it('revalidateClaim() (foreground re-check) recovers a mid-session drift the same way restoreSession does', async () => {
    setupSupabaseModeForRestore();
    const rpc = rpcRouter({
      current_family_role: () => ({ data: 'member', error: null }),
      whoami: () => whoAmIRow({ profile_id: IDAN_ID, real_profile_id: IDAN_ID, family_role: 'member' }),
    });
    mockSupabaseModule(rpc);
    const AsyncStorage = require('@react-native-async-storage/async-storage');
    await AsyncStorage.clear();
    await AsyncStorage.setItem('dog-walk-family:current-family-id', 'fam-1');
    await AsyncStorage.setItem('dog-walk-family:current-user-id', IDAN_ID);
    const { useAuthStore } = require('../authStore');
    await useAuthStore.getState().restoreSession();
    expect(useAuthStore.getState().currentUserId).toBe(IDAN_ID);

    // Now the session drifts mid-use (e.g. the anon refresh token was
    // revoked hours into an already-open app) — whoami() starts returning
    // no match, without another restoreSession() ever running.
    rpc.mockImplementationOnce((name: string) =>
      name === 'whoami' ? Promise.resolve(whoAmIRow({ profile_id: null, real_profile_id: null })) : Promise.resolve({ data: null, error: null })
    );

    await useAuthStore.getState().revalidateClaim();

    expect(useAuthStore.getState().currentUserId).toBeNull();
    expect(useAuthStore.getState().staleClaimRecovered).toBe(true);
    expect(useAuthStore.getState().staleClaimUserId).toBe(IDAN_ID);
  });

  it('revalidateClaim() is a no-op when there is no currentUserId to check', async () => {
    setupSupabaseModeForRestore();
    const rpc = rpcRouter({});
    mockSupabaseModule(rpc);
    const AsyncStorage = require('@react-native-async-storage/async-storage');
    await AsyncStorage.clear();
    const { useAuthStore } = require('../authStore');

    await useAuthStore.getState().revalidateClaim();

    expect(rpc).not.toHaveBeenCalledWith('whoami');
  });
});

/**
 * REAL ADMIN QA / IMPERSONATION MODE — a separate, more powerful feature
 * from Admin Test Mode (see authStore.ts's doc comment on
 * impersonatingUserId). Unlike Test Mode, beginImpersonation()/
 * endImpersonation() actually call server RPCs (begin_impersonation/
 * end_impersonation, migrations/0006_qa_impersonation.sql) — these tests
 * cover the CLIENT-side gating and state management; the server's own
 * accept/reject logic (privilege escalation, cross-family, removed member)
 * is covered separately in supabase/manual_tests/0006_qa_impersonation_acl.sql.
 */
describe('authStore — real impersonation (QA mode)', () => {
  afterEach(() => {
    process.env = ORIGINAL_ENV;
  });

  async function setupAdminInSupabaseMode(rpc: jest.Mock) {
    jest.resetModules();
    process.env = {
      ...ORIGINAL_ENV,
      EXPO_PUBLIC_SUPABASE_URL: 'https://example.supabase.co',
      EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'anon-key',
    };
    mockSupabaseModule(rpc);
    jest.doMock('../../data', () => ({
      repository: { trySync: jest.fn().mockResolvedValue(undefined), hasPendingForOtherUser: jest.fn().mockResolvedValue(false) },
    }));
    const AsyncStorage = require('@react-native-async-storage/async-storage');
    await AsyncStorage.clear();
    const { useAuthStore } = require('../authStore');
    useAuthStore.setState({ familyRole: 'admin', familyId: 'fam-1', hydrated: true });
    await useAuthStore.getState().signIn('admin-1');
    return useAuthStore;
  }

  it('client-side gate: a non-admin (familyRole !== admin) cannot even attempt beginImpersonation — privilege escalation attempt', async () => {
    const rpc = rpcRouter({ current_family_role: () => ({ data: 'admin', error: null }),  begin_impersonation: () => ({ data: 'session-1', error: null }) });
    const useAuthStore = await setupAdminInSupabaseMode(rpc);
    useAuthStore.setState({ familyRole: 'member' });

    await expect(useAuthStore.getState().beginImpersonation('member-1')).rejects.toThrow();
    expect(rpc).not.toHaveBeenCalledWith('begin_impersonation', expect.anything());
    expect(useAuthStore.getState().impersonatingUserId).toBeNull();
  });

  it('a server-side rejection (e.g. cross-family, removed member) propagates and never sets impersonatingUserId', async () => {
    const rpc = rpcRouter({ current_family_role: () => ({ data: 'admin', error: null }), 
      begin_impersonation: () => ({ data: null, error: { message: 'you can only test as a member of your own family' } }),
    });
    const useAuthStore = await setupAdminInSupabaseMode(rpc);

    // The RPC error surfaces as a plain { message } object (the same shape
    // claimFamilyProfile()'s own rejections use — see claimErrorMessage()),
    // not necessarily a real Error instance, so this is checked by manually
    // catching rather than a content-matching .rejects.toThrow(regex).
    let caught: unknown;
    try {
      await useAuthStore.getState().beginImpersonation('member-other-family');
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeTruthy();
    expect(String((caught as { message?: string })?.message)).toMatch(/your own family/);
    expect(useAuthStore.getState().impersonatingUserId).toBeNull();
  });

  it('a successful begin_impersonation sets impersonatingUserId locally', async () => {
    const rpc = rpcRouter({ current_family_role: () => ({ data: 'admin', error: null }),  begin_impersonation: () => ({ data: 'session-1', error: null }) });
    const useAuthStore = await setupAdminInSupabaseMode(rpc);

    await useAuthStore.getState().beginImpersonation('member-1');

    expect(rpc).toHaveBeenCalledWith('begin_impersonation', { p_target_user_id: 'member-1' });
    expect(useAuthStore.getState().impersonatingUserId).toBe('member-1');
    // Never touches the real, authenticated identity.
    expect(useAuthStore.getState().currentUserId).toBe('admin-1');
    expect(useAuthStore.getState().familyRole).toBe('admin');
  });

  it('endImpersonation only clears local state once the RPC actually succeeds', async () => {
    const rpc = rpcRouter({ current_family_role: () => ({ data: 'admin', error: null }), 
      begin_impersonation: () => ({ data: 'session-1', error: null }),
      end_impersonation: () => ({ data: null, error: null }),
    });
    const useAuthStore = await setupAdminInSupabaseMode(rpc);
    await useAuthStore.getState().beginImpersonation('member-1');

    await useAuthStore.getState().endImpersonation();

    expect(useAuthStore.getState().impersonatingUserId).toBeNull();
  });

  it('endImpersonation leaves impersonatingUserId (and the banner) in place when the RPC fails (e.g. offline) — never optimistically restores admin', async () => {
    const rpc = rpcRouter({ current_family_role: () => ({ data: 'admin', error: null }), 
      begin_impersonation: () => ({ data: 'session-1', error: null }),
      end_impersonation: () => ({ data: null, error: { message: 'network error' } }),
    });
    const useAuthStore = await setupAdminInSupabaseMode(rpc);
    await useAuthStore.getState().beginImpersonation('member-1');

    // ROUND-3 FIX (test-only): the RPC error is a plain `{ message }` object
    // (the exact same shape claimFamilyProfile()'s/beginImpersonation()'s own
    // server rejections use throughout this file — see the "a server-side
    // rejection..." test above, which already documents avoiding
    // `.rejects.toThrow(regex)` for this reason), not necessarily a real
    // Error instance. This test previously used a bare `.rejects.toThrow()`
    // with no argument, which is NOT reliable for a non-Error rejection
    // value either — switched to the same manual catch + explicit
    // assertions already established elsewhere in this file, which
    // unambiguously proves both "it rejected" and "with the right reason"
    // regardless of the rejection's shape. Production behavior
    // (authStore.ts's endImpersonation()) is unchanged — audited and
    // confirmed correct: it awaits endImpersonationRpc() with no `.catch`,
    // so a failure here was always propagating; this was a test-assertion
    // defect, not an implementation defect.
    let caught: unknown;
    let resolved = false;
    try {
      await useAuthStore.getState().endImpersonation();
      resolved = true;
    } catch (err) {
      caught = err;
    }

    expect(resolved).toBe(false);
    expect(caught).toBeTruthy();
    expect(String((caught as { message?: string })?.message)).toMatch(/network error/);
    expect(useAuthStore.getState().impersonatingUserId).toBe('member-1');
  });

  it('beginImpersonation and enterTestMode are mutually exclusive', async () => {
    const rpc = rpcRouter({ current_family_role: () => ({ data: 'admin', error: null }),  begin_impersonation: () => ({ data: 'session-1', error: null }) });
    const useAuthStore = await setupAdminInSupabaseMode(rpc);

    useAuthStore.getState().enterTestMode('member-1');
    await expect(useAuthStore.getState().beginImpersonation('member-2')).rejects.toThrow();
    expect(useAuthStore.getState().impersonatingUserId).toBeNull();

    useAuthStore.getState().exitTestMode();
    await useAuthStore.getState().beginImpersonation('member-2');
    expect(useAuthStore.getState().impersonatingUserId).toBe('member-2');
    expect(() => useAuthStore.getState().enterTestMode('member-3')).toThrow();
  });

  /**
   * ORDERING BUG FIX (round 3 security review): an earlier draft of
   * signOut() checked `get().impersonatingUserId !== null` AFTER already
   * having set it to null in the same function — a condition that could
   * never be true, so end_impersonation() was NEVER actually attempted
   * despite the function's own comment claiming it was. NOTE: the single
   * pre-fix test that existed here ("signOut ends any active impersonation
   * session...") asserted `rpc` was called with 'end_impersonation' — but
   * that assertion passed even with the bug present, because `rpc` is
   * shared across the whole setup flow and signIn() (called by
   * setupAdminInSupabaseMode() below) ALSO unconditionally calls
   * end_impersonation as its own restart-safety measure — so that one
   * shared mock had already recorded a matching call before signOut() ever
   * ran, making the old test a false positive that didn't actually cover
   * this function. Tests A-E below isolate signOut()'s OWN behavior by
   * clearing recorded calls (`rpc.mockClear()`) immediately before invoking
   * it.
   */
  it('A. signOut while NOT impersonating -> no unnecessary end_impersonation call', async () => {
    const rpc = rpcRouter({ current_family_role: () => ({ data: 'admin', error: null }),  end_impersonation: () => ({ data: null, error: null }) });
    const useAuthStore = await setupAdminInSupabaseMode(rpc);
    // Never called beginImpersonation() — admin-1 is signed in, not impersonating anyone.
    rpc.mockClear();

    await useAuthStore.getState().signOut();

    expect(rpc).not.toHaveBeenCalledWith('end_impersonation');
    expect(useAuthStore.getState().currentUserId).toBeNull();
  });

  it('B/E. signOut while impersonating -> end_impersonation IS attempted, and impersonatingUserId is still non-null at the moment of that call (proves the check runs BEFORE local state is cleared, not after)', async () => {
    let impersonatingUserIdAtRpcCallTime: string | null = 'not-called';
    const rpc = rpcRouter({ current_family_role: () => ({ data: 'admin', error: null }), 
      begin_impersonation: () => ({ data: 'session-1', error: null }),
      end_impersonation: () => {
        impersonatingUserIdAtRpcCallTime = useAuthStore.getState().impersonatingUserId;
        return { data: null, error: null };
      },
    });
    const useAuthStore = await setupAdminInSupabaseMode(rpc);
    await useAuthStore.getState().beginImpersonation('member-1');
    rpc.mockClear();

    await useAuthStore.getState().signOut();

    expect(rpc).toHaveBeenCalledWith('end_impersonation');
    // The critical assertion: at the instant end_impersonation() was
    // called, local state still said 'member-1' — NOT null. If signOut()
    // regressed to checking impersonatingUserId AFTER clearing it (the
    // original bug), this handler would either never run at all, or would
    // observe `null` here.
    expect(impersonatingUserIdAtRpcCallTime).toBe('member-1');
  });

  it('C. successful end_impersonation -> local state (impersonatingUserId, currentUserId) is cleared', async () => {
    const rpc = rpcRouter({ current_family_role: () => ({ data: 'admin', error: null }), 
      begin_impersonation: () => ({ data: 'session-1', error: null }),
      end_impersonation: () => ({ data: null, error: null }),
    });
    const useAuthStore = await setupAdminInSupabaseMode(rpc);
    await useAuthStore.getState().beginImpersonation('member-1');

    await useAuthStore.getState().signOut();

    expect(useAuthStore.getState().impersonatingUserId).toBeNull();
    expect(useAuthStore.getState().currentUserId).toBeNull();
  });

  it('D. end_impersonation RPC failure/offline during signOut -> local sign-out still proceeds (fail-safe), and restoreSession remains able to recover the orphaned server-side session on next cold start', async () => {
    const rpc = rpcRouter({ current_family_role: () => ({ data: 'admin', error: null }), 
      begin_impersonation: () => ({ data: 'session-1', error: null }),
      end_impersonation: () => ({ data: null, error: { message: 'network error' } }),
    });
    const useAuthStore = await setupAdminInSupabaseMode(rpc);
    await useAuthStore.getState().beginImpersonation('member-1');

    // signOut() must not throw/reject even though end_impersonation failed —
    // an unreachable server must never block someone from signing out.
    await expect(useAuthStore.getState().signOut()).resolves.toBeUndefined();

    expect(useAuthStore.getState().currentUserId).toBeNull();
    expect(useAuthStore.getState().impersonatingUserId).toBeNull(); // local state cleared regardless

    // The cold-start backstop is unconditional (does not depend on any
    // locally-remembered "was impersonating" flag, which is now gone) —
    // simulating a fresh app launch must still (attempt to) clean up
    // whatever the server is still holding.
    rpc.mockClear();
    rpc.mockImplementation(() => Promise.resolve({ data: null, error: null })); // server now reachable again
    await useAuthStore.getState().restoreSession();
    expect(rpc).toHaveBeenCalledWith('end_impersonation');
  });

  it('signIn (switching profile without an app restart) also clears any stale local impersonation state', async () => {
    const rpc = rpcRouter({ current_family_role: () => ({ data: 'admin', error: null }), 
      begin_impersonation: () => ({ data: 'session-1', error: null }),
      end_impersonation: () => ({ data: null, error: null }),
    });
    const useAuthStore = await setupAdminInSupabaseMode(rpc);
    await useAuthStore.getState().beginImpersonation('member-1');
    expect(useAuthStore.getState().impersonatingUserId).toBe('member-1');

    await useAuthStore.getState().signIn('admin-1');

    expect(useAuthStore.getState().impersonatingUserId).toBeNull();
  });

  it('setFamilyId (create/join a different family) also ends any stale server-side impersonation session (round-2 fix: client/server drift)', async () => {
    const rpc = rpcRouter({ current_family_role: () => ({ data: 'admin', error: null }), 
      begin_impersonation: () => ({ data: 'session-1', error: null }),
      end_impersonation: () => ({ data: null, error: null }),
    });
    const useAuthStore = await setupAdminInSupabaseMode(rpc);
    await useAuthStore.getState().beginImpersonation('member-1');
    expect(useAuthStore.getState().impersonatingUserId).toBe('member-1');

    await useAuthStore.getState().setFamilyId('some-other-family');

    expect(rpc).toHaveBeenCalledWith('end_impersonation');
    expect(useAuthStore.getState().impersonatingUserId).toBeNull();
  });

  /**
   * clearImpersonationIfInvalid() — the round-3 audit's "member removal /
   * invalidation flows" item. No pre-existing code path cleared
   * impersonatingUserId based on the roster changing at all (only
   * clearTestModeIfInvalid() existed, for the separate, display-only Test
   * Mode) — this is a new safety net closing that gap, mirroring the
   * existing one. Not a security boundary (active_impersonation_target()
   * in 0006 already fails closed server-side the moment the target is
   * removed, independent of this ever running) — this only prevents a
   * stale client-side banner/effective-identity from lingering.
   */
  it('clearImpersonationIfInvalid ends the stale session (best-effort) and clears local state once the impersonated member is no longer active', async () => {
    const rpc = rpcRouter({ current_family_role: () => ({ data: 'admin', error: null }), 
      begin_impersonation: () => ({ data: 'session-1', error: null }),
      end_impersonation: () => ({ data: null, error: null }),
    });
    const useAuthStore = await setupAdminInSupabaseMode(rpc);
    await useAuthStore.getState().beginImpersonation('member-1');
    rpc.mockClear();

    useAuthStore.getState().clearImpersonationIfInvalid(['admin-1', 'member-2']); // member-1 no longer active

    expect(useAuthStore.getState().impersonatingUserId).toBeNull();
    expect(rpc).toHaveBeenCalledWith('end_impersonation');
  });

  it('clearImpersonationIfInvalid leaves an active impersonation session alone while the impersonated member is still active', async () => {
    const rpc = rpcRouter({ current_family_role: () => ({ data: 'admin', error: null }), 
      begin_impersonation: () => ({ data: 'session-1', error: null }),
    });
    const useAuthStore = await setupAdminInSupabaseMode(rpc);
    await useAuthStore.getState().beginImpersonation('member-1');
    rpc.mockClear();

    useAuthStore.getState().clearImpersonationIfInvalid(['admin-1', 'member-1']);

    expect(useAuthStore.getState().impersonatingUserId).toBe('member-1');
    expect(rpc).not.toHaveBeenCalledWith('end_impersonation');
  });

  /**
   * NARROW FIX PASS (Jest crash investigation — case A, stale test
   * fixture): this describe block's setupAdminInSupabaseMode() calls
   * signIn('admin-1'), and signIn() (via __signInCore(), unchanged
   * production code) unconditionally calls refreshFamilyRole() at the end
   * of every successful claim — a persona-anchoring guarantee from an
   * earlier pass in this engagement (see authStore.ts's own doc comment on
   * __signInCore() for why). Every test in this block used to build its
   * mocked `rpc` via rpcRouter({...}) WITHOUT a `current_family_role`
   * handler — so that refresh call hit rpcRouter()'s own default (`{data:
   * null, error: null}` for any unhandled RPC name), silently overwriting
   * the fixture's earlier `useAuthStore.setState({ familyRole: 'admin' })`
   * back to null the instant signIn() completed. beginImpersonation()'s
   * client-side gate (`if (familyRole !== 'admin') throw ...`) was then
   * correctly, faithfully enforcing itself against that (wrongly) resolved
   * null — the admin check itself was never broken; the fixture just never
   * actually established admin status via the real mechanism the app now
   * uses. Fixed by adding `current_family_role: () => ({ data: 'admin',
   * error: null })` to every rpcRouter({...}) call in this block (see the
   * describe block above, "refreshOwnRoleAfterChange", which already did
   * this correctly at every one of its own call sites — this block just
   * hadn't been updated to match). The two tests below are NEW, added per
   * this pass's requirement to also cover the real-switch interaction
   * end-to-end, now that the fixture genuinely establishes admin the right
   * way.
   */
  it('Dad/Admin real-switches to Idan/Member (signInWithPin) -> beginImpersonation now rejects, because the REAL actor is now a member', async () => {
    const rpc = rpcRouter({
      current_family_role: () => ({ data: 'admin', error: null }),
      begin_impersonation: () => ({ data: 'session-1', error: null }),
    });
    const useAuthStore = await setupAdminInSupabaseMode(rpc);
    expect(useAuthStore.getState().familyRole).toBe('admin'); // established via the real mechanism, not hardcoded

    // The real switch: Idan's PIN, resolving to a MEMBER persona this time.
    // whoAmIRow()'s default (see rpcRouter's own doc comment) confirms
    // whichever profile was last claimed, and getCurrentFamilyRole() is
    // re-read fresh by signInWithPin()'s own refreshFamilyRole() call — so
    // this override must come AFTER the admin fixture is set up, exactly
    // mirroring how a real device would experience this sequence.
    rpc.mockImplementation((name: string, args?: unknown) => {
      if (name === 'claim_family_profile_with_pin') return Promise.resolve({ data: null, error: null });
      if (name === 'whoami') {
        return Promise.resolve(
          whoAmIRow({ profile_id: 'idan', real_profile_id: 'idan', family_role: 'member' })
        );
      }
      if (name === 'current_family_role') return Promise.resolve({ data: 'member', error: null });
      if (name === 'current_family_is_qa') return Promise.resolve({ data: false, error: null });
      if (name === 'end_impersonation') return Promise.resolve({ data: null, error: null });
      return Promise.resolve({ data: null, error: null });
    });

    await useAuthStore.getState().signInWithPin('idan', '1234');
    expect(useAuthStore.getState().familyRole).toBe('member');

    await expect(useAuthStore.getState().beginImpersonation('member-2')).rejects.toThrow();
    expect(useAuthStore.getState().impersonatingUserId).toBeNull();
    // The client-side gate rejects before ever reaching the RPC — same
    // "fast, friendly rejection" contract as the plain member-persona case.
    expect(rpc).not.toHaveBeenCalledWith('begin_impersonation', expect.anything());
  });

  it('Idan/Member real-switches back to Dad/Admin (signInWithPin) -> beginImpersonation succeeds again', async () => {
    const rpc = rpcRouter({
      current_family_role: () => ({ data: 'member', error: null }),
    });
    // Start signed in as Idan/Member this time (setupAdminInSupabaseMode's
    // OWN initial signIn('admin-1') is immediately superseded below by the
    // real PIN switch back to Dad — this test cares about the STATE AFTER
    // that switch, not the helper's own starting point).
    const useAuthStore = await setupAdminInSupabaseMode(rpc);

    rpc.mockImplementation((name: string) => {
      if (name === 'claim_family_profile_with_pin') return Promise.resolve({ data: null, error: null });
      if (name === 'whoami') {
        return Promise.resolve(whoAmIRow({ profile_id: 'dad', real_profile_id: 'dad', family_role: 'admin' }));
      }
      if (name === 'current_family_role') return Promise.resolve({ data: 'admin', error: null });
      if (name === 'current_family_is_qa') return Promise.resolve({ data: false, error: null });
      if (name === 'begin_impersonation') return Promise.resolve({ data: 'session-1', error: null });
      if (name === 'end_impersonation') return Promise.resolve({ data: null, error: null });
      return Promise.resolve({ data: null, error: null });
    });

    await useAuthStore.getState().signInWithPin('dad', '4321');
    expect(useAuthStore.getState().familyRole).toBe('admin');

    await useAuthStore.getState().beginImpersonation('member-1');
    expect(useAuthStore.getState().impersonatingUserId).toBe('member-1');
  });

  it('a failed impersonation attempt (client-side gate rejection) never mutates impersonatingUserId or currentUserId', async () => {
    const rpc = rpcRouter({
      current_family_role: () => ({ data: 'admin', error: null }),
      begin_impersonation: () => ({ data: 'session-1', error: null }),
    });
    const useAuthStore = await setupAdminInSupabaseMode(rpc);
    useAuthStore.setState({ familyRole: 'member' }); // simulate a non-admin actor

    const currentUserIdBefore = useAuthStore.getState().currentUserId;
    const impersonatingUserIdBefore = useAuthStore.getState().impersonatingUserId;

    await expect(useAuthStore.getState().beginImpersonation('member-2')).rejects.toThrow();

    expect(useAuthStore.getState().currentUserId).toBe(currentUserIdBefore);
    expect(useAuthStore.getState().impersonatingUserId).toBe(impersonatingUserIdBefore);
    expect(useAuthStore.getState().impersonatingUserId).toBeNull();
  });
});

/**
 * ROUND-5 RACE FIX: Test Mode / Real Impersonation could previously both end
 * up active at once. Sequence that used to break: beginImpersonation()
 * passed its guards (impersonatingUserId still null) -> awaited
 * begin_impersonation RPC -> WHILE that await was pending, a concurrent
 * enterTestMode() call also passed its guard (impersonatingUserId still
 * null) and synchronously set testModeUserId -> the RPC then resolved and
 * set impersonatingUserId too, leaving BOTH non-null (invalid state), which
 * made guardTestModeMutation() wrongly block legitimate mutations during a
 * real impersonation session. Fixed with a new synchronous
 * `impersonationStarting` flag set before the await and cleared in a
 * try/finally, checked by enterTestMode() as an additional guard. Tests
 * below are lettered A-J to match the round-5 spec.
 */
describe('authStore — Test Mode / Real Impersonation mutual exclusion (round-5 race fix)', () => {
  afterEach(() => {
    process.env = ORIGINAL_ENV;
  });

  async function setupAdminInSupabaseMode(rpc: jest.Mock) {
    jest.resetModules();
    process.env = {
      ...ORIGINAL_ENV,
      EXPO_PUBLIC_SUPABASE_URL: 'https://example.supabase.co',
      EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'anon-key',
    };
    mockSupabaseModule(rpc);
    jest.doMock('../../data', () => ({
      repository: { trySync: jest.fn().mockResolvedValue(undefined), hasPendingForOtherUser: jest.fn().mockResolvedValue(false) },
    }));
    const AsyncStorage = require('@react-native-async-storage/async-storage');
    await AsyncStorage.clear();
    const { useAuthStore } = require('../authStore');
    useAuthStore.setState({ familyRole: 'admin', familyId: 'fam-1', hydrated: true });
    await useAuthStore.getState().signIn('admin-1');
    return useAuthStore;
  }

  /** A deferred/controllable promise so a test can hold an RPC "in flight". */
  function deferred<T>() {
    let resolve!: (v: T) => void;
    let reject!: (e: unknown) => void;
    const promise = new Promise<T>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    return { promise, resolve, reject };
  }

  // A. Normal read-only Test Mode still works, and guardTestModeMutation blocks a mutation while active.
  it('A. entering Test Mode with nothing else active succeeds, and guardTestModeMutation blocks a mutation while it is active', async () => {
    const useAuthStore = await setupAdminInSupabaseMode(rpcRouter({ current_family_role: () => ({ data: 'admin', error: null }), }));
    const { guardTestModeMutation } = require('../../lib/testModeGuard');

    useAuthStore.getState().enterTestMode('member-1');

    expect(useAuthStore.getState().testModeUserId).toBe('member-1');
    expect(useAuthStore.getState().impersonatingUserId).toBeNull();
    expect(guardTestModeMutation()).toBe(false);
  });

  // B. Normal Real QA Impersonation works end-to-end; mutations allowed.
  it('B. a normal beginImpersonation resolves, sets impersonatingUserId, leaves testModeUserId null, and mutations are allowed', async () => {
    const rpc = rpcRouter({ current_family_role: () => ({ data: 'admin', error: null }),  begin_impersonation: () => ({ data: 'session-1', error: null }) });
    const useAuthStore = await setupAdminInSupabaseMode(rpc);
    const { guardTestModeMutation } = require('../../lib/testModeGuard');

    await useAuthStore.getState().beginImpersonation('member-1');

    expect(useAuthStore.getState().impersonatingUserId).toBe('member-1');
    expect(useAuthStore.getState().testModeUserId).toBeNull();
    expect(useAuthStore.getState().impersonationStarting).toBe(false);
    expect(guardTestModeMutation()).toBe(true);
  });

  // C. Test Mode active -> beginImpersonation rejects, no state change.
  it('C. beginImpersonation rejects while Test Mode is active, and does not touch impersonatingUserId/impersonationStarting', async () => {
    const rpc = rpcRouter({ current_family_role: () => ({ data: 'admin', error: null }),  begin_impersonation: () => ({ data: 'session-1', error: null }) });
    const useAuthStore = await setupAdminInSupabaseMode(rpc);
    useAuthStore.getState().enterTestMode('member-1');

    await expect(useAuthStore.getState().beginImpersonation('member-2')).rejects.toThrow();

    expect(useAuthStore.getState().impersonatingUserId).toBeNull();
    expect(useAuthStore.getState().impersonationStarting).toBe(false);
    expect(rpc).not.toHaveBeenCalledWith('begin_impersonation', expect.anything());
  });

  // D. Real impersonation active -> enterTestMode rejects, no state change.
  it('D. enterTestMode rejects while Real impersonation is active, and does not touch testModeUserId', async () => {
    const rpc = rpcRouter({ current_family_role: () => ({ data: 'admin', error: null }),  begin_impersonation: () => ({ data: 'session-1', error: null }) });
    const useAuthStore = await setupAdminInSupabaseMode(rpc);
    await useAuthStore.getState().beginImpersonation('member-1');

    expect(() => useAuthStore.getState().enterTestMode('member-2')).toThrow();
    expect(useAuthStore.getState().testModeUserId).toBeNull();
  });

  // E. THE RACE ITSELF: enterTestMode called mid-flight (RPC still pending) must reject.
  it('E. enterTestMode rejects while a beginImpersonation RPC is still pending (proves the race window is closed)', async () => {
    const { promise, resolve } = deferred<{ data: unknown; error: unknown }>();
    const rpc = rpcRouter({ current_family_role: () => ({ data: 'admin', error: null }),  begin_impersonation: () => promise as unknown as { data: unknown; error: unknown } });
    const useAuthStore = await setupAdminInSupabaseMode(rpc);

    const beginPromise = useAuthStore.getState().beginImpersonation('member-1');

    // Mid-flight: the RPC has not resolved yet, so impersonatingUserId is
    // still null — the OLD code would have let this through.
    expect(useAuthStore.getState().impersonatingUserId).toBeNull();
    expect(useAuthStore.getState().impersonationStarting).toBe(true);
    expect(() => useAuthStore.getState().enterTestMode('member-2')).toThrow();
    expect(useAuthStore.getState().testModeUserId).toBeNull();

    resolve({ data: 'session-1', error: null });
    await beginPromise;
    expect(useAuthStore.getState().impersonatingUserId).toBe('member-1');
  });

  // F. Post-success invariants.
  it('F. after a successful beginImpersonation: testModeUserId null, impersonatingUserId set, impersonationStarting false', async () => {
    const rpc = rpcRouter({ current_family_role: () => ({ data: 'admin', error: null }),  begin_impersonation: () => ({ data: 'session-1', error: null }) });
    const useAuthStore = await setupAdminInSupabaseMode(rpc);

    await useAuthStore.getState().beginImpersonation('member-1');

    expect(useAuthStore.getState().testModeUserId).toBeNull();
    expect(useAuthStore.getState().impersonatingUserId).toBe('member-1');
    expect(useAuthStore.getState().impersonationStarting).toBe(false);
  });

  // G. RPC rejection clears the flag and never sets testModeUserId.
  it('G. if beginImpersonationRpc rejects, impersonationStarting clears, impersonatingUserId stays null, testModeUserId untouched', async () => {
    const rpc = rpcRouter({ current_family_role: () => ({ data: 'admin', error: null }), 
      begin_impersonation: () => ({ data: null, error: { message: 'cross-family' } }),
    });
    const useAuthStore = await setupAdminInSupabaseMode(rpc);

    await expect(useAuthStore.getState().beginImpersonation('member-1')).rejects.toBeTruthy();

    expect(useAuthStore.getState().impersonationStarting).toBe(false);
    expect(useAuthStore.getState().impersonatingUserId).toBeNull();
    expect(useAuthStore.getState().testModeUserId).toBeNull();
  });

  // H. Forced-conflict / defense-in-depth path: testModeUserId somehow non-null when the RPC resolves.
  it('H. defense-in-depth: if testModeUserId is non-null when begin_impersonation resolves, the conflict is detected, cleanup is attempted, and impersonatingUserId stays null', async () => {
    const { promise, resolve } = deferred<{ data: unknown; error: unknown }>();
    let endCalled = false;
    const rpc = rpcRouter({ current_family_role: () => ({ data: 'admin', error: null }), 
      begin_impersonation: () => promise as unknown as { data: unknown; error: unknown },
      end_impersonation: () => {
        endCalled = true;
        return { data: null, error: null };
      },
    });
    const useAuthStore = await setupAdminInSupabaseMode(rpc);

    const beginPromise = useAuthStore.getState().beginImpersonation('member-1');
    // Force the invariant violation directly via the store's own set(), as
    // the spec allows, simulating the lock somehow having been bypassed.
    useAuthStore.setState({ testModeUserId: 'member-2' });
    resolve({ data: 'session-1', error: null });

    await expect(beginPromise).rejects.toThrow(/התנגשות/);

    expect(useAuthStore.getState().impersonatingUserId).toBeNull();
    expect(endCalled).toBe(true);
    expect(useAuthStore.getState().impersonationStarting).toBe(false);
  });

  // I. guardTestModeMutation: blocks during read-only Test Mode, allows during Real Impersonation.
  it('I. guardTestModeMutation blocks during Test Mode and allows during Real Impersonation', async () => {
    const rpc = rpcRouter({ current_family_role: () => ({ data: 'admin', error: null }),  begin_impersonation: () => ({ data: 'session-1', error: null }) });
    const useAuthStore = await setupAdminInSupabaseMode(rpc);
    const { guardTestModeMutation } = require('../../lib/testModeGuard');

    useAuthStore.getState().enterTestMode('member-1');
    expect(guardTestModeMutation()).toBe(false);
    useAuthStore.getState().exitTestMode();

    await useAuthStore.getState().beginImpersonation('member-1');
    expect(useAuthStore.getState().testModeUserId).toBeNull();
    expect(useAuthStore.getState().impersonatingUserId).toBe('member-1');
    expect(guardTestModeMutation()).toBe(true);
  });

  // J. Double-tap: two overlapping beginImpersonation calls cannot fire two concurrent RPCs or corrupt state.
  it('J. a second beginImpersonation call while the first is still pending rejects cleanly instead of firing a second RPC', async () => {
    const { promise, resolve } = deferred<{ data: unknown; error: unknown }>();
    let rpcCallCount = 0;
    const rpc = rpcRouter({ current_family_role: () => ({ data: 'admin', error: null }), 
      begin_impersonation: () => {
        rpcCallCount += 1;
        return promise as unknown as { data: unknown; error: unknown };
      },
    });
    const useAuthStore = await setupAdminInSupabaseMode(rpc);

    const first = useAuthStore.getState().beginImpersonation('member-1');
    await expect(useAuthStore.getState().beginImpersonation('member-1')).rejects.toThrow();
    await expect(useAuthStore.getState().beginImpersonation('member-2')).rejects.toThrow();

    expect(rpcCallCount).toBe(1); // only the first call ever reached the RPC

    resolve({ data: 'session-1', error: null });
    await first;
    expect(useAuthStore.getState().impersonatingUserId).toBe('member-1');

    // Double-tap after success (already impersonating) also rejects cleanly.
    await expect(useAuthStore.getState().beginImpersonation('member-3')).rejects.toThrow();
    expect(useAuthStore.getState().impersonatingUserId).toBe('member-1');
  });
});

/**
 * Round 7, Part 1/5 (requirement 9): FamilyScreen's role-management section
 * is gated on isRealFamilyAdmin(), not useEffectiveFamilyRole() — a normal
 * member must never see it, and neither must an impersonated member even
 * though the real admin is impersonating them (familyRole itself is never
 * touched by impersonation — see migrations/0006_qa_impersonation.sql — so
 * a plain `familyRole === 'admin'` check alone would wrongly show it during
 * an active impersonation session).
 */
describe('isRealFamilyAdmin', () => {
  it('true for a real admin, no impersonation active', async () => {
    const { isRealFamilyAdmin } = require('../authStore');
    expect(isRealFamilyAdmin('admin', null)).toBe(true);
  });

  it('false for a plain member, regardless of impersonation state', async () => {
    const { isRealFamilyAdmin } = require('../authStore');
    expect(isRealFamilyAdmin('member', null)).toBe(false);
    expect(isRealFamilyAdmin('member', 'someone-else')).toBe(false);
  });

  it('false for the real admin device while a real impersonation session is active', async () => {
    const { isRealFamilyAdmin } = require('../authStore');
    expect(isRealFamilyAdmin('admin', 'impersonated-member-id')).toBe(false);
  });

  it('false when familyRole has not resolved yet (null)', async () => {
    const { isRealFamilyAdmin } = require('../authStore');
    expect(isRealFamilyAdmin(null, null)).toBe(false);
  });
});

/**
 * Round 4 — invited-user redemption: completeInviteRedemption()/
 * retryPendingInviteRedemptionVerification()/restoreSession()'s pending-
 * redemption recovery. CORRECTED ORDERING per the approved Round 4 design
 * report: redeemFamilyInvite() (lib/invites.ts, exercised separately in
 * invites.test.ts) already succeeded server-side by the time any of these
 * are called — these tests cover ONLY the client-side commit/recovery
 * state machine: the pending marker is persisted BEFORE whoami()
 * verification, and familyId/currentUserId are committed ONLY after a
 * confirmed match — never the reverse, and never via
 * claimFamilyProfile()/joinFamily()/setFamilyId().
 */
describe('authStore — Round 4 invite redemption (completeInviteRedemption / pending recovery)', () => {
  afterEach(() => {
    process.env = ORIGINAL_ENV;
  });

  const PENDING_KEY = 'dog-walk-family:pending-invite-redemption';
  const FAMILY_KEY = 'dog-walk-family:current-family-id';
  const USER_KEY = 'dog-walk-family:current-user-id';
  const TARGET_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

  function setupSupabaseModeForRedemption(rpc: jest.Mock) {
    jest.resetModules();
    process.env = {
      ...ORIGINAL_ENV,
      EXPO_PUBLIC_SUPABASE_URL: 'https://example.supabase.co',
      EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'anon-key',
    };
    mockSupabaseModule(rpc);
  }

  it('whoami match -> commits familyId+currentUserId (both in-memory and AsyncStorage), clears the pending marker, returns "verified"', async () => {
    const rpc = rpcRouter({
      current_family_role: () => ({ data: 'member', error: null }),
      whoami: () => whoAmIRow({ profile_id: TARGET_ID, real_profile_id: TARGET_ID, family_role: 'member' }),
    });
    setupSupabaseModeForRedemption(rpc);
    const AsyncStorage = require('@react-native-async-storage/async-storage');
    await AsyncStorage.clear();
    const { useAuthStore } = require('../authStore');

    const outcome = await useAuthStore
      .getState()
      .completeInviteRedemption({ familyId: 'fam-invited', targetUserId: TARGET_ID });

    expect(outcome).toBe('verified');
    expect(useAuthStore.getState().familyId).toBe('fam-invited');
    expect(useAuthStore.getState().currentUserId).toBe(TARGET_ID);
    expect(useAuthStore.getState().pendingInviteRedemption).toBeNull();
    expect(await AsyncStorage.getItem(FAMILY_KEY)).toBe('fam-invited');
    expect(await AsyncStorage.getItem(USER_KEY)).toBe(TARGET_ID);
    expect(await AsyncStorage.getItem(PENDING_KEY)).toBeNull();

    // Never a second, independent claim/join attempt — redeem_family_invite
    // (0008/0009) already did the equivalent atomically, server-side.
    expect(rpc).not.toHaveBeenCalledWith('claim_family_profile', expect.anything());
    expect(rpc).not.toHaveBeenCalledWith('join_family', expect.anything());
  });

  it('whoami() throws/returns null -> familyId/currentUserId are NEVER written, the pending marker REMAINS in storage, returns "unverified"', async () => {
    const rpc = rpcRouter({
      whoami: () => ({ data: null, error: { message: 'network error' } }),
    });
    setupSupabaseModeForRedemption(rpc);
    const AsyncStorage = require('@react-native-async-storage/async-storage');
    await AsyncStorage.clear();
    const setItemSpy = jest.spyOn(AsyncStorage, 'setItem');
    const { useAuthStore } = require('../authStore');

    const outcome = await useAuthStore
      .getState()
      .completeInviteRedemption({ familyId: 'fam-invited', targetUserId: TARGET_ID });

    expect(outcome).toBe('unverified');
    expect(useAuthStore.getState().familyId).toBeNull();
    expect(useAuthStore.getState().currentUserId).toBeNull();
    expect(useAuthStore.getState().pendingInviteRedemption).toEqual({
      familyId: 'fam-invited',
      targetUserId: TARGET_ID,
    });
    // The pending marker (non-secret ids only) IS persisted — but FAMILY_KEY/USER_KEY never are.
    expect(await AsyncStorage.getItem(PENDING_KEY)).toBe(
      JSON.stringify({ familyId: 'fam-invited', targetUserId: TARGET_ID })
    );
    expect(setItemSpy).not.toHaveBeenCalledWith(FAMILY_KEY, expect.anything());
    expect(setItemSpy).not.toHaveBeenCalledWith(USER_KEY, expect.anything());
    setItemSpy.mockRestore();
  });

  it('whoami() resolves to a DIFFERENT profile than the one just redeemed -> no commit, pending marker cleared, returns "mismatch"', async () => {
    const rpc = rpcRouter({
      whoami: () => whoAmIRow({ profile_id: 'someone-else', real_profile_id: 'someone-else', family_role: 'member' }),
    });
    setupSupabaseModeForRedemption(rpc);
    const AsyncStorage = require('@react-native-async-storage/async-storage');
    await AsyncStorage.clear();
    const { useAuthStore } = require('../authStore');

    const outcome = await useAuthStore
      .getState()
      .completeInviteRedemption({ familyId: 'fam-invited', targetUserId: TARGET_ID });

    expect(outcome).toBe('mismatch');
    expect(useAuthStore.getState().familyId).toBeNull();
    expect(useAuthStore.getState().currentUserId).toBeNull();
    expect(useAuthStore.getState().pendingInviteRedemption).toBeNull();
    expect(await AsyncStorage.getItem(PENDING_KEY)).toBeNull();
  });

  it('the pending marker written to AsyncStorage contains ONLY familyId/targetUserId — never a token/rawToken field', async () => {
    const rpc = rpcRouter({
      whoami: () => ({ data: null, error: { message: 'network error' } }), // stays pending -> marker persists
    });
    setupSupabaseModeForRedemption(rpc);
    const AsyncStorage = require('@react-native-async-storage/async-storage');
    await AsyncStorage.clear();
    const { useAuthStore } = require('../authStore');

    await useAuthStore.getState().completeInviteRedemption({ familyId: 'fam-invited', targetUserId: TARGET_ID });

    const raw = await AsyncStorage.getItem(PENDING_KEY);
    const parsed = JSON.parse(raw as string);
    expect(Object.keys(parsed).sort()).toEqual(['familyId', 'targetUserId']);
    expect(JSON.stringify(parsed)).not.toMatch(/token/i);
  });

  it('retryPendingInviteRedemptionVerification: with a stored marker and whoami now succeeding -> commits and clears the marker, without ever calling redeemFamilyInvite/any lib/invites.ts RPC', async () => {
    const rpc = rpcRouter({
      current_family_role: () => ({ data: 'member', error: null }),
      whoami: () => whoAmIRow({ profile_id: TARGET_ID, real_profile_id: TARGET_ID, family_role: 'member' }),
    });
    setupSupabaseModeForRedemption(rpc);
    const AsyncStorage = require('@react-native-async-storage/async-storage');
    await AsyncStorage.clear();
    await AsyncStorage.setItem(PENDING_KEY, JSON.stringify({ familyId: 'fam-invited', targetUserId: TARGET_ID }));
    const { useAuthStore } = require('../authStore');

    const outcome = await useAuthStore.getState().retryPendingInviteRedemptionVerification();

    expect(outcome).toBe('verified');
    expect(useAuthStore.getState().familyId).toBe('fam-invited');
    expect(useAuthStore.getState().currentUserId).toBe(TARGET_ID);
    expect(await AsyncStorage.getItem(PENDING_KEY)).toBeNull();
    expect(rpc).not.toHaveBeenCalledWith('redeem_family_invite', expect.anything());
    expect(rpc).not.toHaveBeenCalledWith('inspect_family_invite', expect.anything());
  });

  it('retryPendingInviteRedemptionVerification: with no stored marker -> returns "none" and touches nothing', async () => {
    const rpc = rpcRouter({});
    setupSupabaseModeForRedemption(rpc);
    const AsyncStorage = require('@react-native-async-storage/async-storage');
    await AsyncStorage.clear();
    const { useAuthStore } = require('../authStore');

    const outcome = await useAuthStore.getState().retryPendingInviteRedemptionVerification();

    expect(outcome).toBe('none');
    expect(rpc).not.toHaveBeenCalledWith('whoami');
    expect(useAuthStore.getState().familyId).toBeNull();
  });

  it('restoreSession recovers a pending redemption automatically once whoami succeeds — no manual action required (cold-start recovery)', async () => {
    const rpc = rpcRouter({
      current_family_role: () => ({ data: 'member', error: null }),
      whoami: () => whoAmIRow({ profile_id: TARGET_ID, real_profile_id: TARGET_ID, family_role: 'member' }),
    });
    setupSupabaseModeForRedemption(rpc);
    const AsyncStorage = require('@react-native-async-storage/async-storage');
    await AsyncStorage.clear();
    await AsyncStorage.setItem(PENDING_KEY, JSON.stringify({ familyId: 'fam-invited', targetUserId: TARGET_ID }));
    const { useAuthStore } = require('../authStore');

    await useAuthStore.getState().restoreSession();

    expect(useAuthStore.getState().familyId).toBe('fam-invited');
    expect(useAuthStore.getState().currentUserId).toBe(TARGET_ID);
    expect(useAuthStore.getState().pendingInviteRedemption).toBeNull();
    expect(await AsyncStorage.getItem(PENDING_KEY)).toBeNull();
  });

  it('restoreSession leaves a pending redemption pending (and surfaces it) when whoami is still unreachable — offline cold start', async () => {
    const rpc = rpcRouter({
      whoami: () => ({ data: null, error: { message: 'network error' } }),
    });
    setupSupabaseModeForRedemption(rpc);
    const AsyncStorage = require('@react-native-async-storage/async-storage');
    await AsyncStorage.clear();
    await AsyncStorage.setItem(PENDING_KEY, JSON.stringify({ familyId: 'fam-invited', targetUserId: TARGET_ID }));
    const { useAuthStore } = require('../authStore');

    await useAuthStore.getState().restoreSession();

    expect(useAuthStore.getState().familyId).toBeNull();
    expect(useAuthStore.getState().currentUserId).toBeNull();
    expect(useAuthStore.getState().pendingInviteRedemption).toEqual({
      familyId: 'fam-invited',
      targetUserId: TARGET_ID,
    });
    expect(await AsyncStorage.getItem(PENDING_KEY)).toBe(
      JSON.stringify({ familyId: 'fam-invited', targetUserId: TARGET_ID })
    );
  });

  it('restoreSession never even looks for a pending marker when this device already has a restored currentUserId (nothing to recover)', async () => {
    const IDAN_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    const rpc = rpcRouter({
      current_family_role: () => ({ data: 'member', error: null }),
      whoami: () => whoAmIRow({ profile_id: IDAN_ID, real_profile_id: IDAN_ID, family_role: 'member' }),
    });
    setupSupabaseModeForRedemption(rpc);
    const AsyncStorage = require('@react-native-async-storage/async-storage');
    await AsyncStorage.clear();
    await AsyncStorage.setItem(FAMILY_KEY, 'fam-existing');
    await AsyncStorage.setItem(USER_KEY, IDAN_ID);
    // A leftover pending marker should never be resurrected onto an
    // already-restored, unrelated session.
    await AsyncStorage.setItem(PENDING_KEY, JSON.stringify({ familyId: 'fam-invited', targetUserId: TARGET_ID }));
    const { useAuthStore } = require('../authStore');

    await useAuthStore.getState().restoreSession();

    expect(useAuthStore.getState().familyId).toBe('fam-existing');
    expect(useAuthStore.getState().currentUserId).toBe(IDAN_ID);
    expect(useAuthStore.getState().pendingInviteRedemption).toBeNull();
    // The stale marker is left alone in this case (not this device's concern) —
    // only relevant while currentUserId is unresolved.
  });
});
