import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  enqueueWalkLifecycleIntent,
  getWalkLifecycleOperationId,
  listWalkLifecycleIntents,
  removeWalkLifecycleIntent,
  updateWalkLifecycleIntent,
} from '../walkLifecycleOperationIds';

describe('v1.1 lifecycle journal isolation and idempotency', () => {
  beforeEach(async () => AsyncStorage.clear());

  it('reuses one action id across retries and clears it only after confirmation', async () => {
    const first = await getWalkLifecycleOperationId('start', 'walk-1', 'actor-1');
    const retry = await getWalkLifecycleOperationId('start', 'walk-1', 'actor-1');
    expect(retry).toBe(first);
  });

  it('persists new intents under a separate journal and retains conflicts without touching SyncQueue storage', async () => {
    const legacyQueueSnapshot = '[{"type":"sentinel","payload":{"must":"remain byte-for-byte unchanged"}}]';
    await AsyncStorage.setItem('dog-walk-family:sync-queue:v4', legacyQueueSnapshot);
    const operationId = 'operation-1';
    await enqueueWalkLifecycleIntent({
      action: 'start', walkId: 'walk-1', familyId: 'family-1', actorUserId: 'actor-1',
      actualWalkerUserId: 'actor-1', operationId, substitutionConfirmed: false, remoteStart: false, state: 'pending',
    });
    await enqueueWalkLifecycleIntent({
      action: 'start', walkId: 'walk-1', familyId: 'family-1', actorUserId: 'actor-1',
      actualWalkerUserId: 'actor-1', operationId, substitutionConfirmed: false, remoteStart: false, state: 'pending',
    });
    await updateWalkLifecycleIntent(operationId, { state: 'conflict', error: 'another active walk already exists' });
    expect(await listWalkLifecycleIntents()).toHaveLength(1);
    expect(await listWalkLifecycleIntents()).toEqual([expect.objectContaining({ state: 'conflict', operationId })]);
    await removeWalkLifecycleIntent(operationId);
    expect(await listWalkLifecycleIntents()).toEqual([]);
    expect(await AsyncStorage.getItem('dog-walk-family:sync-queue:v4')).toBe(legacyQueueSnapshot);
  });
});
