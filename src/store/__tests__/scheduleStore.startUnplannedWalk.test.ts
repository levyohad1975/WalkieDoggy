import type { Walk } from '../../types';

/**
 * Migration 0054 / product decision: a spontaneous walk now supports a LIVE
 * flow ("התחל טיול" now, "סיים טיול" later) alongside the existing
 * retroactive one (addUnplannedWalk, unchanged — see its own tests in
 * scheduleStore.test.ts). startUnplannedWalk() is the store action behind
 * the new "▶ התחל טיול ספונטני" Home-screen button: it inserts a brand-new
 * `pending` isUnplanned walk row attributed to the caller, then immediately
 * runs it through the EXISTING startWalk() action (same start_walk RPC path
 * a scheduled walk already uses) rather than duplicating any lifecycle
 * logic.
 */
describe('scheduleStore.startUnplannedWalk', () => {
  const FAMILY_ID = 'family-main';

  let useScheduleStore: typeof import('../scheduleStore').useScheduleStore;

  beforeEach(async () => {
    jest.resetModules();
    const AsyncStorage = require('@react-native-async-storage/async-storage');
    await AsyncStorage.clear();
    ({ useScheduleStore } = require('../scheduleStore'));
  });

  it('creates a pending, self-attributed, un-scheduled walk and immediately transitions it to in_progress via the existing startWalk() action', async () => {
    await useScheduleStore.getState().load(FAMILY_ID);
    const before = useScheduleStore.getState().walks.length;

    const started = await useScheduleStore.getState().startUnplannedWalk(FAMILY_ID, 'dog-topi', 'user-eidan');
    expect(started).toBe(true);

    const state = useScheduleStore.getState();
    expect(state.actionError).toBeNull();
    expect(state.walks).toHaveLength(before + 1);

    const walk = state.walks.find((w) => w.isUnplanned && w.responsibleUserId === 'user-eidan' && w.status === 'in_progress');
    expect(walk).toBeTruthy();
    expect(walk?.familyId).toBe(FAMILY_ID);
    expect(walk?.dogId).toBe('dog-topi');
    expect(walk?.isUnplanned).toBe(true);
    // Never linked to a schedule entry/rotation — a genuinely ad-hoc walk.
    expect(walk?.scheduleEntryId).toBeUndefined();
    expect(walk?.startedAt).toBeTruthy();
    // Attributed to the caller, never a picker for someone else.
    expect(walk?.responsibleUserId).toBe('user-eidan');

    // The initial pending insert was persisted (case A's INSERT, migration
    // 0054) — a fresh reload still finds the row, even though in demo mode
    // (no repository.startWalk) the pending->in_progress step itself is an
    // in-memory-only optimistic update, same limitation startWalk() already
    // has for a scheduled walk with no remote configured.
    const { repository } = require('../../data');
    const persisted = await repository.getWalks(FAMILY_ID);
    expect(persisted.some((w: Walk) => w.id === walk?.id)).toBe(true);
  });

  it('rolls back and surfaces a visible actionError when the initial insert fails, without ever calling startWalk', async () => {
    await useScheduleStore.getState().load(FAMILY_ID);
    const { repository } = require('../../data');
    const saveSpy = jest.spyOn(repository, 'saveWalk').mockRejectedValueOnce(new Error('boom'));

    const before = useScheduleStore.getState().walks.length;
    const started = await useScheduleStore.getState().startUnplannedWalk(FAMILY_ID, 'dog-topi', 'user-maor');
    expect(started).toBe(false);

    const state = useScheduleStore.getState();
    expect(state.walks).toHaveLength(before); // optimistic insert was rolled back
    expect(state.actionError).toBeTruthy();

    saveSpy.mockRestore();
  });

  it('removes the orphaned pending row (rather than leaving a phantom walk) when the start_walk step itself fails, e.g. offline', async () => {
    await useScheduleStore.getState().load(FAMILY_ID);
    const before = useScheduleStore.getState().walks.length;

    const { repository } = require('../../data');
    // Simulate the same "server-authoritative RPC, no blind offline
    // replay" failure OfflineFirstRepository.startWalk already throws when
    // offline (see its own doc comment) — repository.startWalk is normally
    // undefined in demo mode, so this stands in for that online/remote path.
    (repository as unknown as { startWalk?: (id: string) => Promise<Walk> }).startWalk = jest
      .fn()
      .mockRejectedValueOnce(new Error('אין חיבור לשרת. כדי להתחיל מעקב טיול יש להתחבר לאינטרנט.'));

    const started = await useScheduleStore.getState().startUnplannedWalk(FAMILY_ID, 'dog-topi', 'user-aba');
    expect(started).toBe(false);

    const state = useScheduleStore.getState();
    // No orphaned pending walk left sitting around to confuse the next-walk card.
    expect(state.walks).toHaveLength(before);
    expect(state.actionError).toBeTruthy();

    const persisted = await repository.getWalks(FAMILY_ID);
    expect(persisted.some((w: Walk) => w.isUnplanned && w.responsibleUserId === 'user-aba' && w.status === 'pending')).toBe(false);

    delete (repository as unknown as { startWalk?: unknown }).startWalk;
  });

  it('ignores a second tap while the first spontaneous-walk save is still in flight', async () => {
    await useScheduleStore.getState().load(FAMILY_ID);
    const { repository } = require('../../data');
    let releaseSave!: () => void;
    const pendingSave = new Promise<void>((resolve) => { releaseSave = resolve; });
    const saveSpy = jest.spyOn(repository, 'saveWalk').mockReturnValueOnce(pendingSave);

    const firstTap = useScheduleStore.getState().startUnplannedWalk(FAMILY_ID, 'dog-topi', 'user-eidan');
    await Promise.resolve();
    expect(useScheduleStore.getState().isStartingUnplannedWalk).toBe(true);

    await expect(useScheduleStore.getState().startUnplannedWalk(FAMILY_ID, 'dog-topi', 'user-eidan')).resolves.toBe(false);
    expect(saveSpy).toHaveBeenCalledTimes(1);

    releaseSave();
    await expect(firstTap).resolves.toBe(true);
    expect(useScheduleStore.getState().isStartingUnplannedWalk).toBe(false);
    expect(useScheduleStore.getState().walks.filter((walk) => walk.isUnplanned && walk.status === 'in_progress')).toHaveLength(1);
    saveSpy.mockRestore();
  });
});
