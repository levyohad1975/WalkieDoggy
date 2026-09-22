import { create } from 'zustand';
import type { HealthTask } from '../types';
import { repository } from '../data';
import { guardTestModeMutation } from '../lib/testModeGuard';

// Not store state — an internal request-ordering token only load() itself
// needs, so a stale response for a PREVIOUSLY loaded dog (the member
// switched the active dog, or reopened this screen for a different one,
// while the first request was still in flight) can be detected and
// discarded instead of clobbering the dog the store has since moved on to.
let loadSeq = 0;

interface HealthState {
  tasks: HealthTask[];
  loading: boolean;
  error: string | null;
  /** The dogId `tasks` currently reflects, so a screen can tell "empty because this dog genuinely has no records yet" apart from "hasn't loaded for this dog yet". */
  loadedDogId: string | null;

  load: (dogId: string) => Promise<void>;
  /** Upserts by task.id — covers creating a new log/task entry AND patch-and-save (e.g. marking one complete). No delete: see 0049's migration comment for why a health record is never client-erasable. */
  saveTask: (task: HealthTask) => Promise<void>;
  /** Convenience for the common "mark this task done" action. */
  completeTask: (taskId: string, userId: string) => Promise<void>;
}

export const useHealthStore = create<HealthState>((set, get) => ({
  tasks: [],
  loading: false,
  error: null,
  loadedDogId: null,

  load: async (dogId: string) => {
    set({ loading: true, error: null });
    const requestId = ++loadSeq;
    try {
      const tasks = await repository.getHealthTasks(dogId);
      if (requestId !== loadSeq) return; // superseded by a later load() call
      set({ tasks, loadedDogId: dogId, loading: false });
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
  },

  completeTask: async (taskId: string, userId: string) => {
    const task = get().tasks.find((t) => t.id === taskId);
    if (!task) return;
    await get().saveTask({ ...task, completedAt: new Date().toISOString(), completedByUserId: userId });
  },
}));
