import { SupabaseRepository } from '../supabaseRepository';
import type { Repository } from '../repository';
import type { HealthTask } from '../../types';

/**
 * Real-iPhone P0 — deleting an open health/grooming entry must be confirmed
 * by the server before it disappears, must be retry-safe after a lost
 * response, and must report an RLS refusal instead of pretending success.
 */
function deleteClient({ deleted, remaining, deleteError = null, checkError = null }: {
  deleted: Array<{ id: string }>;
  remaining?: { id: string } | null;
  deleteError?: unknown;
  checkError?: unknown;
}) {
  const calls: string[] = [];
  const client: any = {
    from: (table: string) => ({
      delete: () => ({
        eq: (column: string, value: string) => ({
          is: (isColumn: string, isValue: null) => ({
            select: () => {
              calls.push(`delete ${table} ${column}=${value} ${isColumn} is ${isValue}`);
              return Promise.resolve({ data: deleteError ? null : deleted, error: deleteError });
            },
          }),
        }),
      }),
      select: () => ({
        eq: (column: string, value: string) => ({
          maybeSingle: () => {
            calls.push(`check ${table} ${column}=${value}`);
            return Promise.resolve({ data: checkError ? null : remaining ?? null, error: checkError });
          },
        }),
      }),
    }),
  };
  return { client, calls };
}

describe('SupabaseRepository.deleteHealthTask', () => {
  it('deletes only the selected OPEN task (id + completed_at is null) and resolves when exactly one row was deleted', async () => {
    const { client, calls } = deleteClient({ deleted: [{ id: 'task-1' }] });
    await expect(new SupabaseRepository(client).deleteHealthTask('task-1')).resolves.toBeUndefined();
    expect(calls).toEqual(['delete health_tasks id=task-1 completed_at is null']);
  });

  it('permission denial: zero rows deleted while the row is still there -> rejects', async () => {
    const { client } = deleteClient({ deleted: [], remaining: { id: 'task-1' } });
    await expect(new SupabaseRepository(client).deleteHealthTask('task-1')).rejects.toThrow('no longer authorized');
  });

  it('retry after a lost response: zero rows deleted and the row is gone -> confirmed deleted', async () => {
    const { client, calls } = deleteClient({ deleted: [], remaining: null });
    await expect(new SupabaseRepository(client).deleteHealthTask('task-1')).resolves.toBeUndefined();
    expect(calls).toEqual(['delete health_tasks id=task-1 completed_at is null', 'check health_tasks id=task-1']);
  });

  it('propagates a delete error and a verification error', async () => {
    await expect(new SupabaseRepository(deleteClient({ deleted: [], deleteError: { code: '42501', message: 'permission denied' } }).client).deleteHealthTask('task-1'))
      .rejects.toMatchObject({ code: '42501' });
    await expect(new SupabaseRepository(deleteClient({ deleted: [], checkError: { message: 'Failed to fetch' } }).client).deleteHealthTask('task-1'))
      .rejects.toMatchObject({ message: 'Failed to fetch' });
  });
});

describe('OfflineFirstRepository.deleteHealthTask', () => {
  const FIXED = '2026-10-01T00:00:00.000Z';
  const task = (id: string, patch: Partial<HealthTask> = {}): HealthTask => ({
    id, familyId: 'family-1', dogId: 'dog-1', category: 'grooming', title: 'תספורת', dueDate: '2026-10-20',
    createdAt: FIXED, updatedAt: FIXED, ...patch,
  });

  function stubRemote(overrides: Partial<Repository> = {}): Repository {
    return {
      getHealthTasks: jest.fn().mockResolvedValue([]),
      upsertHealthTask: jest.fn().mockResolvedValue(undefined),
      deleteHealthTask: jest.fn().mockResolvedValue(undefined),
      ...overrides,
    } as unknown as Repository;
  }

  function setupNetInfo(connected: boolean) {
    jest.doMock('@react-native-community/netinfo', () => ({
      __esModule: true,
      default: { fetch: jest.fn().mockResolvedValue({ isConnected: connected, isInternetReachable: connected }) },
    }));
  }

  beforeEach(async () => {
    jest.resetModules();
    const AsyncStorage = require('@react-native-async-storage/async-storage');
    await AsyncStorage.clear();
  });

  async function seededRepo(remote: Repository) {
    const { OfflineFirstRepository } = require('../offlineFirstRepository');
    const repo = new OfflineFirstRepository(remote);
    const local = (repo as any).local;
    await local.upsertHealthTask(task('task-1'));
    await local.upsertHealthTask(task('task-2', { recurrenceIntervalDays: 30 }));
    await local.upsertHealthTask(task('task-done', { completedAt: FIXED }));
    return { repo, local };
  }

  it('online: deletes on the server first, then locally — other entries untouched', async () => {
    setupNetInfo(true);
    const remote = stubRemote();
    const { repo, local } = await seededRepo(remote);

    await repo.deleteHealthTask('task-1');

    expect(remote.deleteHealthTask).toHaveBeenCalledTimes(1);
    expect(remote.deleteHealthTask).toHaveBeenCalledWith('task-1');
    expect((await local.getHealthTasks('dog-1')).map((t: HealthTask) => t.id).sort()).toEqual(['task-2', 'task-done']);
  });

  it('server refusal leaves the local copy in place', async () => {
    setupNetInfo(true);
    const remote = stubRemote({ deleteHealthTask: jest.fn().mockRejectedValue(new Error('Open health task was not deleted or is no longer authorized')) });
    const { repo, local } = await seededRepo(remote);

    await expect(repo.deleteHealthTask('task-1')).rejects.toThrow('no longer authorized');
    expect((await local.getHealthTasks('dog-1')).map((t: HealthTask) => t.id)).toContain('task-1');
  });

  it('offline: refuses without calling the server or queueing, local copy unchanged', async () => {
    setupNetInfo(false);
    const remote = stubRemote();
    const { repo, local } = await seededRepo(remote);

    await expect(repo.deleteHealthTask('task-1')).rejects.toThrow('internet connection');
    expect(remote.deleteHealthTask).not.toHaveBeenCalled();
    expect((await local.getHealthTasks('dog-1')).map((t: HealthTask) => t.id)).toContain('task-1');
    expect(await repo.pendingSyncCount()).toBe(0);
  });
});
