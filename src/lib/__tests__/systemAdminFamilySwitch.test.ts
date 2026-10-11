const mockTrySync = jest.fn();
const mockPendingSyncCount = jest.fn();
const mockRpc = jest.fn();

jest.mock('../../data', () => ({
  repository: {
    trySync: (...args: unknown[]) => mockTrySync(...args),
    pendingSyncCount: (...args: unknown[]) => mockPendingSyncCount(...args),
  },
}));
jest.mock('../supabase', () => ({
  supabase: { rpc: (...args: unknown[]) => mockRpc(...args) },
  SupabaseNotConfiguredError: class SupabaseNotConfiguredError extends Error {},
}));

import { createSystemAdminTestFamily, switchToSystemAdminTestFamily } from '../systemAdmin';

describe('System Admin test-family sync preflight', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockTrySync.mockResolvedValue(undefined);
    mockPendingSyncCount.mockResolvedValue(0);
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
});
