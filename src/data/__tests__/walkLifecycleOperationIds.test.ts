import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  enqueueWalkLifecycleIntent,
  completeWalkLifecycleOperation,
  getExistingWalkLifecycleOperationId,
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

  it('persists a stable duplicate-resolution UUID and never clears it on uncertain failure', async () => {
    const key = 'family-1:walk-a,walk-b,walk-c';
    const first = await getWalkLifecycleOperationId('resolve_duplicates', key, 'admin-1');
    expect(first).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
    await expect(getExistingWalkLifecycleOperationId('resolve_duplicates', key, 'admin-1')).resolves.toBe(first);
    await expect(getWalkLifecycleOperationId('resolve_duplicates', key, 'admin-1')).resolves.toBe(first);
    await completeWalkLifecycleOperation('resolve_duplicates', key, 'admin-1');
    await expect(getExistingWalkLifecycleOperationId('resolve_duplicates', key, 'admin-1')).resolves.toBeUndefined();
  });

  it('fails closed on a corrupt duplicate-resolution journal without touching SyncQueue', async () => {
    const sentinel = '[{"type":"quarantined","id":"must-not-change"}]';
    await AsyncStorage.setItem('dog-walk-family:sync-queue:v4', sentinel);
    await AsyncStorage.setItem('@walkie/walk-lifecycle-operation-ids-v1', '{broken json');
    await expect(getWalkLifecycleOperationId('resolve_duplicates', 'scope', 'admin-1')).rejects.toThrow(/idempotency journal/);
    await expect(getExistingWalkLifecycleOperationId('resolve_duplicates', 'scope', 'admin-1')).rejects.toThrow(/idempotency journal/);
    expect(await AsyncStorage.getItem('dog-walk-family:sync-queue:v4')).toBe(sentinel);
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
