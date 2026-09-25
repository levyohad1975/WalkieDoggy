import { DEMO_DOG, DEMO_FAMILY } from '../../data/demoData';
import type { Dog } from '../../types';

const SELECTED_DOG_KEY = 'dog-walk-family:selected-dog-id';

/**
 * Phase 1B batch 2 (user-facing multi-dog foundation): a device must track
 * a clearly defined SELECTED/active dog rather than silently relying on
 * `dogs[0]` — every dog-dependent screen (Home, new walk/rule creation,
 * ...) reads `dog` from this store, so `dog` must always point at the
 * chosen one, and that choice must survive an app restart.
 */
describe('familyStore — dog selection (arbitrary N dogs)', () => {
  beforeEach(() => {
    jest.resetModules();
  });

  it('selectDog(dogId) makes that dog active in both `dog` and `selectedDogId`, without disturbing `dogs`', async () => {
    const AsyncStorage = require('@react-native-async-storage/async-storage');
    await AsyncStorage.clear();
    const { useFamilyStore } = require('../familyStore');

    await useFamilyStore.getState().load(DEMO_FAMILY.id);
    const secondDog: Dog = { id: 'dog-second', familyId: DEMO_FAMILY.id, name: 'רעי', walksPerDay: 3 };
    // Adding a second dog must NOT change who's currently selected — see
    // saveDog's own doc comment.
    await useFamilyStore.getState().saveDog(secondDog);
    expect(useFamilyStore.getState().selectedDogId).toBe(DEMO_DOG.id);

    await useFamilyStore.getState().selectDog(secondDog.id);

    const state = useFamilyStore.getState();
    expect(state.dog).toEqual(secondDog);
    expect(state.selectedDogId).toBe(secondDog.id);
    expect(state.dogs).toHaveLength(2);
    expect(state.dogs.find((d: Dog) => d.id === DEMO_DOG.id)).toBeDefined();
  });

  it('selectDog persists the choice so a later load() (e.g. after an app restart) restores it', async () => {
    const AsyncStorage = require('@react-native-async-storage/async-storage');
    await AsyncStorage.clear();
    const { useFamilyStore } = require('../familyStore');

    await useFamilyStore.getState().load(DEMO_FAMILY.id);
    const secondDog: Dog = { id: 'dog-second', familyId: DEMO_FAMILY.id, name: 'רעי', walksPerDay: 3 };
    await useFamilyStore.getState().saveDog(secondDog);
    await useFamilyStore.getState().selectDog(secondDog.id);
    expect(await AsyncStorage.getItem(SELECTED_DOG_KEY)).toBe(secondDog.id);

    // Simulate re-opening the app: load() again, deriving `dog`/`dogs`/
    // `selectedDogId` entirely from scratch (family/users/dogs + the
    // persisted key) — must recover the persisted choice, not default back
    // to the first dog the way a fresh load() with no persisted key would.
    await useFamilyStore.getState().load(DEMO_FAMILY.id);

    const state = useFamilyStore.getState();
    expect(state.dog?.id).toBe(secondDog.id);
    expect(state.selectedDogId).toBe(secondDog.id);
  });

  it('a persisted selection pointing at a dog that no longer exists falls back to the first dog instead of leaving `dog` unresolved', async () => {
    const AsyncStorage = require('@react-native-async-storage/async-storage');
    await AsyncStorage.clear();
    await AsyncStorage.setItem(SELECTED_DOG_KEY, 'dog-that-was-removed');
    const { useFamilyStore } = require('../familyStore');

    await useFamilyStore.getState().load(DEMO_FAMILY.id);

    const state = useFamilyStore.getState();
    expect(state.dog?.id).toBe(DEMO_DOG.id);
    expect(state.selectedDogId).toBe(DEMO_DOG.id);
  });

  it('selectDog with an id that is not one of this family\'s dogs is a no-op', async () => {
    const AsyncStorage = require('@react-native-async-storage/async-storage');
    await AsyncStorage.clear();
    const { useFamilyStore } = require('../familyStore');

    await useFamilyStore.getState().load(DEMO_FAMILY.id);
    const before = useFamilyStore.getState();

    await useFamilyStore.getState().selectDog('not-a-real-dog-id');

    const after = useFamilyStore.getState();
    expect(after.dog).toEqual(before.dog);
    expect(after.selectedDogId).toBe(before.selectedDogId);
  });

  it('saveDog for the family\'s very first dog (nothing selected yet) selects it', async () => {
    const AsyncStorage = require('@react-native-async-storage/async-storage');
    await AsyncStorage.clear();
    const { useFamilyStore } = require('../familyStore');
    const { repository } = require('../../data');

    // No dogs at all for this family yet, and not the local/demo fallback
    // family — mirrors a fresh Supabase-backed family before its first dog
    // is added.
    jest.spyOn(repository, 'getFamily').mockResolvedValueOnce({ id: 'family-fresh', name: 'משפחה חדשה', createdAt: new Date().toISOString() });
    jest.spyOn(repository, 'getUsers').mockResolvedValueOnce([]);
    jest.spyOn(repository, 'getDogs').mockResolvedValueOnce([]);

    await useFamilyStore.getState().load('family-fresh');
    expect(useFamilyStore.getState().dog).toBeNull();

    const firstDog: Dog = { id: 'dog-first', familyId: 'family-fresh', name: 'בירה', walksPerDay: 4 };
    await useFamilyStore.getState().saveDog(firstDog);

    const state = useFamilyStore.getState();
    expect(state.dog).toEqual(firstDog);
    expect(state.selectedDogId).toBe(firstDog.id);
  });
});
