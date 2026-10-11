const mockTrySync = jest.fn();
const mockPendingSyncCount = jest.fn();
const mockRpc = jest.fn();
const mockGetSession = jest.fn();

jest.mock('../../data', () => ({
  repository: {
    trySync: (...args: unknown[]) => mockTrySync(...args),
    pendingSyncCount: (...args: unknown[]) => mockPendingSyncCount(...args),
  },
}));
jest.mock('../supabase', () => ({
  supabase: {
    rpc: (...args: unknown[]) => mockRpc(...args),
    auth: { getSession: (...args: unknown[]) => mockGetSession(...args) },
  },
  SupabaseNotConfiguredError: class SupabaseNotConfiguredError extends Error {},
}));

import {
  createSystemAdminTestFamily,
  exitSystemAdminTestFamily,
  reenterExistingSystemAdminTestFamily,
  switchToSystemAdminTestFamily,
  TestFamilyReentryError,
} from '../systemAdmin';

describe('System Admin test-family sync preflight', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockTrySync.mockResolvedValue(undefined);
    mockPendingSyncCount.mockResolvedValue(0);
    mockGetSession.mockResolvedValue({ data: { session: { user: { id: 'verified-admin' } } }, error: null });
    mockRpc.mockResolvedValue({
      data: [{ id: 'qa-family', name: 'משפחת בדיקה', invite_code: 'QA1234' }],
      error: null,
    });
  });

  it('flushes and verifies active-family writes before creating a QA family', async () => {
    await expect(createSystemAdminTestFamily(' משפחת בדיקה ')).resolves.toEqual(
      expect.objectContaining({ familyId: 'qa-family', familyName: 'משפחת בדיקה' })
    );

    expect(mockTrySync).toHaveBeenCalledTimes(1);
    expect(mockPendingSyncCount).toHaveBeenCalledTimes(1);
    expect(mockTrySync.mock.invocationCallOrder[0]).toBeLessThan(mockPendingSyncCount.mock.invocationCallOrder[0]);
    expect(mockRpc).toHaveBeenCalledWith('system_admin_enter_test_family', { p_family_name: 'משפחת בדיקה' });
    expect(mockPendingSyncCount.mock.invocationCallOrder[0]).toBeLessThan(mockRpc.mock.invocationCallOrder[0]);
  });

  it('refuses to switch families while writes remain queued and leaves the RPC untouched', async () => {
    mockPendingSyncCount.mockResolvedValue(2);

    await expect(switchToSystemAdminTestFamily('qa-family')).rejects.toThrow(
      'נותרו 2 פעולות שממתינות לסנכרון'
    );
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it('distinguishes an authenticated RPC rejection and captures sanitized code/status diagnostics', async () => {
    const info = jest.spyOn(console, 'info').mockImplementation(() => undefined);
    mockRpc.mockResolvedValue({
      data: null,
      error: { code: '42501', status: 403, message: 'denied for person@example.com token eyJabcdefghijklmnop.abcdefgh.abcdefgh 123e4567-e89b-42d3-a456-426614174000' },
    });

    await expect(switchToSystemAdminTestFamily('qa-family')).rejects.toMatchObject({
      name: 'TestFamilyReentryError',
      stage: 'rpc',
      code: '42501',
      httpStatus: 403,
      userMessage: expect.stringContaining('השרת לא אישר'),
    });

    const diagnostic = info.mock.calls.map((args) => args.map(String).join(' ')).join('\\n');
    expect(diagnostic).toContain('"stage":"rpc","outcome":"failed"');
    expect(diagnostic).toContain('"code":"42501"');
    expect(diagnostic).toContain('"httpStatus":403');
    expect(diagnostic).not.toContain('qa-family');
    expect(diagnostic).not.toContain('person@example.com');
    expect(diagnostic).not.toContain('eyJabcdefghijklmnop');
    expect(diagnostic).not.toContain('123e4567-e89b-42d3-a456-426614174000');
    info.mockRestore();
  });

  it('stops before the RPC when the authenticated session is unavailable', async () => {
    mockGetSession.mockResolvedValue({ data: { session: null }, error: { status: 401, message: 'session expired' } });

    await expect(switchToSystemAdminTestFamily('qa-family')).rejects.toMatchObject({
      name: 'TestFamilyReentryError',
      stage: 'auth_session',
      httpStatus: 401,
      userMessage: expect.stringContaining('פג תוקף החיבור'),
    });
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it('re-enters the same existing test family after returning to the original family and resumes onboarding', async () => {
    const resume = jest.fn().mockResolvedValue(undefined);
    mockRpc
      .mockResolvedValueOnce({ data: [{ id: 'original-family', name: 'משפחה מקורית' }], error: null })
      .mockResolvedValueOnce({ data: [{ id: 'qa-family', name: 'משפחת בדיקה', invite_code: 'QA1234' }], error: null });

    const original = await exitSystemAdminTestFamily();
    const testFamily = await reenterExistingSystemAdminTestFamily('qa-family', resume);

    expect(original.id).toBe('original-family');
    expect(testFamily.familyId).toBe('qa-family');
    expect(resume).toHaveBeenCalledWith('qa-family', expect.stringMatching(/^qa-reentry-/));
    expect(mockRpc.mock.calls).toEqual([
      ['system_admin_exit_test_family'],
      ['system_admin_switch_test_family', { p_family_id: 'qa-family' }],
    ]);
    expect(mockPendingSyncCount).toHaveBeenCalledTimes(1);
  });

  it('reports resume failure separately after the server has re-entered the test family', async () => {
    const resume = jest.fn().mockRejectedValue(new Error('storage unavailable'));

    await expect(reenterExistingSystemAdminTestFamily('qa-family', resume)).rejects.toMatchObject({
      name: 'TestFamilyReentryError',
      stage: 'onboarding_resume',
      userMessage: expect.stringContaining('המעבר למשפחת הבדיקה הצליח'),
    });
    expect(mockRpc).toHaveBeenCalledWith('system_admin_switch_test_family', { p_family_id: 'qa-family' });
  });
});
