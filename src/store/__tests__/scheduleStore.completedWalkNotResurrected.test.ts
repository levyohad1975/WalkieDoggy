import type { ScheduleEntry, Walk } from '../../types';
import { computeNextWalk } from '../../logic/nextWalk';

/**
 * P0 real-device fix, round 3 — after a29ee55's canonical-id reconciliation
 * confirmed Start Walk working on a real iPhone PWA, a NEW failure
 * surfaced: once a walk was legitimately finished (status 'done'), the
 * SAME scheduled occurrence reappeared as a second, separately startable
 * pending walk after a foreground reload.
 *
 * Root cause: a stale local-only pending duplicate for the same
 * schedule_entry_id (left over from the exact local-id race
 * OfflineFirstRepository.resolveCanonicalWalkId resolves for Start — see
 * its own doc comment) could survive in the local cache and reach
 * useScheduleStore's `walks` state alongside the real, already-done
 * canonical walk. See src/logic/nextWalk.ts's dedupeCanonicalWalks and
 * offlineFirstRepository.ts's pruneAndDedupeCanonicalWalks for the fix:
 * repository.getWalks() now collapses every group of walks sharing a
 * schedule_entry_id down to exactly one (whichever is furthest along the
 * lifecycle) on every call, so a stale pending duplicate can never reach
 * this store's state no matter how it got into the local cache.
 *
 * This test proves it end-to-end at the layer the UI actually reads from:
 * useScheduleStore's own `walks` state and computeNextWalk (Home's "next
 * walk" picker), using the REAL repository (demo/local mode — no Supabase
 * configured in tests, so `repository` is OfflineFirstRepository wrapping
 * a plain LocalRepository), not a mock of the data layer.
 */
describe('scheduleStore — a completed scheduled occurrence never comes back as a second pending walk', () => {
  const FAMILY_ID = 'family-main';
  let useScheduleStore: typeof import('../scheduleStore').useScheduleStore;

  beforeEach(async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-10-01T10:00:00.000Z'));
    jest.resetModules();
    const AsyncStorage = require('@react-native-async-storage/async-storage');
    await AsyncStorage.clear();
    ({ useScheduleStore } = require('../scheduleStore'));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('a reload after Finish shows exactly one walk for the occurrence — done — never a second startable pending copy', async () => {
    await useScheduleStore.getState().load(FAMILY_ID);
    const { repository } = require('../../data');
    const template = useScheduleStore.getState().walks[0];
    expect(template).toBeTruthy();

    // A far-past entry/occurrence, deliberately outside the active
    // backfill/orphan-repair horizon — isolates this test to the
    // dedup fix itself, not any entry-generation logic.
    const entry: ScheduleEntry = {
      id: 'entry-already-fulfilled',
      familyId: FAMILY_ID,
      dogId: template.dogId,
      date: '2026-09-01',
      time: '08:00',
      responsibleUserId: template.responsibleUserId,
      createdAt: new Date().toISOString(),
    };
    await repository.addScheduleEntries([entry]);

    const canonicalDone: Walk = {
      id: 'walk-canonical-done',
      familyId: FAMILY_ID,
      scheduleEntryId: entry.id,
      dogId: entry.dogId,
      date: entry.date,
      scheduledTime: entry.time,
      responsibleUserId: entry.responsibleUserId,
      status: 'done',
      completedAt: '2026-09-01T08:20:00.000Z',
      completedByUserId: entry.responsibleUserId,
      createdAt: entry.createdAt,
      updatedAt: '2026-09-01T08:20:00.000Z',
    };
    await repository.saveWalk(canonicalDone);

    // The stale duplicate: a DIFFERENT id, still 'pending', for the exact
    // same schedule_entry_id — exactly what resolveCanonicalWalkId's doc
    // comment describes as the local-only "losing" side of the race, never
    // its own row on the server and never cleaned up by anything that ran
    // before this reload.
    const staleDuplicate: Walk = {
      ...canonicalDone,
      id: 'walk-stale-pending',
      status: 'pending',
      completedAt: undefined,
      completedByUserId: undefined,
    };
    await repository.saveWalk(staleDuplicate);

    await useScheduleStore.getState().load(FAMILY_ID);
    const { walks } = useScheduleStore.getState();
    const forThisEntry = walks.filter((w) => w.scheduleEntryId === entry.id);

    expect(forThisEntry).toHaveLength(1);
    expect(forThisEntry[0].status).toBe('done');
    expect(forThisEntry[0].id).toBe('walk-canonical-done');

    // The exact reported symptom: Home's "next walk" picker must not
    // offer this already-fulfilled occurrence as startable again.
    const next = computeNextWalk(walks, new Date('2026-10-01T10:00:00.000Z'));
    expect(next?.scheduleEntryId).not.toBe(entry.id);
  });

  it('repeated reloads stay stable — the stale duplicate does not resurface on a second or third load()', async () => {
    await useScheduleStore.getState().load(FAMILY_ID);
    const { repository } = require('../../data');
    const template = useScheduleStore.getState().walks[0];

    const entry: ScheduleEntry = {
      id: 'entry-already-fulfilled-2',
      familyId: FAMILY_ID,
      dogId: template.dogId,
      date: '2026-09-02',
      time: '08:00',
      responsibleUserId: template.responsibleUserId,
      createdAt: new Date().toISOString(),
    };
    await repository.addScheduleEntries([entry]);

    const canonicalDone: Walk = {
      id: 'walk-canonical-done-2',
      familyId: FAMILY_ID,
      scheduleEntryId: entry.id,
      dogId: entry.dogId,
      date: entry.date,
      scheduledTime: entry.time,
      responsibleUserId: entry.responsibleUserId,
      status: 'done',
      completedAt: '2026-09-02T08:20:00.000Z',
      completedByUserId: entry.responsibleUserId,
      createdAt: entry.createdAt,
      updatedAt: '2026-09-02T08:20:00.000Z',
    };
    await repository.saveWalk(canonicalDone);
    await repository.saveWalk({ ...canonicalDone, id: 'walk-stale-pending-2', status: 'pending', completedAt: undefined, completedByUserId: undefined });

    await useScheduleStore.getState().load(FAMILY_ID);
    await useScheduleStore.getState().load(FAMILY_ID);
    await useScheduleStore.getState().load(FAMILY_ID);

    const forThisEntry = useScheduleStore.getState().walks.filter((w) => w.scheduleEntryId === entry.id);
    expect(forThisEntry).toHaveLength(1);
    expect(forThisEntry[0].status).toBe('done');
  });
});
