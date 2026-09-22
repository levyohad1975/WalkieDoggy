import AsyncStorage from '@react-native-async-storage/async-storage';
import { LocalRepository } from '../localRepository';
import { DEMO_DOG, DEMO_ENTRIES, DEMO_FAMILY, DEMO_RULES, DEMO_USERS, DEMO_WALKS } from '../demoData';
import type { Dog, Family, FamilyUser, ScheduleEntry, Walk } from '../../types';

const STORAGE_KEY = 'dog-walk-family:v3';

function otherFamilySeed() {
  const family: Family = { id: 'family-other', name: 'משפחת לוי', createdAt: new Date().toISOString() };
  const users: FamilyUser[] = [
    { id: 'user-other-1', familyId: family.id, name: 'אורי', avatar: '🧑', color: '#000', remindersEnabled: true, createdAt: new Date().toISOString() },
  ];
  const dog: Dog = { id: 'dog-other', familyId: family.id, name: 'ריקי', walksPerDay: 2 };
  return { family, users, dog };
}

describe('LocalRepository — family isolation', () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
  });

  it('prevents one family from seeing another family\'s users, dog, and walks', async () => {
    const repo = new LocalRepository();

    // Seed default demo family (המשפחה שלנו) by triggering the initial load.
    const demoUsers = await repo.getUsers('family-main');
    expect(demoUsers.every((u) => u.familyId === 'family-main')).toBe(true);

    // Now graft a second family's data onto the same on-disk store and make
    // sure queries scoped to family-main never leak family-other's rows.
    const { family: otherFamily, users: otherUsers, dog: otherDog } = otherFamilySeed();
    const otherEntry: ScheduleEntry = {
      id: 'entry-other',
      familyId: otherFamily.id,
      dogId: otherDog.id,
      date: '2026-08-26',
      time: '09:00',
      responsibleUserId: otherUsers[0].id,
      createdAt: new Date().toISOString(),
    };
    const otherWalk: Walk = {
      id: 'walk-other',
      familyId: otherFamily.id,
      scheduleEntryId: otherEntry.id,
      dogId: otherDog.id,
      date: '2026-08-26',
      scheduledTime: '09:00',
      responsibleUserId: otherUsers[0].id,
      status: 'pending',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    await repo.upsertDog(otherDog); // NOTE: single-dog demo repo keeps one dog; still must not appear under family-main's id
    await repo.addScheduleEntries([otherEntry]);
    await repo.saveWalk(otherWalk);

    const cohenUsers = await repo.getUsers('family-main');
    const cohenWalks = await repo.getWalks('family-main');
    const cohenEntries = await repo.getScheduleEntries('family-main');
    const cohenDog = await repo.getDog('family-main');

    expect(cohenUsers.some((u) => u.familyId === otherFamily.id)).toBe(false);
    expect(cohenWalks.some((w) => w.familyId === otherFamily.id)).toBe(false);
    expect(cohenEntries.some((e) => e.familyId === otherFamily.id)).toBe(false);
    expect(cohenDog?.familyId).not.toBe(otherFamily.id);

    const otherFamilyWalks = await repo.getWalks(otherFamily.id);
    expect(otherFamilyWalks).toEqual([otherWalk]);
  });
});

describe('LocalRepository — schedule + walk CRUD', () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
  });

  it('does not duplicate an entry already present at the same dog/date/time', async () => {
    const repo = new LocalRepository();
    await repo.getUsers('family-main'); // trigger seed
    const before = await repo.getScheduleEntries('family-main');

    const dup: ScheduleEntry = { ...before[0], id: 'a-new-id' };
    await repo.addScheduleEntries([dup]);

    const after = await repo.getScheduleEntries('family-main');
    expect(after).toHaveLength(before.length);
  });

  it('removes a schedule entry and its associated walk together', async () => {
    const repo = new LocalRepository();
    const entries = await repo.getScheduleEntries('family-main');
    const walks = await repo.getWalks('family-main');
    const target = entries[0];

    await repo.deleteScheduleEntry(target.id);

    const remainingEntries = await repo.getScheduleEntries('family-main');
    const remainingWalks = await repo.getWalks('family-main');
    expect(remainingEntries.find((e) => e.id === target.id)).toBeUndefined();
    expect(remainingWalks.find((w) => w.scheduleEntryId === target.id)).toBeUndefined();
    expect(remainingWalks.length).toBeLessThan(walks.length);
  });
});

describe('LocalRepository — dog data (BUG 3: dog name must load in local/demo mode)', () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
  });

  it('getDog(DEMO_FAMILY.id) returns Topi ("טופי") on a fresh/first-run local store', async () => {
    const repo = new LocalRepository();
    const dog = await repo.getDog(DEMO_FAMILY.id);
    expect(dog).toBeDefined();
    expect(dog?.name).toBe('טופי');
    expect(dog?.familyId).toBe(DEMO_FAMILY.id);
  });

  it('does not return a dog for a family id that does not match', async () => {
    const repo = new LocalRepository();
    await repo.getUsers(DEMO_FAMILY.id); // trigger seed
    const dog = await repo.getDog('some-other-family-id');
    expect(dog).toBeUndefined();
  });

  it('foundation: upsertDog supports a second, distinct dog for the same family without clobbering the first (arbitrary N)', async () => {
    const repo = new LocalRepository();
    await repo.getUsers(DEMO_FAMILY.id); // trigger seed (one dog already present: DEMO_DOG)
    const secondDog: Dog = { id: 'dog-second', familyId: DEMO_FAMILY.id, name: 'רעי', walksPerDay: 3 };

    await repo.upsertDog(secondDog);

    const dogs = await repo.getDogs(DEMO_FAMILY.id);
    expect(dogs).toHaveLength(2);
    expect(dogs.find((d) => d.id === DEMO_DOG.id)).toBeDefined();
    expect(dogs.find((d) => d.id === secondDog.id)).toEqual(secondDog);
  });

  it('foundation: upsertDog updates an existing dog in place by id, rather than appending a duplicate', async () => {
    const repo = new LocalRepository();
    await repo.getUsers(DEMO_FAMILY.id); // trigger seed
    const renamed: Dog = { ...DEMO_DOG, name: 'טופי החדש' };

    await repo.upsertDog(renamed);

    const dogs = await repo.getDogs(DEMO_FAMILY.id);
    expect(dogs).toHaveLength(1);
    expect(dogs[0].name).toBe('טופי החדש');
  });

  it('getFamily returns undefined for a family id that does not match the cached family', async () => {
    const repo = new LocalRepository();
    await repo.getUsers(DEMO_FAMILY.id); // trigger seed
    const family = await repo.getFamily('some-other-family-id');
    expect(family).toBeUndefined();
  });
});

describe('LocalRepository — malformed on-disk cache', () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
  });

  it('re-seeds from demo data instead of throwing when the cached JSON is unparseable', async () => {
    await AsyncStorage.setItem(STORAGE_KEY, '{not valid json');

    const repo = new LocalRepository();
    const users = await repo.getUsers(DEMO_FAMILY.id);
    expect(users.length).toBeGreaterThan(0);
    expect(users.every((u) => u.familyId === DEMO_FAMILY.id)).toBe(true);
  });
});

describe('LocalRepository — replaceAll / createUser', () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
  });

  it('replaceAll overwrites the entire store and persists it', async () => {
    const repo = new LocalRepository();
    const replacementUser: FamilyUser = {
      id: 'user-replaced',
      familyId: DEMO_FAMILY.id,
      name: 'חדש',
      avatar: '🐶',
      color: '#123456',
      remindersEnabled: false,
      createdAt: new Date().toISOString(),
    };

    await repo.replaceAll({
      family: DEMO_FAMILY,
      users: [replacementUser],
      dogs: [DEMO_DOG],
      rules: DEMO_RULES,
      entries: DEMO_ENTRIES,
      walks: DEMO_WALKS,
    });

    const users = await repo.getUsers(DEMO_FAMILY.id);
    expect(users).toEqual([replacementUser]);

    // A fresh repository instance reading the same underlying storage sees
    // the replacement too, confirming replaceAll actually persisted it
    // rather than only updating the in-memory cache.
    const repo2 = new LocalRepository();
    const usersFromDisk = await repo2.getUsers(DEMO_FAMILY.id);
    expect(usersFromDisk).toEqual([replacementUser]);
  });

  it('createUser is an alias for upsertUser', async () => {
    const repo = new LocalRepository();
    await repo.getUsers(DEMO_FAMILY.id); // trigger seed
    const newUser: FamilyUser = {
      id: 'user-created-via-createUser',
      familyId: DEMO_FAMILY.id,
      name: 'נוצר',
      avatar: '🐾',
      color: '#abcdef',
      remindersEnabled: true,
      createdAt: new Date().toISOString(),
    };

    await repo.createUser(newUser);

    const users = await repo.getUsers(DEMO_FAMILY.id);
    expect(users.find((u) => u.id === newUser.id)).toEqual(newUser);
  });
});

describe('LocalRepository — deleteFamilyMember applies matched updates', () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
  });

  it('replaces an existing walk when its id is present in updatedWalks', async () => {
    const repo = new LocalRepository();
    const existingWalks = await repo.getWalks(DEMO_FAMILY.id); // trigger seed
    const target = existingWalks[0];
    const updatedWalk: Walk = { ...target, status: 'skipped' };

    await repo.deleteFamilyMember({
      userId: DEMO_USERS[0].id,
      updatedRules: [],
      updatedEntries: [],
      updatedWalks: [updatedWalk],
    });

    const walksAfter = await repo.getWalks(DEMO_FAMILY.id);
    expect(walksAfter.find((w) => w.id === target.id)?.status).toBe('skipped');
  });

  it('replaces an existing rule and entry when their ids are present in updatedRules/updatedEntries', async () => {
    const repo = new LocalRepository();
    const existingRules = await repo.getScheduleRules(DEMO_FAMILY.id); // trigger seed
    const existingEntries = await repo.getScheduleEntries(DEMO_FAMILY.id);
    const targetRule = existingRules[0];
    const targetEntry = existingEntries[0];
    const updatedRule = { ...targetRule, active: !targetRule.active };
    const updatedEntry = { ...targetEntry, responsibleUserId: DEMO_USERS[1].id };

    await repo.deleteFamilyMember({
      userId: DEMO_USERS[0].id,
      updatedRules: [updatedRule],
      updatedEntries: [updatedEntry],
      updatedWalks: [],
    });

    const rulesAfter = await repo.getScheduleRules(DEMO_FAMILY.id);
    const entriesAfter = await repo.getScheduleEntries(DEMO_FAMILY.id);
    expect(rulesAfter.find((r) => r.id === targetRule.id)?.active).toBe(updatedRule.active);
    expect(entriesAfter.find((e) => e.id === targetEntry.id)?.responsibleUserId).toBe(DEMO_USERS[1].id);
  });

  it('silently skips a rule/entry/walk id that no longer exists in the local store (concurrent-removal race)', async () => {
    const repo = new LocalRepository();
    const rulesBefore = await repo.getScheduleRules(DEMO_FAMILY.id); // trigger seed
    const entriesBefore = await repo.getScheduleEntries(DEMO_FAMILY.id);
    const walksBefore = await repo.getWalks(DEMO_FAMILY.id);

    const goneRule = { ...rulesBefore[0], id: 'rule-already-gone' };
    const goneEntry = { ...entriesBefore[0], id: 'entry-already-gone' };
    const goneWalk = { ...walksBefore[0], id: 'walk-already-gone' };

    await repo.deleteFamilyMember({
      userId: DEMO_USERS[0].id,
      updatedRules: [goneRule],
      updatedEntries: [goneEntry],
      updatedWalks: [goneWalk],
    });

    const rulesAfter = await repo.getScheduleRules(DEMO_FAMILY.id);
    const entriesAfter = await repo.getScheduleEntries(DEMO_FAMILY.id);
    const walksAfter = await repo.getWalks(DEMO_FAMILY.id);
    expect(rulesAfter).toHaveLength(rulesBefore.length);
    expect(entriesAfter).toHaveLength(entriesBefore.length);
    expect(walksAfter).toHaveLength(walksBefore.length);
    expect(rulesAfter.find((r) => r.id === goneRule.id)).toBeUndefined();
  });

  it('is a no-op on the users array when userId does not match any existing user', async () => {
    const repo = new LocalRepository();
    const usersBefore = await repo.getUsers(DEMO_FAMILY.id); // trigger seed

    await repo.deleteFamilyMember({
      userId: 'user-does-not-exist',
      updatedRules: [],
      updatedEntries: [],
      updatedWalks: [],
    });

    const usersAfter = await repo.getUsers(DEMO_FAMILY.id);
    expect(usersAfter).toEqual(usersBefore);
  });
});

describe('LocalRepository — updateScheduleEntry inserts an entry that does not already exist', () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
  });

  it('pushes a brand-new entry when its id has no existing match', async () => {
    const repo = new LocalRepository();
    const before = await repo.getScheduleEntries(DEMO_FAMILY.id); // trigger seed
    const newEntry: ScheduleEntry = {
      id: 'entry-brand-new',
      familyId: DEMO_FAMILY.id,
      dogId: DEMO_DOG.id,
      date: '2026-09-14',
      time: '10:00',
      responsibleUserId: DEMO_USERS[0].id,
      createdAt: new Date().toISOString(),
    };

    await repo.updateScheduleEntry(newEntry);

    const after = await repo.getScheduleEntries(DEMO_FAMILY.id);
    expect(after).toHaveLength(before.length + 1);
    expect(after.find((e) => e.id === newEntry.id)).toEqual(newEntry);
  });
});

describe('LocalRepository — saveWalk concurrent-completion guard', () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
  });

  it('keeps the already-saved walk when two different users both mark it done', async () => {
    const repo = new LocalRepository();
    const walks = await repo.getWalks(DEMO_FAMILY.id); // trigger seed
    const target = walks[0];

    const firstCompletion: Walk = {
      ...target,
      status: 'done',
      completedByUserId: DEMO_USERS[0].id,
      updatedAt: new Date().toISOString(),
    };
    await repo.saveWalk(firstCompletion);

    const secondCompletion: Walk = {
      ...target,
      status: 'done',
      completedByUserId: DEMO_USERS[1].id,
      updatedAt: new Date().toISOString(),
    };
    await repo.saveWalk(secondCompletion);

    const walksAfter = await repo.getWalks(DEMO_FAMILY.id);
    const saved = walksAfter.find((w) => w.id === target.id);
    // The second, conflicting completion must not overwrite the first.
    expect(saved?.completedByUserId).toBe(DEMO_USERS[0].id);
  });
});
