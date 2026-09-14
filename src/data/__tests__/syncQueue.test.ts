import AsyncStorage from '@react-native-async-storage/async-storage';
import { SyncQueue, setSyncQueueActorGetter } from '../syncQueue';
import type { Repository } from '../repository';
import type { FamilyUser } from '../../types';

function fakeUser(id: string): FamilyUser {
  return { id, familyId: 'family-main', name: 'x', avatar: '🙂', color: '#000', remindersEnabled: true, createdAt: new Date().toISOString() };
}

function stubRemote(overrides: Partial<Repository> = {}): Repository {
  return {
    getFamily: jest.fn(),
    getUsers: jest.fn(),
    createUser: jest.fn().mockResolvedValue(undefined),
    upsertUser: jest.fn().mockResolvedValue(undefined),
    deleteUser: jest.fn(),
    deleteFamilyMember: jest.fn(),
    updateUserReminderSetting: jest.fn().mockResolvedValue(undefined),
    getDog: jest.fn(),
    upsertDog: jest.fn(),
    getScheduleRules: jest.fn(),
    upsertScheduleRule: jest.fn(),
    deleteScheduleRule: jest.fn(),
    getScheduleEntries: jest.fn(),
    addScheduleEntries: jest.fn(),
    updateScheduleEntry: jest.fn().mockResolvedValue(undefined),
    deleteScheduleEntry: jest.fn(),
    getWalks: jest.fn(),
    saveWalk: jest.fn().mockResolvedValue(undefined),
    getNotificationSettings: jest.fn(),
    ...overrides,
  } as unknown as Repository;
}

describe('SyncQueue — permanent vs retryable conflict handling', () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
    // These tests are about the retryable/permanent split, not ownership —
    // tag everything as one consistent "currently claimed" profile so
    // flush()'s Round 4 ownership check (see its doc comment) lets these
    // items through to apply() exactly as before, rather than skipping or
    // quarantining them.
    setSyncQueueActorGetter(() => 'test-user');
  });

  afterEach(() => {
    setSyncQueueActorGetter(() => null);
  });

  it('keeps a retryable (no Postgres code) failure queued and stops the flush there', async () => {
    const queue = new SyncQueue();
    await queue.enqueue({ type: 'upsertUser', payload: fakeUser('a') });
    await queue.enqueue({ type: 'upsertUser', payload: fakeUser('b') });

    const remote = stubRemote({
      upsertUser: jest.fn().mockRejectedValue(new Error('network timeout')),
    });

    const result = await queue.flush(remote);
    expect(result).toEqual({ succeeded: 0, remaining: 2, conflicted: 0, quarantined: 0 });
    expect(await queue.size()).toBe(2);
    expect(await queue.getConflicts()).toEqual([]);
  });

  it('drops a permanent 23505 unique-violation, records it as a conflict, and continues flushing later ops', async () => {
    const queue = new SyncQueue();
    await queue.enqueue({
      type: 'updateScheduleEntry',
      payload: { id: 'entry-1', familyId: 'family-main', dogId: 'dog-1', date: '2026-08-30', time: '22:00', responsibleUserId: 'a', createdAt: new Date().toISOString() },
    });
    await queue.enqueue({ type: 'saveWalk', payload: { id: 'walk-1' } as never });

    const conflictError = Object.assign(new Error('duplicate key value violates unique constraint "schedule_entries_dog_id_date_time_key"'), {
      code: '23505',
    });
    const remote = stubRemote({
      updateScheduleEntry: jest.fn().mockRejectedValue(conflictError),
      saveWalk: jest.fn().mockResolvedValue(undefined),
    });

    const result = await queue.flush(remote);
    expect(result).toEqual({ succeeded: 1, remaining: 0, conflicted: 1, quarantined: 0 });
    expect(await queue.size()).toBe(0);

    const conflicts = await queue.getConflicts();
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].code).toBe('23505');
    expect(conflicts[0].op.type).toBe('updateScheduleEntry');
  });

  it('does not let an earlier permanent conflict block an unrelated later operation', async () => {
    const queue = new SyncQueue();
    await queue.enqueue({ type: 'upsertUser', payload: fakeUser('a') });
    await queue.enqueue({ type: 'upsertUser', payload: fakeUser('b') });
    await queue.enqueue({ type: 'upsertUser', payload: fakeUser('c') });

    const notNull = Object.assign(new Error('null value in column violates not-null constraint'), { code: '23502' });
    const upsertUser = jest
      .fn()
      .mockRejectedValueOnce(notNull)
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined);
    const remote = stubRemote({ upsertUser });

    const result = await queue.flush(remote);
    expect(result).toEqual({ succeeded: 2, remaining: 0, conflicted: 1, quarantined: 0 });
    expect(upsertUser).toHaveBeenCalledTimes(3);
  });

  it('clearConflicts empties the recorded conflict list', async () => {
    const queue = new SyncQueue();
    await queue.enqueue({ type: 'upsertUser', payload: fakeUser('a') });
    const conflictError = Object.assign(new Error('conflict'), { code: '23514' });
    await queue.flush(stubRemote({ upsertUser: jest.fn().mockRejectedValue(conflictError) }));
    expect(await queue.getConflicts()).toHaveLength(1);

    await queue.clearConflicts();
    expect(await queue.getConflicts()).toEqual([]);
  });

  /**
   * QA pass v3, issue 2 regression test: an RLS rejection (42501) used to be
   * classified as RETRYABLE (no special-cased Postgres code prefix), so
   * flush() `break`s on it and every LATER queued operation — for any user,
   * any feature — stays stuck behind it forever. This is the same shape of
   * bug the 23xxx fix above already solved for integrity-constraint
   * violations; this test proves the fix now also covers permission/policy
   * failures, and is exactly the scenario issue 15 (presence) hinted at:
   * a rejected `upsertUser` write must never block a later, unrelated
   * `saveWalk`.
   */
  it('drops a permanent 42501 (RLS/insufficient_privilege) rejection, records it as a conflict, and does not block a later unrelated saveWalk', async () => {
    const queue = new SyncQueue();
    await queue.enqueue({ type: 'upsertUser', payload: fakeUser('a') });
    await queue.enqueue({ type: 'saveWalk', payload: { id: 'walk-after-rls-failure' } as never });

    const rlsError = Object.assign(new Error('new row violates row-level security policy for table "users"'), {
      code: '42501',
    });
    const remote = stubRemote({
      upsertUser: jest.fn().mockRejectedValue(rlsError),
      saveWalk: jest.fn().mockResolvedValue(undefined),
    });

    const result = await queue.flush(remote);
    expect(result).toEqual({ succeeded: 1, remaining: 0, conflicted: 1, quarantined: 0 });
    expect(await queue.size()).toBe(0);
    expect(remote.saveWalk).toHaveBeenCalledTimes(1); // NOT blocked behind the RLS failure

    const conflicts = await queue.getConflicts();
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].code).toBe('42501');
    expect(conflicts[0].op.type).toBe('upsertUser');
  });

  /**
   * QA pass v3, issue 1 regression test: familyStore.addUser() now enqueues
   * a distinct `createUser` op (routed to remote.createUser — the INSERT-
   * only, admin-authorized path) rather than `upsertUser` (now UPDATE-only).
   */
  it('routes a queued createUser op to remote.createUser, not remote.upsertUser', async () => {
    const queue = new SyncQueue();
    await queue.enqueue({ type: 'createUser', payload: fakeUser('new-member') });

    const createUser = jest.fn().mockResolvedValue(undefined);
    const upsertUser = jest.fn().mockResolvedValue(undefined);
    const result = await queue.flush(stubRemote({ createUser, upsertUser }));

    expect(createUser).toHaveBeenCalledWith(expect.objectContaining({ id: 'new-member' }));
    expect(upsertUser).not.toHaveBeenCalled();
    expect(result).toEqual({ succeeded: 1, remaining: 0, conflicted: 0, quarantined: 0 });
  });
});

/**
 * Round 3, issue 3 (audit offline-replay): a shared device's queue can hold
 * a write enqueued under one claimed profile that hasn't reached Supabase
 * yet. hasPendingForOtherUser() is what authStore.signIn() checks before
 * letting the device re-claim itself as a DIFFERENT family member — see its
 * doc comment for why an unflushed queued write could otherwise end up
 * logged (by migrations/0005_*.sql's audit triggers) as performed by the
 * wrong member once it finally syncs.
 */
describe('SyncQueue — actor tagging for the cross-profile audit-integrity guard', () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
    setSyncQueueActorGetter(() => null); // reset between tests — see afterEach below too
  });

  afterEach(() => {
    setSyncQueueActorGetter(() => null);
  });

  it('tags each enqueued op with whatever the wired actor-getter currently returns', async () => {
    setSyncQueueActorGetter(() => 'user-a');
    const queue = new SyncQueue();
    await queue.enqueue({ type: 'upsertUser', payload: fakeUser('a') });

    expect(await queue.hasPendingForOtherUser('user-a')).toBe(false); // same profile that queued it
    expect(await queue.hasPendingForOtherUser('user-b')).toBe(true); // a different profile signing in next
  });

  it('blocks EVERY profile switch — even back to no particular profile — while an untagged (claimedByUserId null) item is pending', async () => {
    setSyncQueueActorGetter(() => null);
    const queue = new SyncQueue();
    await queue.enqueue({ type: 'upsertUser', payload: fakeUser('a') });

    // No `userId` is safe to compare against an unknown owner — this is the
    // conservative default Round 3's SyncQueue migration/audit-integrity
    // work requires (see hasPendingForOtherUser's doc comment): better to
    // block a profile switch than risk silently replaying someone's queued
    // write under the wrong profile.
    expect(await queue.hasPendingForOtherUser('anyone')).toBe(true);
    expect(await queue.hasPendingForOtherUser('user-a')).toBe(true);
  });

  it('a successful flush drains the queue, so a later profile switch is no longer blocked', async () => {
    setSyncQueueActorGetter(() => 'user-a');
    const queue = new SyncQueue();
    await queue.enqueue({ type: 'upsertUser', payload: fakeUser('a') });
    await queue.flush(stubRemote());

    expect(await queue.hasPendingForOtherUser('user-b')).toBe(false);
  });
});

/**
 * Round 4 gap fix: hasPendingForOtherUser() only ever gated authStore's
 * PROFILE SWITCH — it never stopped flush() itself from replaying a queued
 * write. Since App.tsx calls repository.trySync() automatically at startup
 * and on every foreground, BEFORE anyone attempts to switch profiles, a
 * queued item belonging to a different (or unknown) profile could still be
 * auto-replayed under whichever profile happens to be currently claimed —
 * exactly the audit misattribution the tagging design exists to prevent.
 * flush() now checks ownership itself (see its doc comment); these tests
 * prove that directly, by inspecting which `remote` methods flush() did or
 * did not actually call.
 */
describe('SyncQueue — flush() verifies current profile ownership before replaying (Round 4)', () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
    setSyncQueueActorGetter(() => null);
  });

  afterEach(() => {
    setSyncQueueActorGetter(() => null);
  });

  it('a legacy/untagged (claimedByUserId null) item is never attempted against the server, under any profile', async () => {
    // Simulate a v3-migrated item directly (see the v3 -> v4 describe block
    // below for the migration path itself) rather than depending on it here.
    await AsyncStorage.setItem(
      'dog-walk-family:sync-queue:v4',
      JSON.stringify([{ op: { type: 'upsertUser', payload: fakeUser('a') }, claimedByUserId: null }])
    );
    setSyncQueueActorGetter(() => 'user-a'); // SOME profile is claimed on the device

    const upsertUser = jest.fn().mockResolvedValue(undefined);
    const queue = new SyncQueue();
    const result = await queue.flush(stubRemote({ upsertUser }));

    expect(upsertUser).not.toHaveBeenCalled(); // never even attempted — no actor to trust
    expect(result).toEqual({ succeeded: 0, remaining: 0, conflicted: 0, quarantined: 1 });
    expect(await queue.size()).toBe(0); // removed from the live queue...
    const quarantined = await queue.getQuarantined();
    expect(quarantined).toHaveLength(1); // ...but surfaced, not silently dropped
    expect(quarantined[0].op.type).toBe('upsertUser');
  });

  it('an item tagged for profile A is never replayed while profile B is currently claimed', async () => {
    setSyncQueueActorGetter(() => 'user-a');
    const queue = new SyncQueue();
    await queue.enqueue({ type: 'upsertUser', payload: fakeUser('a') });

    setSyncQueueActorGetter(() => 'user-b'); // device has since switched to B
    const upsertUser = jest.fn().mockResolvedValue(undefined);
    const result = await queue.flush(stubRemote({ upsertUser }));

    expect(upsertUser).not.toHaveBeenCalled(); // A's write must not run under B's claim
    expect(result).toEqual({ succeeded: 0, remaining: 1, conflicted: 0, quarantined: 0 });
    expect(await queue.size()).toBe(1); // left queued, untouched, for when A returns
  });

  it('an item tagged for profile A replays normally once profile A is the currently claimed profile', async () => {
    setSyncQueueActorGetter(() => 'user-a');
    const queue = new SyncQueue();
    await queue.enqueue({ type: 'upsertUser', payload: fakeUser('a') });

    const upsertUser = jest.fn().mockResolvedValue(undefined);
    const result = await queue.flush(stubRemote({ upsertUser })); // still 'user-a' at flush time

    expect(upsertUser).toHaveBeenCalledWith(
  expect.objectContaining({
    id: 'a',
    familyId: 'family-main',
  }),
);
    expect(result).toEqual({ succeeded: 1, remaining: 0, conflicted: 0, quarantined: 0 });
  });

  it('an unrelated operation belonging to the CURRENTLY claimed profile still flushes even while an earlier item for a different profile is stuck', async () => {
    setSyncQueueActorGetter(() => 'user-a');
    const queue = new SyncQueue();
    await queue.enqueue({ type: 'upsertUser', payload: fakeUser('a') }); // A's, queued first

    setSyncQueueActorGetter(() => 'user-b');
    await queue.enqueue({ type: 'upsertUser', payload: fakeUser('b') }); // B's, queued second, B now current

    const upsertUser = jest.fn().mockResolvedValue(undefined);
    const result = await queue.flush(stubRemote({ upsertUser }));

    // Only B's own operation ran — A's stays queued rather than blocking B,
    // and (just as importantly) rather than running under B's claim.
    expect(upsertUser).toHaveBeenCalledTimes(1);
    expect(upsertUser).toHaveBeenCalledWith(
  expect.objectContaining({
    id: 'b',
    familyId: 'family-main',
  }),
);
    expect(result).toEqual({ succeeded: 1, remaining: 1, conflicted: 0, quarantined: 0 });

    setSyncQueueActorGetter(() => 'user-a'); // A returns to this device
    const secondResult = await queue.flush(stubRemote({ upsertUser }));
    expect(upsertUser).toHaveBeenCalledWith(
  expect.objectContaining({
    id: 'a',
    familyId: 'family-main',
  }),
);
    expect(secondResult).toEqual({ succeeded: 1, remaining: 0, conflicted: 0, quarantined: 0 });
  });

  it('no audit actor is ever silently misattributed: a startup-time flush before any profile is restored neither drops nor replays a tagged item', async () => {
    setSyncQueueActorGetter(() => 'user-a');
    const queue = new SyncQueue();
    await queue.enqueue({ type: 'upsertUser', payload: fakeUser('a') });

    // Simulates App.tsx's trySync() firing before restoreSession() has set
    // currentUserId (the exact startup-ordering risk called out this round).
    setSyncQueueActorGetter(() => null);
    const upsertUser = jest.fn().mockResolvedValue(undefined);
    const result = await queue.flush(stubRemote({ upsertUser }));

    expect(upsertUser).not.toHaveBeenCalled(); // not replayed under "no profile"
    expect(result).toEqual({ succeeded: 0, remaining: 1, conflicted: 0, quarantined: 0 }); // not quarantined either — it IS tagged, just not currently claimed
    expect(await queue.size()).toBe(1);

    // Once restoreSession() actually resolves the same profile, the next
    // (foreground/mutation-triggered) flush picks it up correctly.
    setSyncQueueActorGetter(() => 'user-a');
    const laterResult = await queue.flush(stubRemote({ upsertUser }));
    expect(upsertUser).toHaveBeenCalledWith(
  expect.objectContaining({
    id: 'a',
    familyId: 'family-main',
  }),
);
    expect(laterResult).toEqual({ succeeded: 1, remaining: 0, conflicted: 0, quarantined: 0 });
  });
});

/**
 * Round 3, issue 2: the queue's storage key changed from
 * `dog-walk-family:sync-queue:v3` (bare SyncOperation[], no owner tag) to
 * `:v4` (QueuedItem[] — see the class doc comments). A device that still has
 * a v3 queue on disk when it updates must have those pending offline writes
 * carried forward, not silently abandoned just because the key changed.
 */
describe('SyncQueue — v3 -> v4 migration', () => {
  const V3_KEY = 'dog-walk-family:sync-queue:v3';
  const V4_KEY = 'dog-walk-family:sync-queue:v4';

  beforeEach(async () => {
    await AsyncStorage.clear();
    setSyncQueueActorGetter(() => null);
  });

  afterEach(() => {
    setSyncQueueActorGetter(() => null);
  });

  it('preserves every v3 operation, converting each to the v4 shape with an untagged (null) owner', async () => {
    const legacyOps = [
      { type: 'upsertUser', payload: fakeUser('a') },
      { type: 'saveWalk', payload: { id: 'walk-legacy' } as never },
    ];
    await AsyncStorage.setItem(V3_KEY, JSON.stringify(legacyOps));

    const queue = new SyncQueue();
    expect(await queue.size()).toBe(2);

    // Legacy v3 items have no trustworthy actor identity, so they must never
// be replayed under whichever profile happens to be active after upgrade.
// They are preserved by moving them to quarantine instead.
const upsertUser = jest.fn().mockResolvedValue(undefined);
const saveWalk = jest.fn().mockResolvedValue(undefined);
const result = await queue.flush(stubRemote({ upsertUser, saveWalk }));

expect(result).toEqual({
  succeeded: 0,
  remaining: 0,
  conflicted: 0,
  quarantined: 2,
});

expect(upsertUser).not.toHaveBeenCalled();
expect(saveWalk).not.toHaveBeenCalled();
  });

  it('removes the v3 key only after the v4 conversion is actually persisted', async () => {
    await AsyncStorage.setItem(V3_KEY, JSON.stringify([{ type: 'upsertUser', payload: fakeUser('a') }]));

    const queue = new SyncQueue();
    await queue.size(); // triggers load() -> migrateLegacyV3Queue()

    expect(await AsyncStorage.getItem(V3_KEY)).toBeNull(); // migrated away
    const v4Raw = await AsyncStorage.getItem(V4_KEY);
    expect(v4Raw).not.toBeNull();
    expect(JSON.parse(v4Raw as string)).toEqual([
  {
    op: {
      type: 'upsertUser',
      payload: expect.objectContaining({
        id: 'a',
        familyId: 'family-main',
      }),
    },
    claimedByUserId: null,
  },
]);
  });

  it('legacy pending operations cannot be silently replayed after switching profile — they block every switch until flushed', async () => {
    await AsyncStorage.setItem(V3_KEY, JSON.stringify([{ type: 'upsertUser', payload: fakeUser('a') }]));

    const queue = new SyncQueue();
    // Neither the profile that (unknowably) originally queued this, nor a
    // fresh one signing in on this shared device, gets a free pass — see
    // hasPendingForOtherUser's doc comment on why a null-tagged item must
    // block EVERY switch, not just a "different" one it can't identify.
    expect(await queue.hasPendingForOtherUser('user-a')).toBe(true);
    expect(await queue.hasPendingForOtherUser('user-b')).toBe(true);

    // Once it actually flushes, the switch is no longer blocked.
    await queue.flush(stubRemote());
    expect(await queue.hasPendingForOtherUser('user-b')).toBe(false);
  });

  it('an existing v4 queue loads unchanged and never triggers the v3 migration path', async () => {
    const v4Data = [{ op: { type: 'upsertUser', payload: fakeUser('a') }, claimedByUserId: 'user-a' }];
    await AsyncStorage.setItem(V4_KEY, JSON.stringify(v4Data));
    await AsyncStorage.setItem(V3_KEY, JSON.stringify([{ type: 'upsertUser', payload: fakeUser('stale-v3-should-be-ignored') }]));

    const queue = new SyncQueue();
    expect(await queue.size()).toBe(1); // only the v4 item — the v3 key is left untouched, not merged in
    expect(await queue.hasPendingForOtherUser('user-a')).toBe(false);
    expect(await AsyncStorage.getItem(V3_KEY)).not.toBeNull(); // v3 migration never ran
  });

  it('discards corrupt legacy v3 data instead of throwing, and still ends up with a valid empty v4 queue', async () => {
    await AsyncStorage.setItem(V3_KEY, 'not valid json{{{');
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);

    const queue = new SyncQueue();
    expect(await queue.size()).toBe(0);
    expect(await AsyncStorage.getItem(V3_KEY)).toBeNull(); // still cleaned up

    errorSpy.mockRestore();
  });
});

/**
 * Round 7 fix (Part 3): OfflineFirstRepository.deleteFamilyMember() no longer
 * ever enqueues a `deleteFamilyMember` op — it's offline-exempt now (see its
 * own doc comment). A device that already had one persisted from an OLDER
 * app version must not have it blindly replayed against the server on the
 * next flush(); load() discards any such legacy entry instead (see
 * discardLegacyDeleteFamilyMember's doc comment for the full reasoning).
 */
describe('SyncQueue — legacy deleteFamilyMember entries are discarded, never replayed (round 7 fix)', () => {
  const V4_KEY = 'dog-walk-family:sync-queue:v4';

  beforeEach(async () => {
    await AsyncStorage.clear();
    setSyncQueueActorGetter(() => 'user-a');
  });

  afterEach(() => {
    setSyncQueueActorGetter(() => null);
  });

  const legacyPayload = { userId: 'user-x', updatedRules: [], updatedEntries: [], updatedWalks: [] };

  it('a pre-fix persisted deleteFamilyMember entry is removed from the queue on load and never reaches the server', async () => {
    await AsyncStorage.setItem(
      V4_KEY,
      JSON.stringify([{ op: { type: 'deleteFamilyMember', payload: legacyPayload }, claimedByUserId: 'user-a' }])
    );

    const queue = new SyncQueue();
    expect(await queue.size()).toBe(0); // discarded before ever being counted as pending

    const deleteFamilyMember = jest.fn().mockResolvedValue(undefined);
    const result = await queue.flush(stubRemote({ deleteFamilyMember }));

    expect(deleteFamilyMember).not.toHaveBeenCalled(); // never blindly replayed
    expect(result).toEqual({ succeeded: 0, remaining: 0, conflicted: 0, quarantined: 0 });
  });

  it('records the discarded entry in quarantine for visibility rather than silently vanishing it', async () => {
    await AsyncStorage.setItem(
      V4_KEY,
      JSON.stringify([{ op: { type: 'deleteFamilyMember', payload: legacyPayload }, claimedByUserId: 'user-a' }])
    );

    const queue = new SyncQueue();
    await queue.size(); // triggers load()

    const quarantined = await queue.getQuarantined();
    expect(quarantined).toHaveLength(1);
    expect(quarantined[0].op.type).toBe('deleteFamilyMember');
  });

  it('leaves other queued operations in the same persisted queue untouched and still flushable', async () => {
    await AsyncStorage.setItem(
      V4_KEY,
      JSON.stringify([
        { op: { type: 'deleteFamilyMember', payload: legacyPayload }, claimedByUserId: 'user-a' },
        { op: { type: 'upsertUser', payload: fakeUser('a') }, claimedByUserId: 'user-a' },
      ])
    );

    const queue = new SyncQueue();
    expect(await queue.size()).toBe(1); // only the surviving upsertUser

    const upsertUser = jest.fn().mockResolvedValue(undefined);
    const deleteFamilyMember = jest.fn().mockResolvedValue(undefined);
    const result = await queue.flush(stubRemote({ upsertUser, deleteFamilyMember }));

    expect(deleteFamilyMember).not.toHaveBeenCalled();
    expect(upsertUser).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ succeeded: 1, remaining: 0, conflicted: 0, quarantined: 0 });
  });

  it('does not crash and starts clean when no legacy entry is present', async () => {
    const queue = new SyncQueue();
    await queue.enqueue({ type: 'upsertUser', payload: fakeUser('a') });
    expect(await queue.size()).toBe(1);
    expect(await queue.getQuarantined()).toEqual([]);
  });
});

function fakeWalk(id: string, overrides: Partial<import('../../types').Walk> = {}): import('../../types').Walk {
  return {
    id,
    familyId: 'family-main',
    dogId: 'dog-1',
    date: '2026-08-31',
    scheduledTime: '07:00',
    responsibleUserId: 'user-aba',
    status: 'done',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

/**
 * A2 regression tests: hasPendingSaveWalk / getConflictForWalk are what
 * scheduleStore.markDone() now checks before trusting a post-write server
 * refetch (see that function's doc comment) — this is the concrete fix for
 * "completion not syncing correctly across devices" (an optimistic 'done'
 * state silently reverting when the remote write hadn't landed yet, with no
 * error shown).
 */
describe('SyncQueue — hasPendingSaveWalk / getConflictForWalk (A2 fix)', () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
    setSyncQueueActorGetter(() => 'test-user');
  });

  afterEach(() => {
    setSyncQueueActorGetter(() => null);
  });

  it('reports a saveWalk still queued (retryable failure) as pending, and no conflict', async () => {
    const queue = new SyncQueue();
    await queue.enqueue({ type: 'saveWalk', payload: fakeWalk('walk-1') });

    const remote = stubRemote({ saveWalk: jest.fn().mockRejectedValue(new Error('network timeout')) });
    await queue.flush(remote);

    expect(await queue.hasPendingSaveWalk('walk-1')).toBe(true);
    expect(await queue.getConflictForWalk('walk-1')).toBeUndefined();
  });

  it('reports no longer pending, and no conflict, once the write succeeds', async () => {
    const queue = new SyncQueue();
    await queue.enqueue({ type: 'saveWalk', payload: fakeWalk('walk-2') });

    const remote = stubRemote({ saveWalk: jest.fn().mockResolvedValue(undefined) });
    await queue.flush(remote);

    expect(await queue.hasPendingSaveWalk('walk-2')).toBe(false);
    expect(await queue.getConflictForWalk('walk-2')).toBeUndefined();
  });

  it('reports a permanently-failed saveWalk as no longer pending, but as a real conflict', async () => {
    const queue = new SyncQueue();
    await queue.enqueue({ type: 'saveWalk', payload: fakeWalk('walk-3') });

    const err = Object.assign(new Error('duplicate'), { code: '23505' });
    const remote = stubRemote({ saveWalk: jest.fn().mockRejectedValue(err) });
    await queue.flush(remote);

    expect(await queue.hasPendingSaveWalk('walk-3')).toBe(false);
    const conflict = await queue.getConflictForWalk('walk-3');
    expect(conflict).toBeTruthy();
    expect(conflict!.code).toBe('23505');
  });

  it('does not confuse a pending write for a different walk id', async () => {
    const queue = new SyncQueue();
    await queue.enqueue({ type: 'saveWalk', payload: fakeWalk('walk-4') });
    const remote = stubRemote({ saveWalk: jest.fn().mockRejectedValue(new Error('timeout')) });
    await queue.flush(remote);

    expect(await queue.hasPendingSaveWalk('walk-4')).toBe(true);
    expect(await queue.hasPendingSaveWalk('some-other-walk')).toBe(false);
  });
});

/**
 * Bug 3 regression: a walk id's PERMANENT conflict from an earlier attempt
 * must never keep being reported once a LATER saveWalk for that exact same
 * walk id has actually succeeded — see syncQueue.ts's flush()/
 * clearConflictForWalk() doc comments for the full "markDone wrongly
 * reverts a successful completion" scenario this fixes.
 */
describe('SyncQueue — a later successful saveWalk clears a stale historical conflict (bug 3 fix)', () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
    setSyncQueueActorGetter(() => 'test-user');
  });

  afterEach(() => {
    setSyncQueueActorGetter(() => null);
  });

  it('walk X permanently conflicts, then a later saveWalk for walk X succeeds — getConflictForWalk now reports no conflict', async () => {
    const queue = new SyncQueue();

    // (1) Attempt 1 for walk X permanently fails — conflict recorded.
    await queue.enqueue({ type: 'saveWalk', payload: fakeWalk('walk-x') });
    const permanentErr = Object.assign(new Error('duplicate key'), { code: '23505' });
    await queue.flush(stubRemote({ saveWalk: jest.fn().mockRejectedValue(permanentErr) }));

    expect(await queue.getConflictForWalk('walk-x')).toBeTruthy();

    // (2) A later saveWalk for the SAME walk id succeeds.
    await queue.enqueue({ type: 'saveWalk', payload: fakeWalk('walk-x', { status: 'done' }) });
    await queue.flush(stubRemote({ saveWalk: jest.fn().mockResolvedValue(undefined) }));

    // (3) The conflict-resolution query for walk X now reports success/no-conflict.
    expect(await queue.hasPendingSaveWalk('walk-x')).toBe(false);
    expect(await queue.getConflictForWalk('walk-x')).toBeUndefined();
  });

  it('does not clear a conflict recorded for a DIFFERENT walk id', async () => {
    const queue = new SyncQueue();
    const permanentErr = Object.assign(new Error('duplicate key'), { code: '23505' });

    await queue.enqueue({ type: 'saveWalk', payload: fakeWalk('walk-y') });
    await queue.flush(stubRemote({ saveWalk: jest.fn().mockRejectedValue(permanentErr) }));
    expect(await queue.getConflictForWalk('walk-y')).toBeTruthy();

    // A different walk (walk-z) later succeeds — walk-y's conflict must survive.
    await queue.enqueue({ type: 'saveWalk', payload: fakeWalk('walk-z') });
    await queue.flush(stubRemote({ saveWalk: jest.fn().mockResolvedValue(undefined) }));

    expect(await queue.getConflictForWalk('walk-y')).toBeTruthy();
    expect(await queue.getConflictForWalk('walk-z')).toBeUndefined();
  });
});

/**
 * Coverage-completion pass: flush()'s re-entrant guard and several of
 * apply()'s SyncOperation-to-Repository-method routes had no direct test —
 * OfflineFirstRepository's own tests stub the queue rather than exercising
 * SyncQueue.flush()/apply() itself for these op types, so most of the
 * switch in apply() had never actually run.
 */
describe('SyncQueue — flush() re-entrant guard and remaining apply() routes', () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
    setSyncQueueActorGetter(() => 'test-user');
  });

  afterEach(() => {
    setSyncQueueActorGetter(() => null);
  });

  it('returns the current remaining count without touching remote when a flush is already in progress', async () => {
    const queue = new SyncQueue();
    await queue.enqueue({ type: 'upsertUser', payload: fakeUser('a') });
    await queue.enqueue({ type: 'upsertUser', payload: fakeUser('b') });
    (queue as unknown as { flushing: boolean }).flushing = true;

    const upsertUser = jest.fn().mockResolvedValue(undefined);
    const result = await queue.flush(stubRemote({ upsertUser }));

    expect(result).toEqual({ succeeded: 0, remaining: 2, conflicted: 0, quarantined: 0 });
    expect(upsertUser).not.toHaveBeenCalled();
  });

  it('routes deleteUser, upsertDog, upsertScheduleRule, deleteScheduleRule, addScheduleEntries, deleteScheduleEntry, and updateUserReminderSetting to their matching remote methods', async () => {
    const queue = new SyncQueue();
    await queue.enqueue({ type: 'deleteUser', payload: { userId: 'user-del' } });
    await queue.enqueue({
      type: 'upsertDog',
      payload: { id: 'dog-new', familyId: 'family-main', name: 'Rex', walksPerDay: 2 },
    });
    await queue.enqueue({
      type: 'upsertScheduleRule',
      payload: {
        id: 'rule-new',
        familyId: 'family-main',
        dogId: 'dog-1',
        time: '08:00',
        daysOfWeek: [0, 1, 2, 3, 4, 5, 6],
        rotationUserIds: ['user-a'],
        rotationAnchorDate: '2026-08-30',
        sortOrder: 0,
        active: true,
        createdAt: new Date().toISOString(),
      },
    });
    await queue.enqueue({ type: 'deleteScheduleRule', payload: { ruleId: 'rule-del' } });
    await queue.enqueue({
      type: 'addScheduleEntries',
      payload: [
        {
          id: 'entry-new',
          familyId: 'family-main',
          dogId: 'dog-1',
          date: '2026-09-01',
          time: '08:00',
          responsibleUserId: 'user-a',
          createdAt: new Date().toISOString(),
        },
      ],
    });
    await queue.enqueue({ type: 'deleteScheduleEntry', payload: { entryId: 'entry-del' } });
    await queue.enqueue({ type: 'updateUserReminderSetting', payload: { userId: 'user-rem', enabled: false } });

    const deleteUser = jest.fn().mockResolvedValue(undefined);
    const upsertDog = jest.fn().mockResolvedValue(undefined);
    const upsertScheduleRule = jest.fn().mockResolvedValue(undefined);
    const deleteScheduleRule = jest.fn().mockResolvedValue(undefined);
    const addScheduleEntries = jest.fn().mockResolvedValue(undefined);
    const deleteScheduleEntry = jest.fn().mockResolvedValue(undefined);
    const updateUserReminderSetting = jest.fn().mockResolvedValue(undefined);
    const remote = stubRemote({
      deleteUser,
      upsertDog,
      upsertScheduleRule,
      deleteScheduleRule,
      addScheduleEntries,
      deleteScheduleEntry,
      updateUserReminderSetting,
    });

    const result = await queue.flush(remote);

    expect(deleteUser).toHaveBeenCalledWith('user-del');
    expect(upsertDog).toHaveBeenCalledWith(expect.objectContaining({ id: 'dog-new' }));
    expect(upsertScheduleRule).toHaveBeenCalledWith(expect.objectContaining({ id: 'rule-new' }));
    expect(deleteScheduleRule).toHaveBeenCalledWith('rule-del');
    expect(addScheduleEntries).toHaveBeenCalledWith([expect.objectContaining({ id: 'entry-new' })]);
    expect(deleteScheduleEntry).toHaveBeenCalledWith('entry-del');
    expect(updateUserReminderSetting).toHaveBeenCalledWith('user-rem', false);
    expect(result).toEqual({ succeeded: 7, remaining: 0, conflicted: 0, quarantined: 0 });
  });

  it("routes a freshly-enqueued deleteFamilyMember op to remote.deleteFamilyMember (apply()'s own dispatch, distinct from load()'s legacy-discard path, which only ever runs on the FIRST load — see discardLegacyDeleteFamilyMember's doc comment)", async () => {
    const queue = new SyncQueue();
    const payload = { userId: 'user-x', updatedRules: [], updatedEntries: [], updatedWalks: [] };
    await queue.enqueue({ type: 'deleteFamilyMember', payload });

    const deleteFamilyMember = jest.fn().mockResolvedValue(undefined);
    const result = await queue.flush(stubRemote({ deleteFamilyMember }));

    expect(deleteFamilyMember).toHaveBeenCalledWith(payload);
    expect(result).toEqual({ succeeded: 1, remaining: 0, conflicted: 0, quarantined: 0 });
  });

  it('routes deleteWalk to remote.deleteWalk when present', async () => {
    const queue = new SyncQueue();
    await queue.enqueue({ type: 'deleteWalk', payload: { walkId: 'walk-del' } });

    const deleteWalk = jest.fn().mockResolvedValue(undefined);
    const result = await queue.flush(stubRemote({ deleteWalk }));

    expect(deleteWalk).toHaveBeenCalledWith('walk-del');
    expect(result).toEqual({ succeeded: 1, remaining: 0, conflicted: 0, quarantined: 0 });
  });

  it('treats a queued deleteWalk as a harmless no-op success when remote has no deleteWalk method (optional chaining)', async () => {
    const queue = new SyncQueue();
    await queue.enqueue({ type: 'deleteWalk', payload: { walkId: 'walk-del' } });

    const result = await queue.flush(stubRemote()); // base stub never sets deleteWalk

    expect(result).toEqual({ succeeded: 1, remaining: 0, conflicted: 0, quarantined: 0 });
  });

  it('hasClaimedActor reflects whether the wired actor-getter currently returns a profile id', () => {
    const queue = new SyncQueue();

    setSyncQueueActorGetter(() => null);
    expect(queue.hasClaimedActor()).toBe(false);

    setSyncQueueActorGetter(() => 'user-a');
    expect(queue.hasClaimedActor()).toBe(true);
  });
});

/**
 * Coverage-completion pass, part 2: isPermanentError's class-28 branch, a
 * non-Error thrown value, and reloading an already-persisted conflict/
 * quarantine list from a prior session — none of these branches were hit by
 * any existing test.
 */
describe('SyncQueue — isPermanentError class 28, non-Error thrown values, and reloading persisted conflicts/quarantine', () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
    setSyncQueueActorGetter(() => 'test-user');
  });

  afterEach(() => {
    setSyncQueueActorGetter(() => null);
  });

  it('treats a class-28 (invalid_authorization_specification) Postgres code as a permanent conflict, not a retryable failure', async () => {
    const queue = new SyncQueue();
    await queue.enqueue({ type: 'upsertUser', payload: fakeUser('a') });

    const authError = Object.assign(new Error('invalid authorization specification'), { code: '28000' });
    const result = await queue.flush(stubRemote({ upsertUser: jest.fn().mockRejectedValue(authError) }));

    expect(result).toEqual({ succeeded: 0, remaining: 0, conflicted: 1, quarantined: 0 });
    const conflicts = await queue.getConflicts();
    expect(conflicts[0].code).toBe('28000');
  });

  it('records a conflict message via String(error) when the thrown value is not an Error instance', async () => {
    const queue = new SyncQueue();
    await queue.enqueue({ type: 'upsertUser', payload: fakeUser('a') });

    const result = await queue.flush(stubRemote({ upsertUser: jest.fn().mockRejectedValue({ code: '23505' }) }));

    expect(result).toEqual({ succeeded: 0, remaining: 0, conflicted: 1, quarantined: 0 });
    const conflicts = await queue.getConflicts();
    expect(conflicts[0].message).toBe(String({ code: '23505' }));
  });

  it('getConflicts() parses an already-persisted conflict list from a prior session', async () => {
    const persisted = [
      { op: { type: 'upsertUser', payload: fakeUser('a') }, code: '23505', message: 'stale', failedAt: new Date().toISOString() },
    ];
    await AsyncStorage.setItem('dog-walk-family:sync-conflicts:v1', JSON.stringify(persisted));

    const queue = new SyncQueue();
    expect(await queue.getConflicts()).toEqual(persisted);
  });

  it('getQuarantined() parses an already-persisted quarantine list from a prior session', async () => {
    const persisted = [
      { op: { type: 'upsertUser', payload: fakeUser('a') }, quarantinedAt: new Date().toISOString(), reason: 'stale' },
    ];
    await AsyncStorage.setItem('dog-walk-family:sync-quarantine:v1', JSON.stringify(persisted));

    const queue = new SyncQueue();
    expect(await queue.getQuarantined()).toEqual(persisted);
  });
});
