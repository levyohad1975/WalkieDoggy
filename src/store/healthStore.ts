import { create } from 'zustand';
import type { HealthTask } from '../types';
import { repository } from '../data';
import { guardTestModeMutation } from '../lib/testModeGuard';
import { generateId } from '../lib/id';
import { buildNextRecurringTask } from '../logic/healthTasks';
import { reconcileHealthTaskNotifications, scheduleHealthTaskNotifications } from '../notifications/healthReminderService';
import { useFamilyStore } from './familyStore';

// Not store state — an internal request-ordering token only load() itself
// needs, so a stale response for a PREVIOUSLY loaded dog (the member
// switched the active dog, or reopened this screen for a different one,
// while the first request was still in flight) can be detected and
// discarded instead of clobbering the dog the store has since moved on to.
let loadSeq = 0;

/** Best-effort dog name for a reminder's body text — never blocks/fails a save over a missing name (matches HomeScreen's own `dog?.name ?? 'הכלב/ה'` fallback for the same reason: a screen must never break because a name wasn't resolved yet). */
function activeDogName(): string {
  return useFamilyStore.getState().dog?.name ?? 'הכלב/ה';
}

interface HealthState {
  tasks: HealthTask[];
  loading: boolean;
  error: string | null;
  /** The dogId `tasks` currently reflects, so a screen can tell "empty because this dog genuinely has no records yet" apart from "hasn't loaded for this dog yet". */
  loadedDogId: string | null;

  load: (dogId: string) => Promise<void>;
  /** Upserts by task.id — covers creating a new log/task entry AND patch-and-save (e.g. marking one complete). No delete: see 0049's migration comment for why a health record is never client-erasable. */
  saveTask: (task: HealthTask) => Promise<void>;
  /**
   * Marks a task done and, when it has recurrenceIntervalDays set (0050),
   * generates the next occurrence as a fresh row due that many days later
   * — see logic/healthTasks.ts's buildNextRecurringTask() for exactly what
   * carries over. The completed record itself is never mutated beyond its
   * own completedAt/completedByUserId.
   */
  completeTask: (taskId: string, userId: string) => Promise<void>;
  /**
   * Cross-screen "open the Health & Grooming sheet" signal — Home's summary
   * badge sets this before navigating to the Settings tab (a plain
   * zustand flag rather than React Navigation params, since nothing else in
   * this app threads params between tabs yet); SettingsScreen consumes it
   * on focus and clears it immediately, so revisiting Settings normally
   * afterwards never re-opens the sheet unprompted.
   */
  pendingOpenRequest: boolean;
  requestOpen: () => void;
  consumePendingOpenRequest: () => boolean;
}

export const useHealthStore = create<HealthState>((set, get) => ({
  tasks: [],
  loading: false,
  error: null,
  loadedDogId: null,
  pendingOpenRequest: false,

  load: async (dogId: string) => {
    set({ loading: true, error: null });
    const requestId = ++loadSeq;
    try {
      const tasks = await repository.getHealthTasks(dogId);
      if (requestId !== loadSeq) return; // superseded by a later load() call
      set({ tasks, loadedDogId: dogId, loading: false });
      // Best-effort — reminders are a convenience layered on top of the
      // data, never a reason to fail or block showing it (same posture as
      // familyStore.loadPermissionOverrides).
      void reconcileHealthTaskNotifications(tasks, activeDogName());
    } catch (e) {
      if (requestId !== loadSeq) return;
      set({ error: e instanceof Error ? e.message : 'שגיאה בטעינת נתוני הבריאות והטיפוח', loading: false });
    }
  },

  saveTask: async (task: HealthTask) => {
    if (!guardTestModeMutation()) return;
    set((s) => {
      // A task for a different dog than the one currently loaded must never
      // be spliced into `tasks` — that would show up as a stray record on
      // whichever dog's screen happens to be open right now.
      if (task.dogId !== s.loadedDogId) return {};
      const idx = s.tasks.findIndex((t) => t.id === task.id);
      const tasks = idx >= 0 ? s.tasks.map((t, i) => (i === idx ? task : t)) : [...s.tasks, task];
      return { tasks };
    });
    await repository.upsertHealthTask(task);
    if (task.dogId === get().loadedDogId) {
      void scheduleHealthTaskNotifications(task, activeDogName());
    }
  },

  completeTask: async (taskId: string, userId: string) => {
    const task = get().tasks.find((t) => t.id === taskId);
    if (!task) return;
    const completedAt = new Date().toISOString();
    await get().saveTask({ ...task, completedAt, completedByUserId: userId });

    const next = buildNextRecurringTask(task, completedAt, generateId('health-task'));
    if (next) await get().saveTask(next);
  },

  requestOpen: () => set({ pendingOpenRequest: true }),

  consumePendingOpenRequest: () => {
    const pending = get().pendingOpenRequest;
    if (pending) set({ pendingOpenRequest: false });
    return pending;
  },
}));
