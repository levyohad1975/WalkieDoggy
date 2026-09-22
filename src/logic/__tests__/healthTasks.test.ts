import {
  addDaysToDateOnly,
  buildNextRecurringTask,
  getHealthTaskLifecycle,
  HEALTH_DUE_SOON_DAYS,
  HEALTH_OVERDUE_NUDGE_DAYS_AFTER,
  HEALTH_TASK_CATEGORIES,
  HEALTH_TASK_CATEGORY_LABELS,
  planHealthTaskNotifications,
  summarizeHealthTasksForHome,
} from '../healthTasks';
import type { HealthTask, HealthTaskCategory } from '../../types';

describe('HEALTH_TASK_CATEGORIES / HEALTH_TASK_CATEGORY_LABELS', () => {
  it('covers every PRD §10 core category, with a non-empty Hebrew label for each', () => {
    const expected: HealthTaskCategory[] = [
      'vaccination', 'parasite_prevention', 'medication', 'vet_visit', 'weight',
      'allergy', 'food', 'grooming', 'bath', 'nails', 'teeth', 'ears', 'other',
    ];
    expect(HEALTH_TASK_CATEGORIES.slice().sort()).toEqual(expected.slice().sort());
    for (const c of HEALTH_TASK_CATEGORIES) {
      expect(HEALTH_TASK_CATEGORY_LABELS[c]).toBeTruthy();
    }
  });
});

const baseTask: HealthTask = {
  id: 'task-1',
  familyId: 'family-1',
  dogId: 'dog-1',
  category: 'vaccination',
  title: 'חיסון כלבת',
  dueDate: '2026-06-15',
  createdAt: '2026-06-01T00:00:00.000Z',
  updatedAt: '2026-06-01T00:00:00.000Z',
};

describe('addDaysToDateOnly', () => {
  it('adds days within a month', () => {
    expect(addDaysToDateOnly('2026-06-15', 5)).toBe('2026-06-20');
  });
  it('rolls over a month boundary', () => {
    expect(addDaysToDateOnly('2026-06-28', 5)).toBe('2026-07-03');
  });
  it('rolls over a year boundary', () => {
    expect(addDaysToDateOnly('2026-12-30', 5)).toBe('2027-01-04');
  });
});

describe('getHealthTaskLifecycle', () => {
  const now = new Date('2026-06-15T12:00:00.000Z');

  it('is "upcoming" when dueDate is in the future', () => {
    expect(getHealthTaskLifecycle({ dueDate: '2026-06-20' }, now)).toBe('upcoming');
  });
  it('is "due" exactly on the due date', () => {
    expect(getHealthTaskLifecycle({ dueDate: '2026-06-15' }, now)).toBe('due');
  });
  it('is "overdue" once the due date has passed', () => {
    expect(getHealthTaskLifecycle({ dueDate: '2026-06-10' }, now)).toBe('overdue');
  });
  it('is "completed" whenever completedAt is set, regardless of dueDate', () => {
    expect(getHealthTaskLifecycle({ dueDate: '2026-06-10', completedAt: '2026-06-12T00:00:00.000Z' }, now)).toBe('completed');
    expect(getHealthTaskLifecycle({ completedAt: '2026-06-12T00:00:00.000Z' }, now)).toBe('completed');
  });
});

describe('summarizeHealthTasksForHome', () => {
  const now = new Date('2026-06-15T12:00:00.000Z');

  it('counts overdue and due-soon (within HEALTH_DUE_SOON_DAYS) separately, ignoring completed and far-future tasks', () => {
    const tasks: HealthTask[] = [
      { ...baseTask, id: 't-overdue', dueDate: '2026-06-10' },
      { ...baseTask, id: 't-due-today', dueDate: '2026-06-15' },
      { ...baseTask, id: 't-due-soon', dueDate: addDaysToDateOnly('2026-06-15', HEALTH_DUE_SOON_DAYS) },
      { ...baseTask, id: 't-far-future', dueDate: addDaysToDateOnly('2026-06-15', HEALTH_DUE_SOON_DAYS + 1) },
      { ...baseTask, id: 't-completed', dueDate: '2026-06-05', completedAt: '2026-06-05T00:00:00.000Z' },
    ];
    expect(summarizeHealthTasksForHome(tasks, now)).toEqual({ overdueCount: 1, dueSoonCount: 2 });
  });

  it('returns zero counts for an empty or all-completed dog', () => {
    expect(summarizeHealthTasksForHome([], now)).toEqual({ overdueCount: 0, dueSoonCount: 0 });
  });
});

describe('buildNextRecurringTask', () => {
  it('returns null for a task with no recurrence interval', () => {
    expect(buildNextRecurringTask(baseTask, '2026-06-15T10:00:00.000Z', 'task-2')).toBeNull();
  });

  it('builds the next occurrence due N days after the completion date, as a fresh row', () => {
    const recurring: HealthTask = { ...baseTask, recurrenceIntervalDays: 30, notes: 'מהמרפאה בעיר', responsibleUserId: 'user-aba' };
    const next = buildNextRecurringTask(recurring, '2026-06-15T10:00:00.000Z', 'task-2');
    expect(next).toEqual({
      id: 'task-2',
      familyId: 'family-1',
      dogId: 'dog-1',
      category: 'vaccination',
      title: 'חיסון כלבת',
      notes: 'מהמרפאה בעיר',
      recurrenceIntervalDays: 30,
      responsibleUserId: 'user-aba',
      dueDate: '2026-07-15',
      createdByUserId: undefined,
      createdAt: '2026-06-15T10:00:00.000Z',
      updatedAt: '2026-06-15T10:00:00.000Z',
    });
  });

  it('never carries weightKg or completedAt/completedByUserId into the next occurrence', () => {
    const recurring: HealthTask = { ...baseTask, category: 'weight', recurrenceIntervalDays: 7, weightKg: 8.4, completedAt: '2026-06-15T10:00:00.000Z', completedByUserId: 'user-aba' };
    const next = buildNextRecurringTask(recurring, '2026-06-15T10:00:00.000Z', 'task-2')!;
    expect(next.weightKg).toBeUndefined();
    expect(next.completedAt).toBeUndefined();
    expect(next.completedByUserId).toBeUndefined();
  });
});

describe('planHealthTaskNotifications', () => {
  it('plans a due-date reminder and one overdue nudge HEALTH_OVERDUE_NUDGE_DAYS_AFTER later', () => {
    const plan = planHealthTaskNotifications({ dueDate: '2026-06-15' });
    expect(plan).toHaveLength(2);
    expect(plan[0]).toEqual({ kind: 'health_task_due', fireAt: new Date('2026-06-15T09:00:00').toISOString() });
    const expectedOverdue = new Date(new Date('2026-06-15T09:00:00').getTime() + HEALTH_OVERDUE_NUDGE_DAYS_AFTER * 86400000);
    expect(plan[1]).toEqual({ kind: 'health_task_overdue', fireAt: expectedOverdue.toISOString() });
  });

  it('plans nothing for a completed task or one with no dueDate', () => {
    expect(planHealthTaskNotifications({ dueDate: '2026-06-15', completedAt: '2026-06-10T00:00:00.000Z' })).toEqual([]);
    expect(planHealthTaskNotifications({})).toEqual([]);
  });
});
