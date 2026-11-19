import { SupabaseRepository } from '../supabaseRepository';

const walkId = 'da94d830-4a1d-4044-b0e3-e1f3c4f59736';
const sessionId = 'ae7b8033-7abe-4ea7-95d9-c6f9ea510fe3';

function makeClient() {
  const calls: Array<{ table: string; method: string; value?: unknown }> = [];
  const walkRows = [{
    id: walkId, family_id: 'family-1', dog_id: 'dog-1', status: 'in_progress', is_unplanned: true,
    created_at: '2026-10-13T09:59:00Z',
    started_at: '2026-10-13T10:00:00Z', started_by_user_id: 'profile-1',
    actual_walker_user_id: 'profile-2', responsible_user_id: 'profile-1', duplicate_resolution_group_id: null,
  }];
  const gpsRows = [{
    id: sessionId, walk_id: walkId, point_count: 4, distance_meters: 83.5,
    started_at: '2026-10-13T10:01:00Z', ended_at: '2026-10-13T10:03:00Z', created_by_user_id: 'profile-2',
  }];
  const auditRows = [{
    id: 'audit-1', target_id: walkId, action: 'spontaneous_walk_added', actor_user_id: 'profile-1',
    created_at: '2026-10-13T10:00:00Z', metadata: { date: '2026-10-13', time: '13:00' },
  }];
  const client: any = {
    from: (table: string) => {
      const builder: any = {
        select: (columns: string) => { calls.push({ table, method: 'select', value: columns }); return builder; },
        eq: (column: string, value: unknown) => {
          calls.push({ table, method: `eq:${column}`, value });
          return table === 'walks' && column === 'status'
            ? Promise.resolve({ data: walkRows, error: null }) : builder;
        },
        in: (column: string, value: unknown) => {
          calls.push({ table, method: `in:${column}`, value });
          return Promise.resolve({ data: table === 'walks' ? walkRows : table === 'walk_gps_sessions' ? gpsRows : auditRows, error: null });
        },
        order: (column: string, value: unknown) => { calls.push({ table, method: `order:${column}`, value }); return builder; },
      };
      return builder;
    },
    rpc: jest.fn().mockResolvedValue({ data: '7e8e9a76-d91f-45d4-a559-b1697ca46d2f', error: null }),
  };
  return { client, calls };
}

describe('SupabaseRepository duplicate resolution', () => {
  it('reads only exact family walks, linked GPS summaries, and audit entries, never route coordinates', async () => {
    const { client, calls } = makeClient();
    const repo = new SupabaseRepository(client);
    await expect(repo.getDuplicateActiveWalkReview!('family-1', [walkId])).resolves.toEqual([{
      walkId, familyId: 'family-1', dogId: 'dog-1', status: 'in_progress', isUnplanned: true,
      createdAt: '2026-10-13T09:59:00Z', startedAt: '2026-10-13T10:00:00Z',
      startedByUserId: 'profile-1', actualWalkerUserId: undefined, responsibleUserId: 'profile-1',
      duplicateResolutionGroupId: undefined,
      auditEntries: [{ id: 'audit-1', action: 'spontaneous_walk_added', actorUserId: 'profile-1', createdAt: '2026-10-13T10:00:00Z', metadata: { date: '2026-10-13', time: '13:00' } }],
      gpsSessions: [{ id: sessionId, pointCount: 4, distanceMeters: 83.5, startedAt: '2026-10-13T10:01:00Z', endedAt: '2026-10-13T10:03:00Z', createdByUserId: 'profile-2' }],
    }]);
    expect(calls.filter((call) => call.method.startsWith('eq:'))).toEqual([
      { table: 'walks', method: 'eq:family_id', value: 'family-1' },
      { table: 'walk_gps_sessions', method: 'eq:family_id', value: 'family-1' },
      { table: 'audit_log', method: 'eq:family_id', value: 'family-1' },
      { table: 'audit_log', method: 'eq:target_type', value: 'walk' },
    ]);
    expect(calls.find((call) => call.table === 'walk_gps_sessions' && call.method === 'select')?.value).not.toContain('route_points');
    expect(calls.find((call) => call.table === 'audit_log' && call.method === 'select')?.value).toBe('id,target_id,action,actor_user_id,created_at,metadata');
    expect(calls).toHaveLength(11);
  });

  it('enumerates all current-family active walks on v12-only Staging without selecting v1.1 columns', async () => {
    const { client, calls } = makeClient();
    const repo = new SupabaseRepository(client);
    await expect(repo.getDuplicateActiveWalkReview!('family-1', [])).resolves.toHaveLength(1);
    expect(calls).toContainEqual({ table: 'walks', method: 'eq:status', value: 'in_progress' });
    const selectedWalkColumns = calls.find((call) => call.table === 'walks' && call.method === 'select')?.value as string;
    expect(selectedWalkColumns).toContain('duplicate_resolution_group_id');
    expect(selectedWalkColumns).not.toContain('actual_walker_user_id');
  });

  it('calls only the authenticated Supabase RPC with the exact no-canonical request', async () => {
    const { client, calls } = makeClient();
    const repo = new SupabaseRepository(client);
    const request = { walkIds: [walkId], canonicalWalkId: null, rationale: 'Approved Staging test duplicate group.', operationId: '8ac8f56c-bcda-4822-87a9-ac2731723ba0' };
    await expect(repo.resolveDuplicateActiveWalksV12(request)).resolves.toBe('7e8e9a76-d91f-45d4-a559-b1697ca46d2f');
    expect(client.rpc).toHaveBeenCalledWith('resolve_duplicate_active_walks_v12', {
      p_walk_ids: [walkId], p_canonical_walk_id: null, p_rationale: request.rationale, p_operation_id: request.operationId,
    });
  });

  it('propagates authorization and migration errors without a fallback table write', async () => {
    const { client, calls } = makeClient();
    client.rpc.mockResolvedValue({ data: null, error: { code: '42501', message: 'family admin required' } });
    const repo = new SupabaseRepository(client);
    await expect(repo.resolveDuplicateActiveWalksV12({ walkIds: [walkId], canonicalWalkId: null, rationale: 'Approved Staging test duplicate group.', operationId: '8ac8f56c-bcda-4822-87a9-ac2731723ba0' }))
      .rejects.toMatchObject({ code: '42501' });
    expect(calls).toHaveLength(0);
  });
});
