import { DEMO_FAMILY } from '../../data/demoData';

/**
 * Regression tests for BUG 3 (round-2 bug report): the dog's name ("טופי")
 * must load into familyStore alongside the family/users in local/demo mode,
 * so every screen that reads `dog` from the store (Home, Schedule, Settings)
 * has it available. Each test resets the module registry so the singleton
 * repository's in-memory cache and the mocked AsyncStorage both start clean.
 */
describe('familyStore — dog loading (local/demo mode)', () => {
  beforeEach(() => {
    jest.resetModules();
  });

  it('load(familyId) populates family, users, AND dog together', async () => {
    const AsyncStorage = require('@react-native-async-storage/async-storage');
    await AsyncStorage.clear();
    const { useFamilyStore } = require('../familyStore');

    await useFamilyStore.getState().load(DEMO_FAMILY.id);

    const state = useFamilyStore.getState();
    expect(state.error).toBeNull();
    expect(state.family?.id).toBe(DEMO_FAMILY.id);
    expect(state.users.length).toBeGreaterThan(0);
    expect(state.dog).not.toBeNull();
    expect(state.dog?.name).toBe('טופי');
    expect(state.dog?.familyId).toBe(DEMO_FAMILY.id);
  });

  it('saveDog updates the store immediately so every screen reading `dog` sees the new name/photo', async () => {
    const AsyncStorage = require('@react-native-async-storage/async-storage');
    await AsyncStorage.clear();
    const { useFamilyStore } = require('../familyStore');

    await useFamilyStore.getState().load(DEMO_FAMILY.id);
    const dog = useFamilyStore.getState().dog!;
    expect(dog).toBeTruthy();

    await useFamilyStore.getState().saveDog({ ...dog, name: 'טופי החדש', photoUrl: 'file://new-photo.jpg' });

    const updated = useFamilyStore.getState().dog;
    expect(updated?.name).toBe('טופי החדש');
    expect(updated?.photoUrl).toBe('file://new-photo.jpg');
  });

  it('BUG 2: falls back to the demo dog in local mode even if the repository returns none for the demo family, instead of leaving dog null forever', async () => {
    const AsyncStorage = require('@react-native-async-storage/async-storage');
    await AsyncStorage.clear();
    const { useFamilyStore } = require('../familyStore');
    const { repository } = require('../../data');

    // Simulate exactly the failure mode this bug report described: the
    // repository call for the dog comes back empty (a stale/mismatched
    // cache, or a backend not yet seeded) even though family/users load
    // fine — the dog must never be silently missing in local/demo mode.
    const spy = jest.spyOn(repository, 'getDog').mockResolvedValueOnce(undefined);

    await useFamilyStore.getState().load(DEMO_FAMILY.id);

    const state = useFamilyStore.getState();
    expect(state.error).toBeNull();
    expect(state.dog).not.toBeNull();
    expect(state.dog?.name).toBe('טופי');
    expect(state.dog?.familyId).toBe(DEMO_FAMILY.id);

    spy.mockRestore();
  });

  it('BUG 2: a cached dog with a mismatched familyId is treated as corrupt and re-seeded, not silently returned as undefined', async () => {
    const AsyncStorage = require('@react-native-async-storage/async-storage');
    await AsyncStorage.clear();
    const { LocalRepository } = require('../../data/localRepository');
    const { DEMO_FAMILY: FAMILY, DEMO_USERS, DEMO_RULES, DEMO_ENTRIES, DEMO_WALKS } = require('../../data/demoData');

    // Write a cache that "looks" valid (every field present, every array an
    // array) but whose dog belongs to a different family — the kind of
    // stale leftover an earlier build could have persisted.
    await AsyncStorage.setItem(
      'dog-walk-family:v2',
      JSON.stringify({
        family: FAMILY,
        users: DEMO_USERS,
        dog: { id: 'dog-old', familyId: 'some-other-family', name: 'רקס', walksPerDay: 2 },
        rules: DEMO_RULES,
        entries: DEMO_ENTRIES,
        walks: DEMO_WALKS,
      })
    );

    const repo = new LocalRepository();
    const dog = await repo.getDog(FAMILY.id);
    expect(dog).toBeDefined();
    expect(dog?.name).toBe('טופי'); // re-seeded, not the stale "רקס"
    expect(dog?.familyId).toBe(FAMILY.id);
  });
});

/**
 * deleteUser must route through repository.deleteFamilyMember() — the
 * admin-only, atomic operation — rather than calling repository.deleteUser()
 * directly. Direct deleteUser() is what a plain DELETE on `users` maps to in
 * Supabase mode, and that's now blocked by RLS (migrations/0003_*.sql), so
 * calling it here would silently fail in backend mode. This also confirms
 * the rotation reassignment (planUserRemoval) is computed client-side and
 * handed to the repository as one payload, not applied via a loop of
 * separate repository calls plus a trailing delete.
 *
 * Deletion is a SOFT delete (sets `removedAt`), never an actual row removal
 * — see FamilyUser.removedAt's doc comment and
 * migrations/0004_admin_permissions_and_member_deletion.sql. That's a hard
 * requirement, not a style choice: schedule_entries.responsible_user_id and
 * walks.responsible_user_id are `on delete restrict` in Supabase, so an
 * actual DELETE would fail outright (foreign_key_violation) for any member
 * with real history — a past schedule_entry or even a single completed
 * walk. planUserRemoval() deliberately never touches that history (it only
 * reassigns future pending rules/entries/walks), so the deleted user's id
 * necessarily still remains referenced by it after deletion — which is
 * exactly why the row itself must survive.
 */
describe('familyStore — deleteUser (soft delete, preserving history)', () => {
  beforeEach(() => {
    jest.resetModules();
  });

  it('routes deletion through repository.deleteFamilyMember with the computed rotation reassignment, never calling repository.deleteUser', async () => {
    const AsyncStorage = require('@react-native-async-storage/async-storage');
    await AsyncStorage.clear();
    const { useFamilyStore } = require('../familyStore');
    const { useScheduleStore } = require('../scheduleStore');
    const { DEMO_FAMILY } = require('../../data/demoData');
    const { repository } = require('../../data');

    await useFamilyStore.getState().load(DEMO_FAMILY.id);
    await useScheduleStore.getState().load(DEMO_FAMILY.id);

    const users = useFamilyStore.getState().users;
    expect(users.length).toBeGreaterThan(1);
    const [victim, replacement] = users;

    const deleteFamilyMemberSpy = jest.spyOn(repository, 'deleteFamilyMember');
    const deleteUserSpy = jest.spyOn(repository, 'deleteUser');

    await useFamilyStore.getState().deleteUser(victim.id, replacement.id);

    expect(deleteFamilyMemberSpy).toHaveBeenCalledTimes(1);
    const deleteArgs = deleteFamilyMemberSpy.mock.calls[0][0] as { userId: string };
    expect(deleteArgs.userId).toBe(victim.id);
    expect(deleteUserSpy).not.toHaveBeenCalled();
    expect(useFamilyStore.getState().actionError).toBeNull();

    deleteFamilyMemberSpy.mockRestore();
    deleteUserSpy.mockRestore();
  });

  it('scenario: brand-new member with no activity at all — soft-deletes cleanly, no rules/entries/walks to touch', async () => {
    const AsyncStorage = require('@react-native-async-storage/async-storage');
    await AsyncStorage.clear();
    const { useFamilyStore } = require('../familyStore');
    const { useScheduleStore } = require('../scheduleStore');
    const { DEMO_FAMILY } = require('../../data/demoData');

    await useFamilyStore.getState().load(DEMO_FAMILY.id);
    await useScheduleStore.getState().load(DEMO_FAMILY.id);

    const brandNew = await useFamilyStore.getState().addUser({ name: 'אורח', avatar: '🧑', color: '#123456' });
    expect(brandNew.id).toBeTruthy();

    // No rotation includes them, so no replacement is even required.
    await useFamilyStore.getState().deleteUser(brandNew.id, null);

    const record = useFamilyStore.getState().users.find((u: any) => u.id === brandNew.id);
    expect(record).toBeDefined(); // row survives — never actually removed
    expect(record.removedAt).toBeTruthy();
    expect(useFamilyStore.getState().actionError).toBeNull();
  });

  it('scenario: member with future assignments — future rotation/entries/pending walks are reassigned, member is soft-deleted', async () => {
    const AsyncStorage = require('@react-native-async-storage/async-storage');
    await AsyncStorage.clear();
    const { useFamilyStore } = require('../familyStore');
    const { useScheduleStore } = require('../scheduleStore');
    const { DEMO_FAMILY } = require('../../data/demoData');

    await useFamilyStore.getState().load(DEMO_FAMILY.id);
    await useScheduleStore.getState().load(DEMO_FAMILY.id);

    const users = useFamilyStore.getState().users;
    const [victim, replacement] = users;
    const rulesWithVictimBefore = useScheduleStore.getState().rules.filter((r: any) => r.rotationUserIds.includes(victim.id));
    expect(rulesWithVictimBefore.length).toBeGreaterThan(0); // demo data seeds them into every rule's rotation

    await useFamilyStore.getState().deleteUser(victim.id, replacement.id);

    const rulesWithVictimAfter = useScheduleStore.getState().rules.filter((r: any) => r.rotationUserIds.includes(victim.id));
    expect(rulesWithVictimAfter).toHaveLength(0); // no longer in any active rotation

    const pendingWalksStillAssigned = useScheduleStore
      .getState()
      .walks.filter((w: any) => w.responsibleUserId === victim.id && w.status === 'pending');
    expect(pendingWalksStillAssigned).toHaveLength(0); // reassigned, not left dangling

    const record = useFamilyStore.getState().users.find((u: any) => u.id === victim.id);
    expect(record.removedAt).toBeTruthy();
  });

  it('scenario: member with historical completed walks — history keeps pointing at them, row is soft-deleted not removed', async () => {
    const AsyncStorage = require('@react-native-async-storage/async-storage');
    await AsyncStorage.clear();
    const { useFamilyStore } = require('../familyStore');
    const { useScheduleStore } = require('../scheduleStore');
    const { DEMO_FAMILY } = require('../../data/demoData');

    await useFamilyStore.getState().load(DEMO_FAMILY.id);
    await useScheduleStore.getState().load(DEMO_FAMILY.id);

    const users = useFamilyStore.getState().users;
    const [victim, replacement] = users;
    const doneWalksBefore = useScheduleStore
      .getState()
      .walks.filter((w: any) => w.responsibleUserId === victim.id && w.status === 'done');
    expect(doneWalksBefore.length).toBeGreaterThan(0); // demo data seeds at least one completed walk for the first user

    await useFamilyStore.getState().deleteUser(victim.id, replacement.id);

    const doneWalksAfter = useScheduleStore
      .getState()
      .walks.filter((w: any) => doneWalksBefore.some((b: any) => b.id === w.id));
    // Same records, same responsible user — completed history is untouched,
    // and never rewritten just to make deletion "work".
    expect(doneWalksAfter).toHaveLength(doneWalksBefore.length);
    doneWalksAfter.forEach((w: any) => expect(w.responsibleUserId).toBe(victim.id));

    // The row must still exist for History to resolve the name/avatar —
    // this is exactly the FK-safety requirement: had this been an actual
    // DELETE, it would have failed here in Supabase mode
    // (foreign_key_violation from walks.responsible_user_id).
    const record = useFamilyStore.getState().users.find((u: any) => u.id === victim.id);
    expect(record).toBeDefined();
    expect(record.name).toBe(victim.name);
    expect(record.removedAt).toBeTruthy();
  });

  it('scenario: member with a PAST schedule_entry (not just completed walks) — left completely untouched, deletion still succeeds', async () => {
    const AsyncStorage = require('@react-native-async-storage/async-storage');
    await AsyncStorage.clear();
    const { useFamilyStore } = require('../familyStore');
    const { useScheduleStore } = require('../scheduleStore');
    const { DEMO_FAMILY } = require('../../data/demoData');
    const { repository } = require('../../data');

    await useFamilyStore.getState().load(DEMO_FAMILY.id);
    await useScheduleStore.getState().load(DEMO_FAMILY.id);

    const users = useFamilyStore.getState().users;
    const [victim, replacement] = users;

    // Demo data only seeds today-dated entries — graft on a genuinely past
    // one, exactly the shape planUserRemoval() is documented to skip
    // (`entry.date < today`), and reload so the store picks it up.
    const pastEntry = {
      id: 'entry-past-test',
      familyId: DEMO_FAMILY.id,
      dogId: useFamilyStore.getState().dog.id,
      date: '2020-01-01',
      time: '07:00',
      responsibleUserId: victim.id,
      createdAt: new Date().toISOString(),
    };
    await repository.addScheduleEntries([pastEntry]);
    await useScheduleStore.getState().load(DEMO_FAMILY.id);
    expect(useScheduleStore.getState().entries.find((e: any) => e.id === 'entry-past-test')).toBeDefined();

    await useFamilyStore.getState().deleteUser(victim.id, replacement.id);

    const pastEntryAfter = useScheduleStore.getState().entries.find((e: any) => e.id === 'entry-past-test');
    expect(pastEntryAfter).toBeDefined(); // never deleted
    expect(pastEntryAfter.responsibleUserId).toBe(victim.id); // never rewritten
    expect(useFamilyStore.getState().actionError).toBeNull(); // deletion still succeeded overall
  });

  /**
   * Round 7, Part 1E / 3 / 5 (requirement 6): admin_delete_family_member()'s
   * last-admin-removal guard (0007) must map to the same friendly Hebrew
   * message every other server-side rejection now goes through
   * (friendlyErrorMessage(), lib/errorMessages.ts) — not the old hardcoded
   * generic fallback, which would have made a genuine last-admin protection
   * rejection indistinguishable from any other failure.
   */
  it('a server-side rejection from repository.deleteFamilyMember (e.g. last-admin protection) maps to the friendly Hebrew message, not a generic fallback', async () => {
    const AsyncStorage = require('@react-native-async-storage/async-storage');
    await AsyncStorage.clear();
    const { useFamilyStore } = require('../familyStore');
    const { DEMO_FAMILY } = require('../../data/demoData');
    const { repository } = require('../../data');

    await useFamilyStore.getState().load(DEMO_FAMILY.id);
    const [victim] = useFamilyStore.getState().users;

    const spy = jest
      .spyOn(repository, 'deleteFamilyMember')
      .mockRejectedValueOnce(new Error('cannot remove the last admin of this family'));

    await useFamilyStore.getState().deleteUser(victim.id, null);

    expect(useFamilyStore.getState().actionError).toBe(
      'לא ניתן להסיר את המנהל/ת האחרון/ה מהמשפחה — חייב להישאר מנהל אחד לפחות.'
    );
    // And the row must NOT have been marked removed client-side — the
    // rejection happened before any local state update (deleteUser's catch
    // block runs before the success path's `set({ users: ... removedAt })`).
    expect(useFamilyStore.getState().users.find((u: any) => u.id === victim.id)?.removedAt).toBeFalsy();

    spy.mockRestore();
  });
});
