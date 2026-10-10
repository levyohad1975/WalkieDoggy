import { create } from 'zustand';
import type { AchievementUnlock, Walk } from '../types';
import type { SwapRequestRow } from '../lib/requests';
import { repository } from '../data';
import { generateId } from '../lib/id';
import {
  achievementDedupeKey,
  computeFamilyAchievementProgress,
  computePersonalAchievementProgress,
  detectNewlyUnlocked,
  type AchievementProgress,
} from '../logic/achievements';

// Not store state — an internal request-ordering token only load() itself
// needs, matching healthStore.ts's own loadSeq for the same reason (a
// stale response for a family the app has since navigated away from must
// never clobber state for the current one).
let loadSeq = 0;

interface AchievementState {
  /** Every unlock ever recorded for the current family (both scopes) — the source of truth for "is X already unlocked" and for the achievements list UI. */
  unlocks: AchievementUnlock[];
  loading: boolean;
  error: string | null;
  loadedFamilyId: string | null;
  /**
   * Achievements that just crossed their threshold, queued for celebration
   * UI — consumed one at a time via consumeNextUnlocked() so a walk
   * completion that unlocks several at once (e.g. a milestone AND a
   * streak) celebrates each in turn rather than only the first.
   */
  newlyUnlocked: AchievementProgress[];

  load: (familyId: string) => Promise<void>;
  /**
   * Recomputes family + (if userId given) personal progress from `walks`
   * and durably persists any achievement that just crossed its threshold
   * (idempotent by construction — 0052's dedupe_key — so calling this
   * repeatedly, e.g. on every walk-list reload, is always safe and never
   * re-persists or re-queues the same unlock twice). Requires load()
   * to have already resolved for this family — see loadedFamilyId guard
   * below — so "already unlocked" is checked against real persisted
   * state, never an empty just-booted cache that would otherwise
   * re-celebrate a family's entire unlock history on first load.
   *
   * Deliberately does NOT itself check gamificationEnabled — that flag
   * (PRD's off-switch) only controls whether a caller SHOWS celebration
   * UI for it, per HomeScreen's own wiring; persisting the family's
   * unlock ledger is harmless and keeps other members' view of shared
   * family achievements accurate even while one member has opted out of
   * seeing popups themselves.
   */
  checkForNewUnlocks: (familyId: string, walks: Walk[], userId: string | null, swapRequests?: SwapRequestRow[]) => Promise<void>;
  consumeNextUnlocked: () => AchievementProgress | undefined;
}

export const useAchievementStore = create<AchievementState>((set, get) => ({
  unlocks: [],
  loading: false,
  error: null,
  loadedFamilyId: null,
  newlyUnlocked: [],

  load: async (familyId: string) => {
    set({ loading: true, error: null });
    const requestId = ++loadSeq;
    try {
      const unlocks = await repository.getAchievementUnlocks(familyId);
      if (requestId !== loadSeq) return; // superseded by a later load() call
      set({ unlocks, loadedFamilyId: familyId, loading: false });
    } catch (e) {
      if (requestId !== loadSeq) return;
      set({ error: e instanceof Error ? e.message : 'שגיאה בטעינת ההישגים', loading: false });
    }
  },

  checkForNewUnlocks: async (familyId: string, walks: Walk[], userId: string | null, swapRequests: SwapRequestRow[] = []) => {
    if (get().loadedFamilyId !== familyId) return; // see doc comment above
    const family = computeFamilyAchievementProgress(walks);
    const personal = userId ? computePersonalAchievementProgress(walks, userId, swapRequests) : [];
    const combined = [...family, ...personal];

    const alreadyUnlockedKeys = new Set(
      get().unlocks.map((u) => achievementDedupeKey({ key: u.achievementKey, userId: u.userId }))
    );
    const newly = detectNewlyUnlocked(combined, alreadyUnlockedKeys);
    if (newly.length === 0) return;

    const now = new Date().toISOString();
    const records: AchievementUnlock[] = newly.map((p) => ({
      id: generateId('unlock'),
      familyId,
      achievementKey: p.key,
      scope: p.scope,
      userId: p.userId,
      unlockedAt: now,
      createdAt: now,
    }));

    set((s) => ({
      unlocks: [...s.unlocks, ...records],
      newlyUnlocked: [...s.newlyUnlocked, ...newly],
    }));

    for (const record of records) {
      // Best-effort per-record — one failed write must never block the
      // others (or block the celebration queue, which is already
      // reflected in local state above) from persisting.
      try {
        await repository.upsertAchievementUnlock(record);
      } catch {
        /* the ledger write will simply retry via SyncQueue in offline-first mode; celebration UI is not blocked on it */
      }
    }
  },

  consumeNextUnlocked: () => {
    const [next, ...rest] = get().newlyUnlocked;
    if (next) set({ newlyUnlocked: rest });
    return next;
  },
}));
