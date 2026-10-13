import AsyncStorage from '@react-native-async-storage/async-storage';
import { LocalRepository } from '../localRepository';
import { DEMO_FAMILY } from '../demoData';
import type { Walk } from '../../types';

/**
 * Real-device QA fix — "Schedule save spinner lingers ~10s", round 2.
 * On-device timestamped instrumentation (see perfTrace.ts) traced the
 * delay past the earlier network-round-trip fixes (6a369d8, e42936f) to
 * HERE: saveWalk() does a FULL read-modify-write of this repository's
 * entire single-blob local cache (persist() -> JSON.stringify + one
 * AsyncStorage.setItem of EVERYTHING — every user, dog, rule, entry,
 * walk, health task, GPS session, achievement unlock) on EVERY call.
 * Calling it once per generated future occurrence (up to
 * GENERATE_DAYS_AHEAD = 14) therefore rewrote that whole blob to
 * AsyncStorage up to 14 times in a row for one Save tap — on a real
 * device, with a real family's accumulated history, this is the actual
 * dominant cost neither earlier fix touched (both targeted the remote
 * network calls instead). saveWalks() replaces that: ALL given walks are
 * applied to the in-memory cache first, then persist() runs exactly
 * ONCE for the whole batch.
 */
function walkFixture(id: string, scheduleEntryId: string): Walk {
  return {
    id,
    familyId: DEMO_FAMILY.id,
    scheduleEntryId,
    dogId: 'dog-topi',
    date: '2026-10-10',
    scheduledTime: '18:00',
    responsibleUserId: 'user-aba',
    status: 'pending',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

describe('LocalRepository.saveWalks — batched local persistence', () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
  });

  it('persists a whole batch of N walks with exactly ONE AsyncStorage.setItem call, never N', async () => {
    const repo = new LocalRepository();
    await repo.getWalks(DEMO_FAMILY.id); // trigger seed/load so the cache exists before we measure

    const setItemSpy = jest.spyOn(AsyncStorage, 'setItem');
    setItemSpy.mockClear();

    const walks = Array.from({ length: 14 }, (_, i) => walkFixture(`walk-${i}`, `entry-${i}`));
    await repo.saveWalks(walks);

    expect(setItemSpy).toHaveBeenCalledTimes(1);

    const allWalks = await repo.getWalks(DEMO_FAMILY.id);
    for (const w of walks) {
      expect(allWalks.some((aw) => aw.id === w.id)).toBe(true);
    }

    setItemSpy.mockRestore();
  });

  it('is equivalent to calling saveWalk() once per walk, just with one persist — same upsert-by-id-or-append result', async () => {
    const repo = new LocalRepository();
    await repo.getWalks(DEMO_FAMILY.id);

    const walks = [walkFixture('walk-a', 'entry-a'), walkFixture('walk-b', 'entry-b')];
    await repo.saveWalks(walks);

    // Update one of them in a second batch call — upsert semantics, not
    // a second, duplicate append.
    const updated: Walk = { ...walks[0], scheduledTime: '19:00', updatedAt: new Date().toISOString() };
    await repo.saveWalks([updated]);

    const allWalks = await repo.getWalks(DEMO_FAMILY.id);
    const matches = allWalks.filter((w) => w.id === 'walk-a');
    expect(matches).toHaveLength(1); // never duplicated
    expect(matches[0].scheduledTime).toBe('19:00');
  });

  it("never overwrites a walk someone else already completed — same concurrent-completion guard as saveWalk()", async () => {
    const repo = new LocalRepository();
    const seeded = await repo.getWalks(DEMO_FAMILY.id);
    const target = seeded.find((w) => w.status === 'pending');
    if (!target) throw new Error('demo seed has no pending walk to use for this test');

    const firstCompletion: Walk = { ...target, status: 'done', completedByUserId: 'user-a', updatedAt: new Date().toISOString() };
    await repo.saveWalks([firstCompletion]);

    const secondCompletion: Walk = { ...target, status: 'done', completedByUserId: 'user-b', updatedAt: new Date().toISOString() };
    await repo.saveWalks([secondCompletion]);

    const after = await repo.getWalks(DEMO_FAMILY.id);
    expect(after.find((w) => w.id === target.id)?.completedByUserId).toBe('user-a');
  });

  it('is a no-op (no persist at all) for an empty batch', async () => {
    const repo = new LocalRepository();
    await repo.getWalks(DEMO_FAMILY.id);

    const setItemSpy = jest.spyOn(AsyncStorage, 'setItem');
    setItemSpy.mockClear();

    await repo.saveWalks([]);

    expect(setItemSpy).not.toHaveBeenCalled();
    setItemSpy.mockRestore();
  });
});
