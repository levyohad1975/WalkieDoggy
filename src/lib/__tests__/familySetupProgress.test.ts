import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  beginFamilySetup,
  clearFamilySetupProgress,
  isFamilyCreationPending,
  markFamilyCreationPending,
  isFamilySetupComplete,
  markFamilySetupComplete,
  clearFamilySetupCompletion,
  readFamilySetupProgress,
  saveFamilySetupProgress,
} from '../familySetupProgress';

describe('resumable family setup progress', () => {
  beforeEach(async () => { await AsyncStorage.clear(); });

  it('persists the family, step and stable admin profile across reloads', async () => {
    const progress = { familyId: 'family-1', step: 3 as const, adminUserId: 'admin-1', adminName: 'יעל כהן', pendingDogPhotoUrl: 'https://cdn.example/dog.jpg' };
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

  it('keeps QA completion scoped to its family across app restarts and removes it when that QA family is deleted', async () => {
    await markFamilySetupComplete('qa-family-1');
    await expect(isFamilySetupComplete('qa-family-1')).resolves.toBe(true);
    await expect(isFamilySetupComplete('family-original')).resolves.toBe(false);
    await clearFamilySetupCompletion('qa-family-1');
    await expect(isFamilySetupComplete('qa-family-1')).resolves.toBe(false);
  });
});
