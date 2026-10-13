import { OfflineFirstRepository } from '../offlineFirstRepository';

describe('OfflineFirstRepository.createUser', () => {
  const user = {
    id: 'user-new', familyId: 'family-main', name: 'עידן לוי', avatar: '🧑', color: '#000',
    remindersEnabled: true, gamificationEnabled: true, createdAt: '2026-09-30T00:00:00.000Z',
  } as any;

  it('confirms an online server INSERT instead of hiding a permanent failure in the queue', async () => {
    const remote = { createUser: jest.fn().mockRejectedValue(Object.assign(new Error('RLS denied'), { code: '42501' })) } as any;
    const repo = new OfflineFirstRepository(remote);
    jest.spyOn(repo as any, 'isOnline').mockResolvedValue(true);
    await expect(repo.createUser(user)).rejects.toThrow('RLS denied');
    expect(remote.createUser).toHaveBeenCalledWith(user);
  });
});
