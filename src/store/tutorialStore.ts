import { create } from 'zustand';
import type { TutorialRole } from '../lib/tutorialConfig';
import { recordTutorialDecision, recordTutorialOffer, type TutorialDecision } from '../lib/tutorialProgress';
import { tutorialContextKey } from '../logic/tutorialGate';

/**
 * In-memory presentation state for the first-run tutorial overlay.
 *
 * Persistence lives in tutorialProgress.ts; this store only remembers which
 * (family, profile) contexts were already handled in THIS app session, so a
 * storage write failure can never make the invitation reappear until the
 * next cold start.
 */

export type TutorialOrigin = 'firstRun' | 'help';
export type TutorialMode = 'welcome' | 'player' | 'done';

export interface TutorialContext {
  familyId: string;
  profileId: string;
  role: TutorialRole;
}

interface TutorialState {
  visible: boolean;
  origin: TutorialOrigin | null;
  mode: TutorialMode;
  context: TutorialContext | null;
  /** Context keys offered or decided during this session. */
  handledKeys: Record<string, true>;
  /** True when the last decision could not be persisted (diagnostics/tests). */
  lastWriteFailed: boolean;
  offerFirstRun: (context: TutorialContext) => void;
  openFromHelp: (context: TutorialContext) => void;
  startPlayback: () => void;
  markEnded: () => void;
  dismiss: () => void;
  finish: () => void;
  /** Close without recording when the signed-in family/profile changes. */
  syncContext: (familyId: string | null, profileId: string | null) => void;
  reset: () => void;
}

const initial = {
  visible: false,
  origin: null,
  mode: 'welcome' as TutorialMode,
  context: null,
  handledKeys: {} as Record<string, true>,
  lastWriteFailed: false,
};

export const useTutorialStore = create<TutorialState>((set, get) => {
  const persist = (decision: TutorialDecision) => {
    const context = get().context;
    if (!context) return;
    void recordTutorialDecision(context.familyId, context.profileId, decision).then((ok) => {
      if (!ok) set({ lastWriteFailed: true });
    });
  };
  const markHandled = (context: TutorialContext) => {
    const key = tutorialContextKey(context.familyId, context.profileId);
    return key ? { ...get().handledKeys, [key]: true as const } : get().handledKeys;
  };

  return {
    ...initial,

    offerFirstRun: (context) => {
      if (get().visible) return;
      set({ visible: true, origin: 'firstRun', mode: 'welcome', context, handledKeys: markHandled(context), lastWriteFailed: false });
      void recordTutorialOffer(context.familyId, context.profileId);
    },

    openFromHelp: (context) => {
      set({ visible: true, origin: 'help', mode: 'player', context, handledKeys: markHandled(context), lastWriteFailed: false });
    },

    startPlayback: () => {
      if (!get().visible) return;
      set({ mode: 'player' });
    },

    markEnded: () => {
      if (!get().visible || get().mode === 'done') return;
      set({ mode: 'done' });
      persist('completed');
    },

    dismiss: () => {
      if (!get().visible) return;
      // A dismissal never downgrades an earlier completion (see mergeDecision).
      if (get().mode !== 'done') persist('dismissed');
      set({ visible: false, origin: null, mode: 'welcome' });
    },

    finish: () => {
      if (!get().visible) return;
      if (get().mode !== 'done') persist('completed');
      set({ visible: false, origin: null, mode: 'welcome' });
    },

    syncContext: (familyId, profileId) => {
      const { context } = get();
      if (!context) return;
      if (context.familyId === familyId && context.profileId === profileId) return;
      set({ visible: false, origin: null, mode: 'welcome', context: null });
    },

    reset: () => set({ ...initial, handledKeys: {} }),
  };
});
