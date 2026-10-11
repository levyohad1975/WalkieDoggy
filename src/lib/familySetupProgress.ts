import AsyncStorage from '@react-native-async-storage/async-storage';

export const FAMILY_SETUP_PROGRESS_KEY = 'walkie-family-setup-progress:v1';
export const FAMILY_CREATION_PENDING_KEY = 'walkie-family-creation-pending:v1';
const FAMILY_SETUP_COMPLETE_KEY_PREFIX = 'walkie-family-setup-complete:v1:';

export type FamilySetupProgress = {
  familyId: string;
  /** Supabase auth identity that created this family; prevents a different account on the same device from inheriting its draft. */
  ownerAuthUserId?: string;
  /** The post-creation screen to resume: dog, members, schedule, or ready. */
  step: 1 | 2 | 3 | 4 | 5;
  adminUserId?: string;
  adminName?: string;
  /** Uploaded image awaiting the required dog name before a Dog row exists. */
  pendingDogPhotoUrl?: string;
  /** Temporary Step 2 draft, copied to Dog.sex when the profile is saved. */
  pendingDogSex?: 'male' | 'female';
};

export async function readFamilySetupProgress(): Promise<FamilySetupProgress | null> {
  const raw = await AsyncStorage.getItem(FAMILY_SETUP_PROGRESS_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<FamilySetupProgress>;
    if (typeof parsed.familyId !== 'string' || ![1, 2, 3, 4, 5].includes(Number(parsed.step))) return null;
    return {
      familyId: parsed.familyId,
      step: Number(parsed.step) as FamilySetupProgress['step'],
      ...(typeof parsed.ownerAuthUserId === 'string' ? { ownerAuthUserId: parsed.ownerAuthUserId } : {}),
      ...(typeof parsed.adminUserId === 'string' ? { adminUserId: parsed.adminUserId } : {}),
      ...(typeof parsed.adminName === 'string' ? { adminName: parsed.adminName } : {}),
      ...(typeof parsed.pendingDogPhotoUrl === 'string' ? { pendingDogPhotoUrl: parsed.pendingDogPhotoUrl } : {}),
      ...(parsed.pendingDogSex === 'male' || parsed.pendingDogSex === 'female' ? { pendingDogSex: parsed.pendingDogSex } : {}),
    };
  } catch {
    return null;
  }
}

export async function saveFamilySetupProgress(progress: FamilySetupProgress): Promise<void> {
  await AsyncStorage.setItem(FAMILY_SETUP_PROGRESS_KEY, JSON.stringify(progress));
}

export async function clearFamilySetupProgress(): Promise<void> {
  await AsyncStorage.multiRemove([FAMILY_SETUP_PROGRESS_KEY, FAMILY_CREATION_PENDING_KEY]);
}

export async function isFamilySetupComplete(familyId: string): Promise<boolean> {
  return (await AsyncStorage.getItem(`${FAMILY_SETUP_COMPLETE_KEY_PREFIX}${familyId}`)) === '1';
}

export async function markFamilySetupComplete(familyId: string): Promise<void> {
  await AsyncStorage.setItem(`${FAMILY_SETUP_COMPLETE_KEY_PREFIX}${familyId}`, '1');
}

export async function clearFamilySetupCompletion(familyId: string): Promise<void> {
  await AsyncStorage.removeItem(`${FAMILY_SETUP_COMPLETE_KEY_PREFIX}${familyId}`);
}

export async function markFamilyCreationPending(ownerAuthUserId?: string): Promise<void> {
  await AsyncStorage.setItem(FAMILY_CREATION_PENDING_KEY, ownerAuthUserId ?? '1');
}

export async function isFamilyCreationPending(): Promise<boolean> {
  return (await AsyncStorage.getItem(FAMILY_CREATION_PENDING_KEY)) !== null;
}

export async function getFamilyCreationOwnerId(): Promise<string | null> {
  const ownerId = await AsyncStorage.getItem(FAMILY_CREATION_PENDING_KEY);
  return ownerId && ownerId !== '1' ? ownerId : null;
}

export async function beginFamilySetup(familyId: string, ownerAuthUserId?: string): Promise<FamilySetupProgress> {
  const progress: FamilySetupProgress = { familyId, step: 2, ...(ownerAuthUserId ? { ownerAuthUserId } : {}) };
  await saveFamilySetupProgress(progress);
  await AsyncStorage.removeItem(FAMILY_CREATION_PENDING_KEY);
  return progress;
}
