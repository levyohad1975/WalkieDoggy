import type { Repository, ResolveDuplicateActiveWalksRequest } from '../repository';

const queueKey = 'dog-walk-family:sync-queue:v4';
const queueSentinel = '[{"operation":"quarantined-531-sentinel"}]';
const request: ResolveDuplicateActiveWalksRequest = {
  walkIds: ['walk-a', 'walk-b', 'walk-c'],
  canonicalWalkId: null,
  rationale: 'Confirmed test-generated duplicate active starts.',
  operationId: '98f834e2-89e4-4e1c-aafb-703f5e1a824f',
};

describe('OfflineFirstRepository duplicate resolution is online-only and queue-isolated', () => {
  beforeEach(() => jest.resetModules());

  it('sends the resolution directly to the authenticated remote and leaves SyncQueue byte-for-byte unchanged', async () => {
    jest.doMock('@react-native-community/netinfo', () => ({ __esModule: true, default: { fetch: jest.fn().mockResolvedValue({ isConnected: true, isInternetReachable: true }) } }));
    const AsyncStorage = require('@react-native-async-storage/async-storage');
    await AsyncStorage.clear();
    await AsyncStorage.setItem(queueKey, queueSentinel);
    const resolve = jest.fn().mockResolvedValue('audit-group');
    const remote = { resolveDuplicateActiveWalksV12: resolve } as unknown as Repository;
    const { OfflineFirstRepository } = require('../offlineFirstRepository');
    const repository = new OfflineFirstRepository(remote);

    await expect(repository.resolveDuplicateActiveWalksV12!(request)).resolves.toBe('audit-group');
    expect(resolve).toHaveBeenCalledWith(request);
    expect(await AsyncStorage.getItem(queueKey)).toBe(queueSentinel);
  });

  it('refuses to call the RPC while offline and leaves SyncQueue unchanged', async () => {
    jest.doMock('@react-native-community/netinfo', () => ({ __esModule: true, default: { fetch: jest.fn().mockResolvedValue({ isConnected: false, isInternetReachable: false }) } }));
    const AsyncStorage = require('@react-native-async-storage/async-storage');
    await AsyncStorage.clear();
    await AsyncStorage.setItem(queueKey, queueSentinel);
    const resolve = jest.fn();
    const remote = { resolveDuplicateActiveWalksV12: resolve } as unknown as Repository;
    const { OfflineFirstRepository } = require('../offlineFirstRepository');
    const repository = new OfflineFirstRepository(remote);

    await expect(repository.resolveDuplicateActiveWalksV12!(request)).rejects.toThrow(/no resolution request was sent/);
    expect(resolve).not.toHaveBeenCalled();
    expect(await AsyncStorage.getItem(queueKey)).toBe(queueSentinel);
  });
});
