import { SupabaseRepository } from '../supabaseRepository';

const row = {
  id: 'walk-1', family_id: 'family-1', schedule_entry_id: 'entry-1', dog_id: 'dog-1', date: '2026-10-13',
  scheduled_time: '08:00', responsible_user_id: 'assignee-1', actual_walker_user_id: 'walker-1',
  status: 'in_progress', started_at: '2026-10-13T05:00:00.000Z', started_by_user_id: 'actor-1',
  completed_at: null, completed_by_user_id: null, ended_by_user_id: null, had_pee: null, had_poop: null,
  note: null, duration_minutes: null, is_unplanned: false, created_at: 'created', updated_at: 'updated',
};

describe('SupabaseRepository v1.1 lifecycle RPC contracts', () => {
  it('passes explicit actual walker, actor, stable operation id and confirmation flags to start', async () => {
    const calls: unknown[] = [];
    const invoke = jest.fn().mockResolvedValue({ data: { providerAccepted: true }, error: null });
    const client: any = { rpc: (name: string, args: unknown) => { calls.push({ name, args }); return Promise.resolve({ data: row, error: null }); }, functions: { invoke } };
    const repo = new SupabaseRepository(client);
    const started = await repo.startWalkV11('walk-1', {
      actorUserId: 'actor-1', actualWalkerUserId: 'walker-1', operationId: 'operation-1',
      substitutionConfirmed: true, remoteStart: true,
    });
    expect(calls).toEqual([{ name: 'start_walk_v11', args: {
      p_walk_id: 'walk-1', p_expected_actor_id: 'actor-1', p_actual_walker_id: 'walker-1',
      p_operation_id: 'operation-1', p_substitution_confirmed: true, p_remote_start: true,
    } }]);
    expect(started.responsibleUserId).toBe('assignee-1');
    expect(started.actualWalkerUserId).toBe('walker-1');
    expect(started.startedByUserId).toBe('actor-1');
    expect(invoke).toHaveBeenCalledWith('send-walk-lifecycle-notification', { body: { walkId: 'walk-1' } });
  });

  it('keeps finish action actor distinct from actual walker', async () => {
    let call: { name: string; args: Record<string, unknown> } | undefined;
    const client: any = { rpc: (name: string, args: Record<string, unknown>) => { call = { name, args }; return Promise.resolve({ data: { ...row, status: 'done' }, error: null }); } };
    await new SupabaseRepository(client).finishWalkV11('walk-1', 'walker-1', 'operation-2', {
      actorUserId: 'manager-1', remoteConfirmation: true, hadPee: true,
    });
    expect(call?.name).toBe('finish_walk_v11');
    expect(call?.args.p_expected_actor_id).toBe('manager-1');
    expect(call?.args.p_actual_walker_id).toBe('walker-1');
    expect(call?.args.p_remote_confirmation).toBe(true);
  });

  it('passes explicit device transfer consent to the GPS lease RPC', async () => {
    let call: unknown;
    const client: any = { rpc: (name: string, args: unknown) => { call = { name, args }; return Promise.resolve({ data: [{ fencing_epoch: 3, expires_at: 'later' }], error: null }); } };
    const lease = await new SupabaseRepository(client).acquireGpsOwnershipV11('walk-1', true);
    expect(call).toEqual({ name: 'acquire_walk_gps_ownership_v11', args: { p_walk_id: 'walk-1', p_confirm_transfer: true } });
    expect(lease).toEqual({ fencingEpoch: 3, expiresAt: 'later' });
  });

  it('releases GPS ownership through the fenced server RPC', async () => {
    let call: unknown;
    const client: any = { rpc: (name: string, args: unknown) => { call = { name, args }; return Promise.resolve({ data: true, error: null }); } };
    await new SupabaseRepository(client).releaseGpsOwnershipV11('walk-1', 7);
    expect(call).toEqual({ name: 'release_walk_gps_ownership_v11', args: { p_walk_id: 'walk-1', p_fencing_epoch: 7 } });
  });
});
