import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  beginFamilySetup,
  clearFamilySetupProgress,
  isFamilyCreationPending,
  markFamilyCreationPending,
  readFamilySetupProgress,
  saveFamilySetupProgress,
} from '../familySetupProgress';

describe('resumable family setup progress', () => {
  beforeEach(async () => { await AsyncStorage.clear(); });

  it('persists the family, step and stable admin profile across reloads', async () => {
    const progress = { familyId: 'family-1', step: 3 as const, adminUserId: 'admin-1', adminName: 'יעל כהן' };
    await saveFamilySetupProgress(progress);
    await expect(readFamilySetupProgress()).resolves.toEqual(progress);
  });

  it('recovers the create request marker and converts it into resumable dog setup', async () => {
    await markFamilyCreationPending('verified-auth-user');
    expect(await isFamilyCreationPending()).toBe(true);
    await expect(readFamilySetupProgress()).resolves.toBeNull();
    await beginFamilySetup('family-2', 'verified-auth-user');
    expect(await isFamilyCreationPending()).toBe(false);
    await expect(readFamilySetupProgress()).resolves.toEqual({ familyId: 'family-2', ownerAuthUserId: 'verified-auth-user', step: 2 });
  });

  it('clears setup only after completion', async () => {
    await markFamilyCreationPending();
    await saveFamilySetupProgress({ familyId: 'family-3', step: 5 });
    await clearFamilySetupProgress();
    expect(await isFamilyCreationPending()).toBe(false);
    await expect(readFamilySetupProgress()).resolves.toBeNull();
  });
});
