import { Alert, Linking } from 'react-native';

const mockRequestMediaLibraryPermissionsAsync = jest.fn();
const mockLaunchImageLibraryAsync = jest.fn();

jest.mock('expo-image-picker', () => ({
  requestMediaLibraryPermissionsAsync: (...args: unknown[]) =>
    mockRequestMediaLibraryPermissionsAsync(...args),
  launchImageLibraryAsync: (...args: unknown[]) =>
    mockLaunchImageLibraryAsync(...args),
}));

const ORIGINAL_ENV = process.env;

function configureSupabaseEnv(configured: boolean) {
  process.env = configured
    ? {
        ...ORIGINAL_ENV,
        EXPO_PUBLIC_SUPABASE_URL: 'https://example.supabase.co',
        EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'anon-key',
      }
    : { ...ORIGINAL_ENV, EXPO_PUBLIC_SUPABASE_URL: '', EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY: '' };
}

/** Same @supabase/supabase-js-level mocking style as realtime.test.ts. */
function mockConfiguredSupabase() {
  const uploadMock = jest.fn().mockResolvedValue({ error: null });
  const getPublicUrlMock = jest.fn().mockReturnValue({ data: { publicUrl: 'https://cdn.example/photo.jpg' } });
  const fromMock = jest.fn(() => ({ upload: uploadMock, getPublicUrl: getPublicUrlMock }));

  jest.doMock('@supabase/supabase-js', () => ({
    createClient: jest.fn(() => ({
      auth: {
        getSession: jest.fn().mockResolvedValue({ data: { session: null } }),
        signInAnonymously: jest.fn().mockResolvedValue({ error: null }),
      },
      rpc: jest.fn(),
      from: jest.fn(),
      storage: { from: fromMock },
      channel: jest.fn(),
      removeChannel: jest.fn(),
    })),
  }));

  return { uploadMock, getPublicUrlMock, fromMock };
}

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

describe('pickAndUploadImage — permission alerts', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
  });

  afterEach(() => {
    process.env = ORIGINAL_ENV;
  });

  it('offers to open device Settings when permission is denied and canAskAgain is false, and opens it on press', async () => {
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    const openSettingsSpy = jest.spyOn(Linking, 'openSettings').mockResolvedValue(undefined);
    mockRequestMediaLibraryPermissionsAsync.mockResolvedValue({ granted: false, canAskAgain: false });
    const { pickAndUploadImage } = require('../uploadImage');

    const result = await pickAndUploadImage('dogs', 'family-1', 'dog-1');

    expect(result).toBeNull();
    expect(mockLaunchImageLibraryAsync).not.toHaveBeenCalled();
    const buttons = alertSpy.mock.calls[0]?.[2] as { text?: string; onPress?: () => void }[] | undefined;
    buttons?.find((b) => b.text === 'פתח הגדרות')?.onPress?.();
    expect(openSettingsSpy).toHaveBeenCalled();
  });

  it('shows a plain permission alert (no Settings button) when canAskAgain is true', async () => {
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    mockRequestMediaLibraryPermissionsAsync.mockResolvedValue({ granted: false, canAskAgain: true });
    const { pickAndUploadImage } = require('../uploadImage');

    const result = await pickAndUploadImage('dogs', 'family-1', 'dog-1');

    expect(result).toBeNull();
    expect(mockLaunchImageLibraryAsync).not.toHaveBeenCalled();
    expect(alertSpy.mock.calls[0]?.[2]).toBeUndefined();
  });

  it.each(['all', 'limited'] as const)(
    'proceeds to the picker when accessPrivileges is "%s" even though granted is false',
    async (accessPrivileges) => {
      jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
      mockRequestMediaLibraryPermissionsAsync.mockResolvedValue({ granted: false, accessPrivileges, canAskAgain: true });
      mockLaunchImageLibraryAsync.mockResolvedValue({ canceled: true, assets: [] });
      const { pickAndUploadImage } = require('../uploadImage');

      await pickAndUploadImage('dogs', 'family-1', 'dog-1');

      expect(mockLaunchImageLibraryAsync).toHaveBeenCalled();
    },
  );
});

describe('pickAndUploadImage — picker result', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    mockRequestMediaLibraryPermissionsAsync.mockResolvedValue({ granted: true });
  });

  afterEach(() => {
    process.env = ORIGINAL_ENV;
  });

  it('returns null when the user cancels the picker', async () => {
    mockLaunchImageLibraryAsync.mockResolvedValue({ canceled: true, assets: [] });
    const { pickAndUploadImage } = require('../uploadImage');

    expect(await pickAndUploadImage('dogs', 'family-1', 'dog-1')).toBeNull();
  });

  it('returns null when the picker resolves with no assets', async () => {
    mockLaunchImageLibraryAsync.mockResolvedValue({ canceled: false, assets: [] });
    const { pickAndUploadImage } = require('../uploadImage');

    expect(await pickAndUploadImage('dogs', 'family-1', 'dog-1')).toBeNull();
  });
});

describe('pickAndUploadImage — demo mode (Supabase not configured)', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    mockRequestMediaLibraryPermissionsAsync.mockResolvedValue({ granted: true });
    configureSupabaseEnv(false);
  });

  afterEach(() => {
    process.env = ORIGINAL_ENV;
  });

  it('returns the local asset URI without touching Supabase Storage', async () => {
    mockLaunchImageLibraryAsync.mockResolvedValue({
      canceled: false,
      assets: [{ uri: 'file:///local/photo.jpg', mimeType: 'image/jpeg' }],
    });
    const fetchSpy = jest.spyOn(global, 'fetch');
    const { pickAndUploadImage } = require('../uploadImage');

    const result = await pickAndUploadImage('dogs', 'family-1', 'dog-1');

    expect(result).toBe('file:///local/photo.jpg');
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe('pickAndUploadImage — Supabase Storage upload', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    jest.spyOn(Date, 'now').mockReturnValue(1700000000000);
    mockRequestMediaLibraryPermissionsAsync.mockResolvedValue({ granted: true });
    configureSupabaseEnv(true);
  });

  afterEach(() => {
    process.env = ORIGINAL_ENV;
    jest.restoreAllMocks();
  });

  function mockFetchAsset() {
    jest.spyOn(global, 'fetch').mockResolvedValue({
      arrayBuffer: () => Promise.resolve(new ArrayBuffer(4)),
    } as unknown as Response);
  }

  it('uploads to the dog folder and returns the public URL, defaulting to .jpg', async () => {
    const { uploadMock, getPublicUrlMock, fromMock } = mockConfiguredSupabase();
    mockLaunchImageLibraryAsync.mockResolvedValue({
      canceled: false,
      assets: [{ uri: 'file:///local/photo.jpg' }],
    });
    mockFetchAsset();
    const { pickAndUploadImage } = require('../uploadImage');

    const result = await pickAndUploadImage('dogs', 'family-9', 'dog-3');

    expect(fromMock).toHaveBeenCalledWith('family-photos');
    expect(uploadMock).toHaveBeenCalledWith('family-9/dog/1700000000000.jpg', expect.any(ArrayBuffer), {
      contentType: 'image/jpeg',
      upsert: true,
    });
    expect(getPublicUrlMock).toHaveBeenCalledWith('family-9/dog/1700000000000.jpg');
    expect(result).toBe('https://cdn.example/photo.jpg');
  });

  it('uploads to the users/{id} folder with a .png extension for image/png assets', async () => {
    const { uploadMock } = mockConfiguredSupabase();
    mockLaunchImageLibraryAsync.mockResolvedValue({
      canceled: false,
      assets: [{ uri: 'file:///local/photo.png', mimeType: 'image/png' }],
    });
    mockFetchAsset();
    const { pickAndUploadImage } = require('../uploadImage');

    await pickAndUploadImage('users', 'family-9', 'user-5');

    expect(uploadMock).toHaveBeenCalledWith('family-9/users/user-5/1700000000000.png', expect.any(ArrayBuffer), {
      contentType: 'image/png',
      upsert: true,
    });
  });

  it('uses a .webp extension for image/webp assets', async () => {
    const { uploadMock } = mockConfiguredSupabase();
    mockLaunchImageLibraryAsync.mockResolvedValue({
      canceled: false,
      assets: [{ uri: 'file:///local/photo.webp', mimeType: 'image/webp' }],
    });
    mockFetchAsset();
    const { pickAndUploadImage } = require('../uploadImage');

    await pickAndUploadImage('dogs', 'family-9', 'dog-3');

    expect(uploadMock).toHaveBeenCalledWith('family-9/dog/1700000000000.webp', expect.any(ArrayBuffer), {
      contentType: 'image/webp',
      upsert: true,
    });
  });

  it('throws when Supabase Storage returns an upload error', async () => {
    const { uploadMock } = mockConfiguredSupabase();
    const storageError = new Error('storage quota exceeded');
    uploadMock.mockResolvedValue({ error: storageError });
    mockLaunchImageLibraryAsync.mockResolvedValue({
      canceled: false,
      assets: [{ uri: 'file:///local/photo.jpg' }],
    });
    mockFetchAsset();
    const { pickAndUploadImage } = require('../uploadImage');

    await expect(pickAndUploadImage('dogs', 'family-9', 'dog-3')).rejects.toBe(storageError);
  });
});
