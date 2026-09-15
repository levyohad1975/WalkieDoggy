/**
 * BATCH 3 (Task 3 — per-member permission overrides, store wiring).
 * Isolated from familyStore.test.ts (which deliberately runs in local/demo
 * mode against the real local repository) so this file can freely mock
 * Supabase-mode-only collaborators (lib/supabase's isSupabaseConfigured,
 * lib/permissions's RPC/select wrappers) without needing a real Supabase
 * client or touching the local repository singleton at all.
 *
 * These tests cover the STORE-LEVEL wiring only — that setPermissionOverride/
 * clearPermissionOverride call the right lib/permissions.ts function with
 * the right params, reload permissionOverrides on success, and surface a
 * server rejection as actionError (with a rethrow, matching this store's
 * own addUser() precedent, so a caller like MemberDetailsModal can also
 * show its own inline error). The actual admin-gating/RLS lives server-side
 * in migration 0023's RPCs (see lib/__tests__/permissions.test.ts for the
 * client-call-shape coverage of those, and logic/__tests__/permissions.test.ts
 * for the "override, else role default" resolver rule itself).
 *
 * BATCH 3 CORRECTION #2 (post-review) ADDS: permissionOverridesStatus
 * coverage — loadPermissionOverrides() must go 'loading' synchronously (the
 * instant it's called, before the RPC resolves) and then either 'loaded' or
 * 'error', since this is what logic/permissions.ts's
 * canAccessHistoryScreen()/canAccessStatisticsScreen() rely on to fail
 * closed while state is unverified. The review's exact five scenarios
 * (loading/unknown, load failure, explicit false, no override after a
 * successful load, clearing restores the default) are the resolver-level
 * concern already covered by logic/__tests__/permissions.test.ts; this file
 * covers that the STORE actually produces those statuses correctly.
 */
describe('familyStore — permission override wiring (Supabase mode, Task 3)', () => {
  let listMemberPermissionOverrides: jest.Mock;
  let setMemberPermissionOverride: jest.Mock;
  let clearMemberPermissionOverride: jest.Mock;
  let useFamilyStore: typeof import('../familyStore').useFamilyStore;

  beforeEach(() => {
    jest.resetModules();

    listMemberPermissionOverrides = jest.fn().mockResolvedValue([
      { userId: 'user-1', permissionKey: 'view_history', allowed: false },
    ]);
    setMemberPermissionOverride = jest.fn().mockResolvedValue(undefined);
    clearMemberPermissionOverride = jest.fn().mockResolvedValue(undefined);

    // isSupabaseConfigured: true, but no `supabase` client export — data/
    // index.ts's `isSupabaseConfigured && supabase ? new SupabaseRepository(...) : null`
    // then short-circuits to `null` (falsy `supabase`), so the repository
    // singleton never constructs a real Supabase client even though this
    // mock reports Supabase as configured. None of the three actions under
    // test here touch `repository` at all, so this is just belt-and-suspenders.
    jest.doMock('../../lib/supabase', () => ({ isSupabaseConfigured: true }));
    jest.doMock('../../lib/permissions', () => ({
      listMemberPermissionOverrides,
      setMemberPermissionOverride,
      clearMemberPermissionOverride,
    }));
    jest.doMock('../../lib/testModeGuard', () => ({
      guardTestModeMutation: () => true,
      TEST_MODE_READ_ONLY_MESSAGE: 'read-only',
    }));

    ({ useFamilyStore } = require('../familyStore'));
  });

  it('loadPermissionOverrides populates permissionOverrides from lib/permissions', async () => {
    await useFamilyStore.getState().loadPermissionOverrides();
    expect(useFamilyStore.getState().permissionOverrides).toEqual([
      { userId: 'user-1', permissionKey: 'view_history', allowed: false },
    ]);
  });

  it('loadPermissionOverrides sets permissionOverridesStatus to "loading" synchronously, before the RPC resolves', () => {
    expect(useFamilyStore.getState().permissionOverridesStatus).toBe('idle');
    const promise = useFamilyStore.getState().loadPermissionOverrides();
    // Still synchronous at this point — the RPC mock's Promise has not
    // resolved yet, but the status flip already happened (it's the first
    // thing loadPermissionOverrides does, before its first `await`).
    expect(useFamilyStore.getState().permissionOverridesStatus).toBe('loading');
    return promise;
  });

  it('loadPermissionOverrides resolves permissionOverridesStatus to "loaded" on success', async () => {
    await useFamilyStore.getState().loadPermissionOverrides();
    expect(useFamilyStore.getState().permissionOverridesStatus).toBe('loaded');
  });

  it('loadPermissionOverrides resolves permissionOverridesStatus to "error" (not "loaded") on failure, and leaves permissionOverrides as it was — never treated as "loaded, no override"', async () => {
    listMemberPermissionOverrides.mockRejectedValueOnce(new Error('network down'));

    await useFamilyStore.getState().loadPermissionOverrides();

    expect(useFamilyStore.getState().permissionOverridesStatus).toBe('error');
    // Unchanged from its initial value — this test's beforeEach never ran a
    // successful load first, so it's still the store's default `[]`. The
    // point is that a fail-closed caller must key off `status`, not assume
    // `[]` here means "loaded, nothing overridden".
    expect(useFamilyStore.getState().permissionOverrides).toEqual([]);
  });

  it('setPermissionOverride (Family Admin sets an explicit override) calls the RPC wrapper and reloads', async () => {
    await useFamilyStore.getState().setPermissionOverride('user-2', 'view_statistics', false);
    expect(setMemberPermissionOverride).toHaveBeenCalledWith('user-2', 'view_statistics', false);
    expect(listMemberPermissionOverrides).toHaveBeenCalled();
    expect(useFamilyStore.getState().permissionOverrides).toEqual([
      { userId: 'user-1', permissionKey: 'view_history', allowed: false },
    ]);
  });

  it('clearPermissionOverride (revert to role default) calls the RPC wrapper and reloads', async () => {
    await useFamilyStore.getState().clearPermissionOverride('user-1', 'view_history');
    expect(clearMemberPermissionOverride).toHaveBeenCalledWith('user-1', 'view_history');
    expect(listMemberPermissionOverrides).toHaveBeenCalled();
  });

  it('setPermissionOverride surfaces a server rejection ("admin permission required") as actionError AND rethrows for the caller', async () => {
    setMemberPermissionOverride.mockRejectedValueOnce(new Error('admin permission required'));

    await expect(useFamilyStore.getState().setPermissionOverride('user-2', 'view_history', false)).rejects.toThrow();
    expect(useFamilyStore.getState().actionError).toBe('רק מנהל/ת יכולים לבצע פעולה זו.');
  });

  it('clearPermissionOverride surfaces a server rejection as actionError AND rethrows for the caller', async () => {
    clearMemberPermissionOverride.mockRejectedValueOnce(new Error('admin permission required'));

    await expect(useFamilyStore.getState().clearPermissionOverride('user-1', 'view_history')).rejects.toThrow();
    expect(useFamilyStore.getState().actionError).toBe('רק מנהל/ת יכולים לבצע פעולה זו.');
  });
});

/**
 * BATCH 3 CORRECTION #2 (post-review): local/demo mode has no per-member
 * permission concept and no server round-trip to wait on at all — every
 * member simply gets the role default (see logic/permissions.ts's own doc
 * comment). permissionOverridesStatus must go straight to 'loaded' there
 * (not stay 'idle'/'loading' forever), or canAccessHistoryScreen()/
 * canAccessStatisticsScreen() would incorrectly fail closed for every
 * local/demo user forever, which would be a regression of existing,
 * approved local/demo behavior.
 */
describe('familyStore — permission override loading in local/demo mode (Task 3 / correction #2)', () => {
  let useFamilyStore: typeof import('../familyStore').useFamilyStore;

  beforeEach(() => {
    jest.resetModules();
    jest.doMock('../../lib/supabase', () => ({ isSupabaseConfigured: false }));
    jest.doMock('../../lib/permissions', () => ({
      listMemberPermissionOverrides: jest.fn(),
      setMemberPermissionOverride: jest.fn(),
      clearMemberPermissionOverride: jest.fn(),
    }));
    jest.doMock('../../lib/testModeGuard', () => ({
      guardTestModeMutation: () => true,
      TEST_MODE_READ_ONLY_MESSAGE: 'read-only',
    }));

    ({ useFamilyStore } = require('../familyStore'));
  });

  it('resolves permissionOverridesStatus to "loaded" (with an empty permissionOverrides array) immediately, with no server round-trip', async () => {
    await useFamilyStore.getState().loadPermissionOverrides();
    expect(useFamilyStore.getState().permissionOverridesStatus).toBe('loaded');
    expect(useFamilyStore.getState().permissionOverrides).toEqual([]);
  });
});

/**
 * addUser's "no active family" guard (familyStore.ts lines ~190-194): in
 * Supabase mode, before `load()` has resolved a `family` AND this device's
 * joined familyId (authStore) is also not yet known, there is genuinely no
 * family to attach the new member to. This must reject with a friendly
 * Hebrew actionError rather than silently building a user record with an
 * undefined/empty familyId that would fail confusingly server-side.
 */
describe('familyStore — addUser with no resolvable family (Supabase mode, family not yet loaded)', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.doMock('../../lib/supabase', () => ({ isSupabaseConfigured: true }));
    jest.doMock('../../lib/testModeGuard', () => ({
      guardTestModeMutation: () => true,
      TEST_MODE_READ_ONLY_MESSAGE: 'read-only',
    }));
  });

  it('rejects with a friendly Hebrew error and never calls repository.createUser', async () => {
    const { useFamilyStore } = require('../familyStore');
    const { useAuthStore } = require('../authStore');
    const { repository } = require('../../data');

    useAuthStore.setState({ familyId: null });
    const spy = jest.spyOn(repository, 'createUser');

    await expect(
      useFamilyStore.getState().addUser({ name: 'חדש', avatar: '🐶', color: '#000' })
    ).rejects.toThrow('לא נמצאה משפחה פעילה');

    expect(useFamilyStore.getState().actionError).toBe('לא נמצאה משפחה פעילה');
    expect(spy).not.toHaveBeenCalled();

    spy.mockRestore();
  });
});
