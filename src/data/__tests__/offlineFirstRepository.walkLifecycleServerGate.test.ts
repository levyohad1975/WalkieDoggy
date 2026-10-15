import type { Repository } from '../repository';
import type { Walk } from '../../types';

/**
 * P0 real-iPhone (2026-10-15): a Walk Lifecycle v1.1 client deployed against a
 * Staging database without the v1.1 migration called start_walk_v11 and got
 * PGRST202. The client chose v1.1 only because the method existed in code.
 *
 * The offline-first layer now asks the server first and fails closed before
 * creating ANY local provisional state or outbox intent. It never falls back
 * to the legacy start_walk()/finish_walk(), which do not enforce one active
 * walk per dog.
 */
function walkFixture(overrides: Partial<Walk> = {}): Walk {
  return {
    id: 'walk-1',
    familyId: 'family-1',
    scheduleEntryId: 'entry-1',
    dogId: 'dog-1',
    date: '2026-10-15',
    scheduledTime: '08:00',
    responsibleUserId: 'user-1',
    status: 'pending',
    createdAt: '2026-10-15T05:00:00.000Z',
    updatedAt: '2026-10-15T05:00:00.000Z',
    ...overrides,
  };
}

const startAuthorization = { actorUserId: 'user-1', actualWalkerUserId: 'user-1', operationId: 'op-start' };

describe('OfflineFirstRepository — Walk Lifecycle v1.1 server version gate', () => {
  let netinfoFetch: jest.Mock;

  beforeEach(async () => {
    jest.resetModules();
    netinfoFetch = jest.fn().mockResolvedValue({ isConnected: true, isInternetReachable: true });
    jest.doMock('@react-native-community/netinfo', () => ({ __esModule: true, default: { fetch: netinfoFetch } }));
    const AsyncStorage = require('@react-native-async-storage/async-storage');
    await AsyncStorage.clear();
    require('../syncQueue').setSyncQueueActorGetter(() => 'user-1');
  });

  afterEach(() => {
    require('../syncQueue').setSyncQueueActorGetter(() => null);
  });

  function setup(remoteOverrides: Partial<Repository> = {}) {
    const { LocalRepository } = require('../localRepository');
    const { OfflineFirstRepository } = require('../offlineFirstRepository');
    const walk = walkFixture();
    const started = { ...walk, status: 'in_progress' as const, startedAt: '2026-10-15T05:10:00.000Z', actualWalkerUserId: 'user-1' };
    const remote = {
      getWalks: jest.fn().mockResolvedValue([walk]),
      saveWalk: jest.fn().mockResolvedValue(undefined),
      getWalkLifecycleCapability: jest.fn().mockResolvedValue({ status: 'supported', checkedAt: 't' }),
      startWalkV11: jest.fn().mockResolvedValue(started),
      startSpontaneousWalkV11: jest.fn(),
      finishWalkV11: jest.fn(),
      acquireGpsOwnershipV11: jest.fn().mockResolvedValue({ fencingEpoch: 1, expiresAt: 'x' }),
      ...remoteOverrides,
    } as unknown as Repository & Record<string, jest.Mock>;
    return { repo: new OfflineFirstRepository(remote), remote, walk, started, LocalRepository };
  }

  it('refuses a start on a server without v1.1 before any local change, outbox intent or v1.1 RPC', async () => {
    const { repo, remote, walk, LocalRepository } = setup({
      getWalkLifecycleCapability: jest.fn().mockResolvedValue({ status: 'not_installed', checkedAt: 't' }),
    });
    await new LocalRepository().saveWalk(walk);
    const { listWalkLifecycleIntents } = require('../walkLifecycleOperationIds');

    await expect(repo.startWalkV11!('walk-1', startAuthorization)).rejects.toThrow(/walk lifecycle v1\.1 is not available/);

    expect(remote.startWalkV11).not.toHaveBeenCalled();
    expect(remote.getWalks).not.toHaveBeenCalled();
    expect(await listWalkLifecycleIntents()).toEqual([]);
    expect(await new LocalRepository().findWalkById('walk-1')).toMatchObject({ status: 'pending' });
  });

  it('refuses a partially activated server and names what is missing', async () => {
    const { repo, remote } = setup({
      getWalkLifecycleCapability: jest.fn().mockResolvedValue({ status: 'incomplete', checkedAt: 't', missing: ['function:public.finish_walk_v11(uuid,uuid,uuid,uuid,boolean,boolean,text,timestamptz,boolean)'] }),
    });
    await expect(repo.finishWalkV11!('walk-1', 'user-1', 'op-finish', { actorUserId: 'user-1' })).rejects.toThrow(/finish_walk_v11/);
    expect(remote.finishWalkV11).not.toHaveBeenCalled();
  });

  it('starts normally on a supported server and probes once for consecutive lifecycle actions', async () => {
    const { repo, remote, walk, started, LocalRepository } = setup();
    await new LocalRepository().saveWalk(walk);
    await expect(repo.startWalkV11!('walk-1', startAuthorization)).resolves.toEqual(started);
    await repo.acquireGpsOwnershipV11!('walk-1');
    expect(remote.startWalkV11).toHaveBeenCalledTimes(1);
    expect(remote.getWalkLifecycleCapability).toHaveBeenCalledTimes(1);
  });

  it('shares one in-flight probe between concurrent callers', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const probe = jest.fn().mockImplementation(async () => { await gate; return { status: 'supported', checkedAt: 't' }; });
    const { repo } = setup({ getWalkLifecycleCapability: probe });
    const a = repo.assertWalkLifecycleV11Available();
    const b = repo.assertWalkLifecycleV11Available();
    release();
    await Promise.all([a, b]);
    expect(probe).toHaveBeenCalledTimes(1);
  });

  it('does not cache a failed probe: the next attempt asks the server again', async () => {
    const probe = jest.fn()
      .mockRejectedValueOnce(new Error('Failed to fetch'))
      .mockResolvedValueOnce({ status: 'supported', checkedAt: 't' });
    const { repo, walk, LocalRepository } = setup({ getWalkLifecycleCapability: probe });
    await new LocalRepository().saveWalk(walk);
    await expect(repo.startWalkV11!('walk-1', startAuthorization)).rejects.toThrow('Failed to fetch');
    await expect(repo.startWalkV11!('walk-1', startAuthorization)).resolves.toMatchObject({ status: 'in_progress' });
    expect(probe).toHaveBeenCalledTimes(2);
  });

  it('re-checks a negative answer after its short TTL so an approved migration takes effect without reload', async () => {
    const now = jest.spyOn(Date, 'now');
    now.mockReturnValue(1_000_000);
    const probe = jest.fn()
      .mockResolvedValueOnce({ status: 'not_installed', checkedAt: 't1' })
      .mockResolvedValueOnce({ status: 'supported', checkedAt: 't2' });
    const { repo } = setup({ getWalkLifecycleCapability: probe });
    await expect(repo.assertWalkLifecycleV11Available()).rejects.toThrow(/not available/);
    now.mockReturnValue(1_000_000 + 5_000);
    await expect(repo.assertWalkLifecycleV11Available()).rejects.toThrow(/not available/);
    expect(probe).toHaveBeenCalledTimes(1);
    now.mockReturnValue(1_000_000 + 31_000);
    await expect(repo.assertWalkLifecycleV11Available()).resolves.toBeUndefined();
    expect(probe).toHaveBeenCalledTimes(2);
    now.mockRestore();
  });

  it('fails closed after a missing-RPC error even though the probe had said supported', async () => {
    const { WalkLifecycleUnavailableError } = require('../walkLifecycleCapability');
    const { repo, remote, walk, LocalRepository } = setup({
      startWalkV11: jest.fn().mockRejectedValue(new WalkLifecycleUnavailableError('missing_rpc', 'start_walk_v11')),
    });
    await new LocalRepository().saveWalk(walk);
    await expect(repo.startWalkV11!('walk-1', startAuthorization)).rejects.toThrow(/start_walk_v11/);
    // The cached "supported" answer was replaced; the next action is refused
    // locally without sending another v1.1 request.
    await expect(repo.startWalkV11!('walk-1', startAuthorization)).rejects.toThrow(/not available/);
    expect(remote.startWalkV11).toHaveBeenCalledTimes(1);
    expect(await new LocalRepository().findWalkById('walk-1')).toMatchObject({ status: 'pending' });
  });

  it('offline with no verified server answer: refuses instead of queueing a v1.1 intent', async () => {
    netinfoFetch.mockResolvedValue({ isConnected: false, isInternetReachable: false });
    const { repo, remote, walk, LocalRepository } = setup();
    await new LocalRepository().saveWalk(walk);
    const { listWalkLifecycleIntents } = require('../walkLifecycleOperationIds');

    await expect(repo.startWalkV11!('walk-1', startAuthorization)).rejects.toThrow(/could not be verified offline/);
    expect(remote.getWalkLifecycleCapability).not.toHaveBeenCalled();
    expect(await listWalkLifecycleIntents()).toEqual([]);
    expect(await new LocalRepository().findWalkById('walk-1')).toMatchObject({ status: 'pending' });
  });

  it('offline after a verified v1.1 answer: queues the intent exactly as before', async () => {
    const { persistWalkLifecycleCapability } = require('../walkLifecycleCapability');
    await persistWalkLifecycleCapability({ status: 'supported', checkedAt: 't' });
    netinfoFetch.mockResolvedValue({ isConnected: false, isInternetReachable: false });
    const { repo, remote, walk, LocalRepository } = setup();
    await new LocalRepository().saveWalk(walk);
    const { listWalkLifecycleIntents } = require('../walkLifecycleOperationIds');

    await expect(repo.startWalkV11!('walk-1', startAuthorization)).resolves.toMatchObject({ status: 'in_progress', lifecycleSyncStatus: 'pending' });
    expect(remote.startWalkV11).not.toHaveBeenCalled();
    expect(await listWalkLifecycleIntents()).toEqual([expect.objectContaining({ action: 'start', operationId: 'op-start', state: 'pending' })]);
  });

  it('offline after a NEGATIVE verified answer: refuses and queues nothing', async () => {
    const { persistWalkLifecycleCapability } = require('../walkLifecycleCapability');
    await persistWalkLifecycleCapability({ status: 'not_installed', checkedAt: 't' });
    netinfoFetch.mockResolvedValue({ isConnected: false, isInternetReachable: false });
    const { repo, walk, LocalRepository } = setup();
    await new LocalRepository().saveWalk(walk);
    const { listWalkLifecycleIntents } = require('../walkLifecycleOperationIds');
    await expect(repo.startWalkV11!('walk-1', startAuthorization)).rejects.toThrow(/not available/);
    expect(await listWalkLifecycleIntents()).toEqual([]);
  });

  it('keeps queued intents pending (never conflict) when the server stops reporting v1.1 before replay', async () => {
    const { persistWalkLifecycleCapability } = require('../walkLifecycleCapability');
    await persistWalkLifecycleCapability({ status: 'supported', checkedAt: 't' });
    netinfoFetch.mockResolvedValue({ isConnected: false, isInternetReachable: false });
    const probe = jest.fn().mockResolvedValue({ status: 'not_installed', checkedAt: 't' });
    const { repo, remote, walk, LocalRepository } = setup({ getWalkLifecycleCapability: probe });
    await new LocalRepository().saveWalk(walk);
    const { listWalkLifecycleIntents } = require('../walkLifecycleOperationIds');
    await repo.startWalkV11!('walk-1', startAuthorization);

    netinfoFetch.mockResolvedValue({ isConnected: true, isInternetReachable: true });
    await repo.trySync({ force: true });

    expect(remote.startWalkV11).not.toHaveBeenCalled();
    expect(await listWalkLifecycleIntents()).toEqual([expect.objectContaining({ operationId: 'op-start', state: 'pending' })]);
    expect(await new LocalRepository().findWalkById('walk-1')).toMatchObject({ lifecycleSyncStatus: 'pending' });
  });

  it('records a missing-RPC replay failure on the intent, keeps it pending, and stops the pass', async () => {
    const { persistWalkLifecycleCapability, WalkLifecycleUnavailableError } = require('../walkLifecycleCapability');
    await persistWalkLifecycleCapability({ status: 'supported', checkedAt: 't' });
    netinfoFetch.mockResolvedValue({ isConnected: false, isInternetReachable: false });
    const { repo, remote, walk, LocalRepository } = setup({
      startWalkV11: jest.fn().mockRejectedValue(new WalkLifecycleUnavailableError('missing_rpc', 'start_walk_v11')),
    });
    await new LocalRepository().saveWalk(walk);
    const { listWalkLifecycleIntents } = require('../walkLifecycleOperationIds');
    await repo.startWalkV11!('walk-1', startAuthorization);
    netinfoFetch.mockResolvedValue({ isConnected: false, isInternetReachable: false });
    await repo.finishWalkV11!('walk-1', 'user-1', 'op-finish', { actorUserId: 'user-1' });

    netinfoFetch.mockResolvedValue({ isConnected: true, isInternetReachable: true });
    await repo.trySync({ force: true });

    expect(remote.startWalkV11).toHaveBeenCalledTimes(1);
    expect(remote.finishWalkV11).not.toHaveBeenCalled();
    const intents = await listWalkLifecycleIntents();
    expect(intents.map((intent: { operationId: string; state: string }) => [intent.operationId, intent.state])).toEqual([['op-start', 'pending'], ['op-finish', 'pending']]);
    expect(intents[0].error).toMatch(/start_walk_v11/);
  });

  it('a remote without a capability probe (demo/test double) keeps its existing v1.1 behavior', async () => {
    const { repo, remote, walk, LocalRepository } = setup({ getWalkLifecycleCapability: undefined });
    await new LocalRepository().saveWalk(walk);
    await expect(repo.startWalkV11!('walk-1', startAuthorization)).resolves.toMatchObject({ status: 'in_progress' });
    expect(remote.startWalkV11).toHaveBeenCalledTimes(1);
  });
});
