import type { HealthTask } from '../../types';

/**
 * Phase 3 kickoff (Health & Grooming, PRD §10) — healthStore is the first
 * consumer of the arbitrary-N multi-dog foundation (familyStore's
 * dogs/selectDog): every health/grooming record is scoped to ONE specific
 * dog, and this store must never let a slow response for a previously-
 * loaded dog clobber the dog the caller has since moved on to.
 */
describe('healthStore', () => {
  beforeEach(() => {
    jest.resetModules();
  });

  const FIXED_TIMESTAMP = '2026-09-01T00:00:00.000Z';
  const task = (patch: Partial<HealthTask> = {}): HealthTask => ({
    id: 'task-1',
    familyId: 'family-1',
    dogId: 'dog-1',
    category: 'vaccination',
    title: 'חיסון כלבת',
    dueDate: '2026-10-01',
    createdAt: FIXED_TIMESTAMP,
    updatedAt: FIXED_TIMESTAMP,
    ...patch,
  });

  it('load(dogId) populates tasks and records which dog they belong to', async () => {
    const { useHealthStore } = require('../healthStore');
    const { repository } = require('../../data');
    jest.spyOn(repository, 'getHealthTasks').mockResolvedValueOnce([task()]);

    await useHealthStore.getState().load('dog-1');

    const state = useHealthStore.getState();
    expect(state.error).toBeNull();
    expect(state.loading).toBe(false);
    expect(state.loadedDogId).toBe('dog-1');
    expect(state.tasks).toEqual([task()]);
  });

  it('load(dogId) surfaces a repository failure as `error` instead of throwing', async () => {
    const { useHealthStore } = require('../healthStore');
    const { repository } = require('../../data');
    jest.spyOn(repository, 'getHealthTasks').mockRejectedValueOnce(new Error('boom'));

    await useHealthStore.getState().load('dog-1');

    const state = useHealthStore.getState();
    expect(state.loading).toBe(false);
    expect(state.error).toBe('boom');
  });

  it('a stale load() response for a dog the caller has since moved on from is discarded', async () => {
    const { useHealthStore } = require('../healthStore');
    const { repository } = require('../../data');

    let resolveFirst!: (tasks: HealthTask[]) => void;
    const first = new Promise<HealthTask[]>((resolve) => { resolveFirst = resolve; });
    const spy = jest.spyOn(repository, 'getHealthTasks');
    spy.mockReturnValueOnce(first);
    spy.mockResolvedValueOnce([task({ id: 'task-2', dogId: 'dog-2' })]);

    const firstLoad = useHealthStore.getState().load('dog-1');
    const secondLoad = useHealthStore.getState().load('dog-2');
    await secondLoad;
    // dog-1's request resolves AFTER dog-2's already landed.
    resolveFirst([task({ id: 'task-1', dogId: 'dog-1' })]);
    await firstLoad;

    const state = useHealthStore.getState();
    expect(state.loadedDogId).toBe('dog-2');
    expect(state.tasks).toEqual([task({ id: 'task-2', dogId: 'dog-2' })]);
  });

  it('saveTask adds a brand-new task and persists it via the repository', async () => {
    const { useHealthStore } = require('../healthStore');
    const { repository } = require('../../data');
    jest.spyOn(repository, 'getHealthTasks').mockResolvedValueOnce([]);
    const upsertSpy = jest.spyOn(repository, 'upsertHealthTask').mockResolvedValueOnce(undefined);
    await useHealthStore.getState().load('dog-1');

    await useHealthStore.getState().saveTask(task());

    expect(useHealthStore.getState().tasks).toEqual([task()]);
    expect(upsertSpy).toHaveBeenCalledWith(task());
  });

  it('saveTask updates an existing task in place by id, not a duplicate row', async () => {
    const { useHealthStore } = require('../healthStore');
    const { repository } = require('../../data');
    jest.spyOn(repository, 'getHealthTasks').mockResolvedValueOnce([task()]);
    jest.spyOn(repository, 'upsertHealthTask').mockResolvedValue(undefined);
    await useHealthStore.getState().load('dog-1');

    const renamed = task({ title: 'חיסון כלבת (שנתי)' });
    await useHealthStore.getState().saveTask(renamed);

    const tasks = useHealthStore.getState().tasks;
    expect(tasks).toHaveLength(1);
    expect(tasks[0].title).toBe('חיסון כלבת (שנתי)');
  });

  it('completeTask marks the task done with completedAt/completedByUserId and persists it', async () => {
    const { useHealthStore } = require('../healthStore');
    const { repository } = require('../../data');
    jest.spyOn(repository, 'getHealthTasks').mockResolvedValueOnce([task()]);
    const upsertSpy = jest.spyOn(repository, 'upsertHealthTask').mockResolvedValue(undefined);
    await useHealthStore.getState().load('dog-1');

    await useHealthStore.getState().completeTask('task-1', 'user-aba');

    const saved = useHealthStore.getState().tasks[0];
    expect(saved.completedByUserId).toBe('user-aba');
    expect(saved.completedAt).toBeTruthy();
    expect(upsertSpy).toHaveBeenCalledWith(expect.objectContaining({ completedByUserId: 'user-aba' }));
  });

  it('saveTask for a different dog than the one currently loaded still persists, but is not spliced into the displayed `tasks`', async () => {
    const { useHealthStore } = require('../healthStore');
    const { repository } = require('../../data');
    jest.spyOn(repository, 'getHealthTasks').mockResolvedValueOnce([]);
    const upsertSpy = jest.spyOn(repository, 'upsertHealthTask').mockResolvedValue(undefined);
    await useHealthStore.getState().load('dog-1'); // currently viewing dog-1

    const otherDogTask = task({ id: 'task-other-dog', dogId: 'dog-2' });
    await useHealthStore.getState().saveTask(otherDogTask);

    expect(upsertSpy).toHaveBeenCalledWith(otherDogTask);
    expect(useHealthStore.getState().tasks).toEqual([]);
  });
});
