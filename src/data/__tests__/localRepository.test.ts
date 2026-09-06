import AsyncStorage from '@react-native-async-storage/async-storage';
import { LocalRepository } from '../localRepository';
import { DEMO_FAMILY } from '../demoData';
import type { Dog, Family, FamilyUser, ScheduleEntry, Walk } from '../../types';

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
});
