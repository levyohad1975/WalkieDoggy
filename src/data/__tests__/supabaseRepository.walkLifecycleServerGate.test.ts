import { SupabaseRepository } from '../supabaseRepository';
import { isWalkLifecycleUnavailableError, WALK_LIFECYCLE_UNAVAILABLE_MARKER } from '../walkLifecycleCapability';

/**
 * P0 real-iPhone (2026-10-15): Staging exposed only public.start_walk(uuid);
 * the v1.1 client called start_walk_v11 and got PGRST202. These pin how the
 * Supabase repository reports a server without Walk Lifecycle v1.1.
 */
const REAL_IPHONE_PGRST202 = {
  code: 'PGRST202',
  message: 'Could not find the function public.start_walk_v11(p_actual_walker_id, p_expected_actor_id, p_operation_id, p_remote_start, p_substitution_confirmed, p_walk_id) in the schema cache',
  details: 'Searched for the function public.start_walk_v11 with parameters p_actual_walker_id, p_expected_actor_id, p_operation_id, p_remote_start, p_substitution_confirmed, p_walk_id or with a single unnamed json/jsonb parameter, but no matches were found in the schema cache.',
  hint: 'Perhaps you meant to call the function public.start_walk',
};

function rpcClient(handler: (name: string, args: unknown) => { data: unknown; error: unknown }) {
  const calls: Array<{ name: string; args: unknown }> = [];
  const client: any = {
    rpc: (name: string, args: unknown) => {
      calls.push({ name, args });
      return Promise.resolve(handler(name, args));
    },
  };
  return { client, calls };
}

describe('SupabaseRepository — Walk Lifecycle v1.1 server gate', () => {
  it('reports a server without the capability probe as not installed', async () => {
    const { client, calls } = rpcClient(() => ({ data: null, error: { code: 'PGRST202', message: 'Could not find the function public.walk_lifecycle_server_capabilities without parameters in the schema cache' } }));
    await expect(new SupabaseRepository(client).getWalkLifecycleCapability()).resolves.toMatchObject({ status: 'not_installed' });
    expect(calls).toEqual([{ name: 'walk_lifecycle_server_capabilities', args: undefined }]);
  });

  it('reports exactly what is missing when the server is partially activated', async () => {
    const { client } = rpcClient(() => ({ data: { lifecycle_version: '1.1', missing: ['execute:public.start_walk_v11(uuid,uuid,uuid,uuid,boolean,boolean)'] }, error: null }));
    await expect(new SupabaseRepository(client).getWalkLifecycleCapability()).resolves.toMatchObject({
      status: 'incomplete', missing: ['execute:public.start_walk_v11(uuid,uuid,uuid,uuid,boolean,boolean)'],
    });
  });

  it('reports a fully activated server as supported', async () => {
    const { client } = rpcClient(() => ({ data: { lifecycle_version: '1.1', missing: [] }, error: null }));
    await expect(new SupabaseRepository(client).getWalkLifecycleCapability()).resolves.toMatchObject({ status: 'supported' });
  });

  it('never caches a network or auth failure as an answer', async () => {
    const network = { message: 'TypeError: Failed to fetch', code: '' };
    const { client } = rpcClient(() => ({ data: null, error: network }));
    await expect(new SupabaseRepository(client).getWalkLifecycleCapability()).rejects.toBe(network);
  });

  it('turns the real-iPhone PGRST202 for start_walk_v11 into the explicit lifecycle-unavailable error', async () => {
    const { client } = rpcClient(() => ({ data: null, error: REAL_IPHONE_PGRST202 }));
    const error = await new SupabaseRepository(client)
      .startWalkV11('walk-1', { actorUserId: 'u1', actualWalkerUserId: 'u1', operationId: 'op-1' })
      .catch((e: unknown) => e);
    expect(isWalkLifecycleUnavailableError(error)).toBe(true);
    expect((error as Error).message).toContain(WALK_LIFECYCLE_UNAVAILABLE_MARKER);
    expect((error as Error).message).toContain('start_walk_v11');
  });

  it.each([
    ['finish_walk_v11', (repo: SupabaseRepository) => repo.finishWalkV11('walk-1', 'u1', 'op-2', { actorUserId: 'u1' })],
    ['start_spontaneous_walk_v11', (repo: SupabaseRepository) => repo.startSpontaneousWalkV11({
      id: 'walk-2', familyId: 'f', dogId: 'd', date: '2026-10-15', scheduledTime: '08:00', responsibleUserId: 'u1', status: 'pending', createdAt: 'c', updatedAt: 'u',
    }, 'op-3', 'u1')],
    ['acquire_walk_gps_ownership_v11', (repo: SupabaseRepository) => repo.acquireGpsOwnershipV11('walk-1')],
  ])('maps a missing %s to the same explicit error', async (name: string, call: (repo: SupabaseRepository) => Promise<unknown>) => {
    const { client } = rpcClient(() => ({ data: null, error: { code: 'PGRST202', message: `Could not find the function public.${name}` } }));
    const error = await call(new SupabaseRepository(client)).catch((e: unknown) => e);
    expect(isWalkLifecycleUnavailableError(error)).toBe(true);
  });

  it('passes business-rule rejections through unchanged', async () => {
    const rejection = { code: 'P0001', message: 'another active walk already exists for this dog' };
    const { client } = rpcClient(() => ({ data: null, error: rejection }));
    await expect(new SupabaseRepository(client)
      .startWalkV11('walk-1', { actorUserId: 'u1', actualWalkerUserId: 'u1', operationId: 'op-1' })).rejects.toBe(rejection);
  });
});

describe('SupabaseRepository — GPS reads against a pre-v1.1 server', () => {
  const legacySession = {
    id: 'gps-1', walk_id: 'walk-1', family_id: 'f', dog_id: 'd', distance_meters: 812.5, point_count: 40,
    route_points: [{ latitude: 32.1, longitude: 34.8, timestamp: 1 }], source: 'device_gps', created_at: 'c', updated_at: 'u',
  };
  const missingOwnershipTable = { code: 'PGRST205', message: "Could not find the table 'public.walk_gps_ownership' in the schema cache" };

  function legacyClient() {
    const tablesRead: string[] = [];
    const client: any = {
      from: (table: string) => {
        tablesRead.push(table);
        const result = table === 'walk_gps_sessions'
          ? { data: [legacySession], error: null }
          : { data: null, error: missingOwnershipTable };
        const chain: any = {
          select: () => chain,
          eq: () => chain,
          in: () => Promise.resolve(result),
          maybeSingle: () => Promise.resolve(table === 'walk_gps_sessions' ? { data: legacySession, error: null } : result),
        };
        return chain;
      },
    };
    return { client, tablesRead };
  }

  it('returns the legacy session for one walk instead of failing the read', async () => {
    const { client, tablesRead } = legacyClient();
    const session = await new SupabaseRepository(client).getGpsSession('walk-1');
    expect(session).toMatchObject({ walkId: 'walk-1', distanceMeters: 812.5, pointCount: 40 });
    expect(session?.routePoints).toHaveLength(1);
    expect(tablesRead).not.toContain('walk_gps_route_samples_v11');
  });

  it('returns legacy sessions for History/Statistics instead of falling back to device-only data', async () => {
    const { client } = legacyClient();
    const sessions = await new SupabaseRepository(client).getGpsSessionsForWalkIds(['walk-1']);
    expect(sessions).toHaveLength(1);
    expect(sessions[0]).toMatchObject({ walkId: 'walk-1', distanceMeters: 812.5 });
  });

  it('still surfaces a real read failure on the ownership table', async () => {
    const denied = { code: '42501', message: 'permission denied for table walk_gps_ownership' };
    const client: any = {
      from: (table: string) => {
        const chain: any = {
          select: () => chain,
          eq: () => chain,
          in: () => Promise.resolve(table === 'walk_gps_sessions' ? { data: [], error: null } : { data: null, error: denied }),
        };
        return chain;
      },
    };
    await expect(new SupabaseRepository(client).getGpsSessionsForWalkIds(['walk-1'])).rejects.toBe(denied);
  });
});
