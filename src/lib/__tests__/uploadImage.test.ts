import { Alert } from 'react-native';

const mockRequestMediaLibraryPermissionsAsync = jest.fn();
const mockLaunchImageLibraryAsync = jest.fn();

jest.mock('expo-image-picker', () => ({
  requestMediaLibraryPermissionsAsync: (...args: unknown[]) =>
    mockRequestMediaLibraryPermissionsAsync(...args),
  launchImageLibraryAsync: (...args: unknown[]) =>
    mockLaunchImageLibraryAsync(...args),
}));

/**
 * pickAndUploadImage() is the one real Supabase Storage mutation that
 * happens OUTSIDE scheduleStore/familyStore/requestsStore — it's called
 * directly from UserFormModal.pickPhoto() and
 * SettingsScreen.changeDogPhoto() BEFORE their later store.updateUser()/
 * saveDog() call, so a photo could previously be uploaded to Storage even
 * though the later store write was correctly blocked by Admin Test Mode.
 * These tests prove the fix: the guard is now the very FIRST thing this
 * function does, before even requesting photo-library permission, so
 * nothing — not the permission prompt, not the picker, not the upload —
 * happens while `testModeUserId` is set.
 */
describe('pickAndUploadImage — Admin Test Mode', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  });

  it('returns null immediately and never requests permission or opens the picker while Test Mode is active', async () => {
    const { useAuthStore } = require('../../store/authStore');
    useAuthStore.setState({ testModeUserId: 'member-being-simulated' });
    const { pickAndUploadImage } = require('../uploadImage');

    const result = await pickAndUploadImage('dogs', 'family-main', 'dog-1');

    expect(result).toBeNull();
    expect(mockRequestMediaLibraryPermissionsAsync).not.toHaveBeenCalled();
    expect(mockLaunchImageLibraryAsync).not.toHaveBeenCalled();
    expect(Alert.alert).toHaveBeenCalled();
  });

  it('proceeds normally (asks permission) when Test Mode is not active', async () => {
    const { useAuthStore } = require('../../store/authStore');
    useAuthStore.setState({ testModeUserId: null });
    mockRequestMediaLibraryPermissionsAsync.mockResolvedValue({ granted: false });
    const { pickAndUploadImage } = require('../uploadImage');

    const result = await pickAndUploadImage('dogs', 'family-main', 'dog-1');

    expect(mockRequestMediaLibraryPermissionsAsync).toHaveBeenCalled();
    expect(result).toBeNull(); // permission denied in this test, but the guard did NOT short-circuit it
  });
});
