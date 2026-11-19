import type { HealthTask } from '../../types';

/**
 * Real-iPhone P0 — deleting an open health/grooming calendar entry. The store
 * must remove exactly the confirmed task, only after the repository confirms
 * it, and must never silently "succeed" when nothing was deleted.
 */
describe('healthStore.deleteTask', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.restoreAllMocks();
  });

  const FIXED_TIMESTAMP = '2026-10-01T00:00:00.000Z';
  const task = (patch: Partial<HealthTask> = {}): HealthTask => ({
    id: 'task-haircut',
    familyId: 'family-1',
    dogId: 'dog-1',
    category: 'grooming',
    title: 'תספורת',
    notes: 'שעת תור: 15:00',
    dueDate: '2026-10-20',
    responsibleUserId: 'user-avi',
    createdAt: FIXED_TIMESTAMP,
    updatedAt: FIXED_TIMESTAMP,
    ...patch,
  });

  const vet = task({ id: 'task-vet', category: 'vet_visit', title: 'חיסון כלבת', dueDate: '2026-11-02' });
  const recurring = task({ id: 'task-recurring', title: 'תספורת', dueDate: '2026-12-01', recurrenceIntervalDays: 30 });
  const history = task({ id: 'task-done', dueDate: '2026-09-01', completedAt: '2026-09-01T10:00:00.000Z', completedByUserId: 'user-avi' });

  async function loadWith(tasks: HealthTask[]) {
    const { useHealthStore } = require('../healthStore');
    const { repository } = require('../../data');
    jest.spyOn(repository, 'getHealthTasks').mockResolvedValueOnce(tasks);
    await useHealthStore.getState().load('dog-1');
    return { useHealthStore, repository };
  }

  it('deletes exactly the selected open task once, after repository confirmation, leaving every other entry unchanged', async () => {
    const { useHealthStore, repository } = await loadWith([task(), vet, recurring, history]);
    const deleteSpy = jest.spyOn(repository, 'deleteHealthTask').mockResolvedValue(undefined);

    await useHealthStore.getState().deleteTask('task-haircut');

    expect(deleteSpy).toHaveBeenCalledTimes(1);
    expect(deleteSpy).toHaveBeenCalledWith('task-haircut');
    expect(useHealthStore.getState().tasks).toEqual([vet, recurring, history]);
  });

  it('a failed delete keeps the task in the calendar and rejects so the UI can show an error', async () => {
    const { useHealthStore, repository } = await loadWith([task(), vet]);
    jest.spyOn(repository, 'deleteHealthTask').mockRejectedValue(new Error('Failed to fetch'));

    await expect(useHealthStore.getState().deleteTask('task-haircut')).rejects.toThrow('Failed to fetch');
    expect(useHealthStore.getState().tasks).toEqual([task(), vet]);
  });

  it('network interruption then retry: the second attempt deletes it', async () => {
    const { useHealthStore, repository } = await loadWith([task(), vet]);
    const deleteSpy = jest.spyOn(repository, 'deleteHealthTask')
      .mockRejectedValueOnce(new Error('health task deletion requires an internet connection'))
      .mockResolvedValueOnce(undefined);

    await expect(useHealthStore.getState().deleteTask('task-haircut')).rejects.toThrow();
    expect(useHealthStore.getState().tasks).toHaveLength(2);

    await useHealthStore.getState().deleteTask('task-haircut');
    expect(deleteSpy).toHaveBeenCalledTimes(2);
    expect(useHealthStore.getState().tasks).toEqual([vet]);
  });

  it('permission denial from the server keeps the task and surfaces the refusal', async () => {
    const { useHealthStore, repository } = await loadWith([task()]);
    jest.spyOn(repository, 'deleteHealthTask').mockRejectedValue(new Error('Open health task was not deleted or is no longer authorized'));

    await expect(useHealthStore.getState().deleteTask('task-haircut')).rejects.toThrow('no longer authorized');
    expect(useHealthStore.getState().tasks).toEqual([task()]);
  });

  it('never deletes completed history', async () => {
    const { useHealthStore, repository } = await loadWith([history]);
    const deleteSpy = jest.spyOn(repository, 'deleteHealthTask');

    await expect(useHealthStore.getState().deleteTask('task-done')).rejects.toThrow('Completed health history cannot be deleted');
    expect(deleteSpy).not.toHaveBeenCalled();
    expect(useHealthStore.getState().tasks).toEqual([history]);
  });

  it('a task that is not loaded is reported, not silently treated as deleted', async () => {
    const { useHealthStore, repository } = await loadWith([vet]);
    const deleteSpy = jest.spyOn(repository, 'deleteHealthTask');

    await expect(useHealthStore.getState().deleteTask('task-missing')).rejects.toThrow('not loaded');
    expect(deleteSpy).not.toHaveBeenCalled();
  });

  it('Admin Test Mode / hidden observer never reaches the repository', async () => {
    const { useHealthStore, repository } = await loadWith([task()]);
    const deleteSpy = jest.spyOn(repository, 'deleteHealthTask');
    const { useAuthStore } = require('../authStore');

    useAuthStore.setState({ testModeUserId: 'member-being-simulated' });
    await expect(useHealthStore.getState().deleteTask('task-haircut')).rejects.toThrow('מצב בדיקה');
    useAuthStore.setState({ testModeUserId: null, systemObserverActive: true });
    await expect(useHealthStore.getState().deleteTask('task-haircut')).rejects.toThrow('צפייה נסתרת');

    expect(deleteSpy).not.toHaveBeenCalled();
    expect(useHealthStore.getState().tasks).toEqual([task()]);
  });

  it('deleting one recurring task does not touch another recurring task or its history', async () => {
    const otherRecurring = task({ id: 'task-other-recurring', category: 'vet_visit', title: 'תילוע', dueDate: '2026-12-15', recurrenceIntervalDays: 90 });
    const { useHealthStore, repository } = await loadWith([recurring, otherRecurring, history]);
    const deleteSpy = jest.spyOn(repository, 'deleteHealthTask').mockResolvedValue(undefined);
    const upsertSpy = jest.spyOn(repository, 'upsertHealthTask');

    await useHealthStore.getState().deleteTask('task-recurring');

    expect(deleteSpy).toHaveBeenCalledTimes(1);
    expect(upsertSpy).not.toHaveBeenCalled(); // deleting never spawns a next occurrence
    expect(useHealthStore.getState().tasks).toEqual([otherRecurring, history]);
  });

  it('reopening the calendar after deletion: a reload from the server does not bring it back', async () => {
    const { useHealthStore, repository } = await loadWith([task(), vet]);
    jest.spyOn(repository, 'deleteHealthTask').mockResolvedValue(undefined);
    await useHealthStore.getState().deleteTask('task-haircut');

    jest.spyOn(repository, 'getHealthTasks').mockResolvedValueOnce([vet]);
    await useHealthStore.getState().load('dog-1');
    expect(useHealthStore.getState().tasks).toEqual([vet]);
  });
});

describe('healthTaskDeleteErrorMessage', () => {
  const { healthTaskDeleteErrorMessage, HEALTH_TASK_DELETE_FAILED_MESSAGE } = require('../../logic/healthTasks');

  it.each([
    ['health task deletion requires an internet connection', 'אין חיבור לשרת'],
    ['Failed to fetch', 'אין חיבור לשרת'],
    ['Open health task was not deleted or is no longer authorized', 'אין הרשאה'],
    ['Completed health history cannot be deleted', 'כבר סומנה כבוצעה'],
    ['Health task is not loaded for the active dog', 'לא נמצאה'],
  ])('maps "%s" to a Hebrew explanation', (raw, expected) => {
    const message = healthTaskDeleteErrorMessage(new Error(raw));
    expect(message).toContain(expected);
    expect(message).not.toContain(raw);
  });

  it('maps a Postgres RLS code to the permission message', () => {
    expect(healthTaskDeleteErrorMessage({ code: '42501', message: 'new row violates row-level security policy' })).toContain('אין הרשאה');
  });

  it('falls back to a generic Hebrew message that says nothing was deleted', () => {
    expect(healthTaskDeleteErrorMessage(new Error('weird'))).toBe(HEALTH_TASK_DELETE_FAILED_MESSAGE);
    expect(HEALTH_TASK_DELETE_FAILED_MESSAGE).toContain('לא נמחקה');
  });
});
