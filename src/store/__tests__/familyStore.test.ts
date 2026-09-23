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
    const spy = jest.spyOn(repository, 'getDogs').mockResolvedValueOnce([]);

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
      'dog-walk-family:v3',
      JSON.stringify({
        family: FAMILY,
        users: DEMO_USERS,
        dogs: [{ id: 'dog-old', familyId: 'some-other-family', name: 'רקס', walksPerDay: 2 }],
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

  it('load(familyId) surfaces a repository failure as `error` instead of throwing, and leaves loading false', async () => {
    const AsyncStorage = require('@react-native-async-storage/async-storage');
    await AsyncStorage.clear();
    const { useFamilyStore } = require('../familyStore');
    const { repository } = require('../../data');

    const spy = jest.spyOn(repository, 'getFamily').mockRejectedValueOnce(new Error('boom'));

    await useFamilyStore.getState().load(DEMO_FAMILY.id);

    const state = useFamilyStore.getState();
    expect(state.loading).toBe(false);
    expect(state.error).toBe('boom');

    spy.mockRestore();
  });
});

describe('familyStore — setReminderEnabled', () => {
  beforeEach(() => {
    jest.resetModules();
  });

  it('optimistically flips remindersEnabled and persists it via the repository', async () => {
    const AsyncStorage = require('@react-native-async-storage/async-storage');
    await AsyncStorage.clear();
    const { useFamilyStore } = require('../familyStore');
    const { repository } = require('../../data');

    await useFamilyStore.getState().load(DEMO_FAMILY.id);
    const [user] = useFamilyStore.getState().users;
    const spy = jest.spyOn(repository, 'updateUserReminderSetting');

    await useFamilyStore.getState().setReminderEnabled(user.id, false);

    expect(spy).toHaveBeenCalledWith(user.id, false);
    expect(useFamilyStore.getState().users.find((u: any) => u.id === user.id)?.remindersEnabled).toBe(false);

    spy.mockRestore();
  });

  it('rolls back the optimistic update and sets a friendly error when the repository call fails', async () => {
    const AsyncStorage = require('@react-native-async-storage/async-storage');
    await AsyncStorage.clear();
    const { useFamilyStore } = require('../familyStore');
    const { repository } = require('../../data');

    await useFamilyStore.getState().load(DEMO_FAMILY.id);
    const usersBefore = useFamilyStore.getState().users;
    const [user] = usersBefore;
    const spy = jest.spyOn(repository, 'updateUserReminderSetting').mockRejectedValueOnce(new Error('boom'));

    await useFamilyStore.getState().setReminderEnabled(user.id, false);

    expect(useFamilyStore.getState().users).toEqual(usersBefore);
    expect(useFamilyStore.getState().error).toBe('לא הצלחנו לעדכן את הגדרות התזכורות');

    spy.mockRestore();
  });

  it('a rejection reverts only the affected member — a concurrent realtime update to an UNRELATED member landing during the RPC is preserved, not clobbered by a stale pre-await snapshot', async () => {
    const AsyncStorage = require('@react-native-async-storage/async-storage');
    await AsyncStorage.clear();
    const { useFamilyStore } = require('../familyStore');
    const { repository } = require('../../data');

    await useFamilyStore.getState().load(DEMO_FAMILY.id);
    const users = useFamilyStore.getState().users;
    expect(users.length).toBeGreaterThan(1);
    const [target, other] = users;

    const spy = jest.spyOn(repository, 'updateUserReminderSetting').mockImplementationOnce(async () => {
      // Models a realtime reload from another family member's unrelated
      // concurrent edit landing on this device while this RPC is in flight
      // (see lib/realtime.ts's subscribeToFamilyChanges, wired to
      // useFamilyStore.load() in RootNavigator.tsx).
      useFamilyStore.setState((s: any) => ({
        users: s.users.map((u: any) => (u.id === other.id ? { ...u, name: 'שם עודכן במקביל' } : u)),
      }));
      throw new Error('boom');
    });

    await useFamilyStore.getState().setReminderEnabled(target.id, false);

    expect(useFamilyStore.getState().users.find((u: any) => u.id === target.id)?.remindersEnabled).toBe(
      target.remindersEnabled
    );
    expect(useFamilyStore.getState().users.find((u: any) => u.id === other.id)?.name).toBe('שם עודכן במקביל');

    spy.mockRestore();
  });
});

describe('familyStore — updateUser', () => {
  beforeEach(() => {
    jest.resetModules();
  });

  it('optimistically applies the update and persists it via the repository', async () => {
    const AsyncStorage = require('@react-native-async-storage/async-storage');
    await AsyncStorage.clear();
    const { useFamilyStore } = require('../familyStore');
    const { repository } = require('../../data');

    await useFamilyStore.getState().load(DEMO_FAMILY.id);
    const [user] = useFamilyStore.getState().users;
    const spy = jest.spyOn(repository, 'upsertUser');
    const updated = { ...user, name: 'שם חדש' };

    await useFamilyStore.getState().updateUser(updated);

    expect(spy).toHaveBeenCalledWith(updated);
    expect(useFamilyStore.getState().users.find((u: any) => u.id === user.id)?.name).toBe('שם חדש');

    spy.mockRestore();
  });

  it('rolls back to the previous users list and sets a friendly actionError when the repository call fails', async () => {
    const AsyncStorage = require('@react-native-async-storage/async-storage');
    await AsyncStorage.clear();
    const { useFamilyStore } = require('../familyStore');
    const { repository } = require('../../data');

    await useFamilyStore.getState().load(DEMO_FAMILY.id);
    const usersBefore = useFamilyStore.getState().users;
    const [user] = usersBefore;
    const spy = jest.spyOn(repository, 'upsertUser').mockRejectedValueOnce(new Error('boom'));

    await useFamilyStore.getState().updateUser({ ...user, name: 'שם חדש' });

    expect(useFamilyStore.getState().users).toEqual(usersBefore);
    expect(useFamilyStore.getState().actionError).toBe('לא הצלחנו לעדכן את בן המשפחה');

    spy.mockRestore();
  });

  it('a rejection reverts only the edited member — a concurrent realtime update to an UNRELATED member landing during the RPC is preserved, not clobbered by a stale pre-await snapshot', async () => {
    const AsyncStorage = require('@react-native-async-storage/async-storage');
    await AsyncStorage.clear();
    const { useFamilyStore } = require('../familyStore');
    const { repository } = require('../../data');

    await useFamilyStore.getState().load(DEMO_FAMILY.id);
    const users = useFamilyStore.getState().users;
    expect(users.length).toBeGreaterThan(1);
    const [target, other] = users;

    const spy = jest.spyOn(repository, 'upsertUser').mockImplementationOnce(async () => {
      // Models a realtime reload from another family member's unrelated
      // concurrent edit landing on this device while this RPC is in flight.
      useFamilyStore.setState((s: any) => ({
        users: s.users.map((u: any) => (u.id === other.id ? { ...u, name: 'שם עודכן במקביל' } : u)),
      }));
      throw new Error('boom');
    });

    await useFamilyStore.getState().updateUser({ ...target, name: 'שם חדש' });

    expect(useFamilyStore.getState().users.find((u: any) => u.id === target.id)?.name).toBe(target.name);
    expect(useFamilyStore.getState().users.find((u: any) => u.id === other.id)?.name).toBe('שם עודכן במקביל');

    spy.mockRestore();
  });
});

describe('familyStore — addUser repository failure', () => {
  beforeEach(() => {
    jest.resetModules();
  });

  it('rolls back the optimistically-added user and sets actionError, then rethrows for the caller', async () => {
    const AsyncStorage = require('@react-native-async-storage/async-storage');
    await AsyncStorage.clear();
    const { useFamilyStore } = require('../familyStore');
    const { repository } = require('../../data');

    await useFamilyStore.getState().load(DEMO_FAMILY.id);
    const usersBefore = useFamilyStore.getState().users;
    const spy = jest.spyOn(repository, 'createUser').mockRejectedValueOnce(new Error('boom'));

    await expect(
      useFamilyStore.getState().addUser({ name: 'חדש', avatar: '🐶', color: '#000' })
    ).rejects.toThrow('boom');

    expect(useFamilyStore.getState().users).toEqual(usersBefore);
    expect(useFamilyStore.getState().actionError).toBe('לא הצלחנו להוסיף את בן המשפחה');

    spy.mockRestore();
  });
});

describe('familyStore — getUserDeletionImpact / clearActionError', () => {
  beforeEach(() => {
    jest.resetModules();
  });

  it('getUserDeletionImpact delegates to computeUserDeletionImpact with the current schedule state', async () => {
    const AsyncStorage = require('@react-native-async-storage/async-storage');
    await AsyncStorage.clear();
    const { useFamilyStore } = require('../familyStore');
    const { useScheduleStore } = require('../scheduleStore');

    await useFamilyStore.getState().load(DEMO_FAMILY.id);
    await useScheduleStore.getState().load(DEMO_FAMILY.id);
    const [victim] = useFamilyStore.getState().users;

    const impact = useFamilyStore.getState().getUserDeletionImpact(victim.id);

    expect(impact).toBeDefined();
    expect(typeof impact.futureScheduleEntryCount).toBe('number');
    expect(Array.isArray(impact.rulesAffected)).toBe(true);
    expect(typeof impact.directlyAssignedWalkCount).toBe('number');
  });

  it('clearActionError resets actionError back to null', async () => {
    const AsyncStorage = require('@react-native-async-storage/async-storage');
    await AsyncStorage.clear();
    const { useFamilyStore } = require('../familyStore');

    useFamilyStore.setState({ actionError: 'משהו השתבש' });
    expect(useFamilyStore.getState().actionError).toBe('משהו השתבש');

    useFamilyStore.getState().clearActionError();

    expect(useFamilyStore.getState().actionError).toBeNull();
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

  /**
   * A CLIENT-side rejection, unlike the server-side one above: planUserRemoval()
   * (src/logic/familyManagement.ts) throws FamilyManagementError itself,
   * before repository.deleteFamilyMember is ever called, when the target is
   * the sole member of a rotation and no replacement was given. Its message
   * must reach actionError verbatim (the `e instanceof FamilyManagementError
   * ? e.message : ...` branch), not the generic "לא הצלחנו למחוק" fallback
   * meant for opaque server-side failures.
   */
  it('a client-side rejection (sole rotation member, no replacement given) surfaces the FamilyManagementError message verbatim, not the generic fallback', async () => {
    const AsyncStorage = require('@react-native-async-storage/async-storage');
    await AsyncStorage.clear();
    const { useFamilyStore } = require('../familyStore');
    const { useScheduleStore } = require('../scheduleStore');
    const { DEMO_FAMILY } = require('../../data/demoData');
    const { toDateOnly } = require('../../logic/rotation');
    const { repository } = require('../../data');

    await useFamilyStore.getState().load(DEMO_FAMILY.id);
    await useScheduleStore.getState().load(DEMO_FAMILY.id);

    const solo = await useFamilyStore.getState().addUser({ name: 'יחיד', avatar: '🧍', color: '#654321' });
    const deleteFamilyMemberSpy = jest.spyOn(repository, 'deleteFamilyMember');

    await useScheduleStore.getState().addRule({
      id: 'rule-solo-rotation-test',
      familyId: DEMO_FAMILY.id,
      dogId: useFamilyStore.getState().dog.id,
      time: '09:00',
      label: 'טיול יחיד',
      daysOfWeek: [0, 1, 2, 3, 4, 5, 6],
      rotationUserIds: [solo.id],
      rotationAnchorDate: toDateOnly(new Date()),
      sortOrder: 99,
      active: true,
      createdAt: new Date().toISOString(),
    });

    await useFamilyStore.getState().deleteUser(solo.id, null);

    expect(useFamilyStore.getState().actionError).toBe(
      'אי אפשר למחוק — זה בן המשפחה היחיד בסבב הזה. בחר מי יחליף אותו.'
    );
    // Rejected client-side before any server call or local removedAt update.
    expect(deleteFamilyMemberSpy).not.toHaveBeenCalled();
    expect(useFamilyStore.getState().users.find((u: any) => u.id === solo.id)?.removedAt).toBeFalsy();

    deleteFamilyMemberSpy.mockRestore();
  });

  it('a concurrent realtime update to an UNRELATED member landing while repository.deleteFamilyMember is in flight is preserved, not clobbered by a stale pre-await snapshot', async () => {
    const AsyncStorage = require('@react-native-async-storage/async-storage');
    await AsyncStorage.clear();
    const { useFamilyStore } = require('../familyStore');
    const { useScheduleStore } = require('../scheduleStore');
    const { DEMO_FAMILY } = require('../../data/demoData');
    const { repository } = require('../../data');

    await useFamilyStore.getState().load(DEMO_FAMILY.id);
    await useScheduleStore.getState().load(DEMO_FAMILY.id);

    const users = useFamilyStore.getState().users;
    expect(users.length).toBeGreaterThan(2);
    const [victim, replacement, bystander] = users;

    const spy = jest.spyOn(repository, 'deleteFamilyMember').mockImplementationOnce(async () => {
      // Models a realtime reload from another family member's unrelated
      // concurrent edit (e.g. another admin's device editing `bystander`)
      // landing on THIS device while this admin-only RPC is still in
      // flight — see lib/realtime.ts's subscribeToFamilyChanges, wired to
      // useFamilyStore.load() in RootNavigator.tsx.
      useFamilyStore.setState((s: any) => ({
        users: s.users.map((u: any) => (u.id === bystander.id ? { ...u, name: 'שם עודכן במקביל' } : u)),
      }));
    });

    await useFamilyStore.getState().deleteUser(victim.id, replacement.id);

    // The deleted member is correctly soft-deleted...
    expect(useFamilyStore.getState().users.find((u: any) => u.id === victim.id)?.removedAt).toBeTruthy();
    // ...and the concurrent, unrelated update survives, not clobbered by a
    // stale whole-array snapshot captured before the RPC's await.
    expect(useFamilyStore.getState().users.find((u: any) => u.id === bystander.id)?.name).toBe('שם עודכן במקביל');

    spy.mockRestore();
  });
});

/**
 * load()'s "signed in as an already-removed profile" auto-recovery: if
 * another admin removed the member THIS device is currently signed in as
 * (see FamilyUser.removedAt), the next load() must sign this device out
 * rather than let a removed profile keep acting as if nothing happened —
 * see familyStore.ts's own doc comment on this exact block.
 */
describe('familyStore — load() auto-recovery when the signed-in profile was removed elsewhere', () => {
  beforeEach(() => {
    jest.resetModules();
  });

  it('signs the device out when the currently signed-in user is found removed in the freshly loaded users list', async () => {
    const AsyncStorage = require('@react-native-async-storage/async-storage');
    await AsyncStorage.clear();
    const { useFamilyStore } = require('../familyStore');
    const { useAuthStore } = require('../authStore');
    const { DEMO_FAMILY } = require('../../data/demoData');
    const { repository } = require('../../data');

    await useFamilyStore.getState().load(DEMO_FAMILY.id);
    const [victim] = useFamilyStore.getState().users;

    // This device is signed in as `victim`; another admin (a different
    // device) has already soft-deleted them server-side.
    useAuthStore.setState({ currentUserId: victim.id });
    await repository.upsertUser({ ...victim, removedAt: new Date().toISOString() });

    const signOutSpy = jest.spyOn(useAuthStore.getState(), 'signOut').mockResolvedValue(undefined);

    await useFamilyStore.getState().load(DEMO_FAMILY.id);

    expect(signOutSpy).toHaveBeenCalledTimes(1);

    signOutSpy.mockRestore();
  });

  it('does NOT sign out when the signed-in user is present and not removed', async () => {
    const AsyncStorage = require('@react-native-async-storage/async-storage');
    await AsyncStorage.clear();
    const { useFamilyStore } = require('../familyStore');
    const { useAuthStore } = require('../authStore');
    const { DEMO_FAMILY } = require('../../data/demoData');

    await useFamilyStore.getState().load(DEMO_FAMILY.id);
    const [victim] = useFamilyStore.getState().users;
    useAuthStore.setState({ currentUserId: victim.id });

    const signOutSpy = jest.spyOn(useAuthStore.getState(), 'signOut').mockResolvedValue(undefined);

    await useFamilyStore.getState().load(DEMO_FAMILY.id);

    expect(signOutSpy).not.toHaveBeenCalled();

    signOutSpy.mockRestore();
  });
});
