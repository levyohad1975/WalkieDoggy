const mockRpc = jest.fn();
const mockStorageRemove = jest.fn();

jest.mock('../../data', () => ({ repository: {} }));
jest.mock('../supabase', () => ({
  supabase: {
    rpc: (...args: unknown[]) => mockRpc(...args),
    storage: { from: (bucket: string) => ({ remove: (paths: string[]) => mockStorageRemove(bucket, paths) }) },
  },
  SupabaseNotConfiguredError: class SupabaseNotConfiguredError extends Error {},
}));

import { getSystemAdminFamilyDeletionImpact, permanentlyDeleteSystemAdminFamily } from '../systemAdmin';

describe('permanent System Admin family deletion client orchestration', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRpc.mockImplementation(async (name: string) => {
      if (name === 'system_admin_family_deletion_impact') return { data: {
        family_id: 'fixture-family', family_name: 'משפחה זמנית', invite_code: 'FIXTURE', approval_status: 'active',
        state: 'ready', counts: { users: 2, dogs: 1 }, total_rows: 4, storage_objects: 2,
      }, error: null };
      if (name === 'system_admin_list_family_deletion_storage_objects') return { data: [
        { bucket_id: 'family-photos', object_name: 'fixture-family/dog.png' },
        { bucket_id: 'chat-attachments', object_name: 'conversation/profile/message.jpg' },
        { bucket_id: 'unknown', object_name: 'must-not-delete' },
      ], error: null };
      return { data: null, error: null };
    });
    mockStorageRemove.mockResolvedValue({ data: [], error: null });
  });

  it('maps the server impact manifest without trusting client-computed counts', async () => {
    await expect(getSystemAdminFamilyDeletionImpact('fixture-family')).resolves.toEqual({
      familyId: 'fixture-family', familyName: 'משפחה זמנית', inviteCode: 'FIXTURE', approvalStatus: 'active',
      state: 'ready', counts: { users: 2, dogs: 1 }, totalRows: 4, storageObjects: 2,
    });
  });

  it('requires server impact review, the typed name, storage cleanup, then transactional finalization', async () => {
    const impact = await getSystemAdminFamilyDeletionImpact('fixture-family');
    await permanentlyDeleteSystemAdminFamily(impact, 'משפחה זמנית');

    expect(mockRpc.mock.calls.map(([name]) => name)).toEqual([
      'system_admin_family_deletion_impact',
      'system_admin_begin_family_deletion',
      'system_admin_list_family_deletion_storage_objects',
      'system_admin_finalize_family_deletion',
    ]);
    expect(mockRpc).toHaveBeenCalledWith('system_admin_begin_family_deletion', expect.objectContaining({
      p_family_id: 'fixture-family', p_confirmation_name: 'משפחה זמנית',
      p_confirmation_phrase: 'DELETE FAMILY PERMANENTLY', p_expected_counts: { users: 2, dogs: 1 },
    }));
    expect(mockStorageRemove).toHaveBeenCalledTimes(2);
    expect(mockStorageRemove).toHaveBeenCalledWith('family-photos', ['fixture-family/dog.png']);
    expect(mockStorageRemove).toHaveBeenCalledWith('chat-attachments', ['conversation/profile/message.jpg']);
    expect(mockRpc.mock.invocationCallOrder[3]).toBeGreaterThan(mockStorageRemove.mock.invocationCallOrder[1]);
  });

  it('does not finalize or continue after a Storage API failure so the frozen deletion can be retried', async () => {
    mockStorageRemove.mockResolvedValueOnce({ data: null, error: new Error('storage unavailable') });
    const impact = await getSystemAdminFamilyDeletionImpact('fixture-family');
    await expect(permanentlyDeleteSystemAdminFamily(impact, 'משפחה זמנית')).rejects.toThrow('storage unavailable');
    expect(mockRpc).toHaveBeenCalledTimes(3);
    expect(mockRpc).not.toHaveBeenCalledWith('system_admin_finalize_family_deletion', expect.anything());
  });

  it('uses authenticated client RPCs and Storage API only (no service-role or SyncQueue access)', async () => {
    const impact = await getSystemAdminFamilyDeletionImpact('fixture-family');
    await permanentlyDeleteSystemAdminFamily(impact, 'משפחה זמנית');
    expect(mockStorageRemove).toHaveBeenCalled();
    expect(mockRpc.mock.calls.every(([name]) => String(name).startsWith('system_admin_'))).toBe(true);
  });
});
