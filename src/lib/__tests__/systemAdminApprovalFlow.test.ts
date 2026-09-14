import {
  commitFamilyApprovalAndRefresh,
  SystemAdminApprovalRefreshError,
} from '../systemAdminApprovalFlow';

/** Behavior-level coverage for the mutation/read boundary. */
describe('system admin approval flow', () => {
  it('marks the decision committed before refreshing server state', async () => {
    const order: string[] = [];
    const result = await commitFamilyApprovalAndRefresh({
      commit: async () => { order.push('commit'); },
      onCommitted: () => { order.push('committed-ui'); },
      refresh: async () => {
        order.push('refresh');
        return 'fresh';
      },
    });

    expect(result).toBe('fresh');
    expect(order).toEqual(['commit', 'committed-ui', 'refresh']);
  });

  it('distinguishes a post-commit refresh failure so stale actions stay disabled', async () => {
    const onCommitted = jest.fn();
    await expect(commitFamilyApprovalAndRefresh({
      commit: jest.fn().mockResolvedValue(undefined),
      onCommitted,
      refresh: jest.fn().mockRejectedValue(new Error('network down')),
    })).rejects.toBeInstanceOf(SystemAdminApprovalRefreshError);
    expect(onCommitted).toHaveBeenCalledTimes(1);
  });

  it('does not mark the action committed when the mutation itself fails', async () => {
    const onCommitted = jest.fn();
    const refresh = jest.fn();
    await expect(commitFamilyApprovalAndRefresh({
      commit: jest.fn().mockRejectedValue(new Error('permission denied')),
      onCommitted,
      refresh,
    })).rejects.toThrow('permission denied');
    expect(onCommitted).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
  });
});
