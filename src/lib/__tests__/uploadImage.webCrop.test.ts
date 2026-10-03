import { Alert, Platform } from 'react-native';

const mockRequestMediaLibraryPermissionsAsync = jest.fn();
const mockLaunchImageLibraryAsync = jest.fn();
const mockRequestPhotoCrop = jest.fn();

jest.mock('expo-image-picker', () => ({
  requestMediaLibraryPermissionsAsync: (...args: unknown[]) => mockRequestMediaLibraryPermissionsAsync(...args),
  launchImageLibraryAsync: (...args: unknown[]) => mockLaunchImageLibraryAsync(...args),
}));

jest.mock('../photoCropHost', () => ({
  requestPhotoCrop: (...args: unknown[]) => mockRequestPhotoCrop(...args),
}));

const ORIGINAL_ENV = process.env;
const originalPlatformOS = Platform.OS;

function setPlatformOS(os: typeof Platform.OS) {
  Object.defineProperty(Platform, 'OS', { value: os, configurable: true, writable: true });
}

function configureSupabaseEnv(configured: boolean) {
  process.env = configured
    ? { ...ORIGINAL_ENV, EXPO_PUBLIC_SUPABASE_URL: 'https://example.supabase.co', EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'anon-key' }
    : { ...ORIGINAL_ENV, EXPO_PUBLIC_SUPABASE_URL: '', EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY: '' };
}

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
 * PRD §12 — Web has no native allowsEditing crop UI (see uploadImage.ts's
 * comment right above the Platform.OS === 'web' branch), so pickAndUploadImage
 * routes through requestPhotoCrop() there and nowhere else. These tests
 * never touch the real PhotoCropModal/PhotoCropHost — that's photoCropHost's
 * own contract, mocked here — only that pickAndUploadImage calls into it
 * correctly and honors its result.
 */
describe('pickAndUploadImage — web crop step (PRD §12)', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    mockRequestMediaLibraryPermissionsAsync.mockResolvedValue({ granted: true });
    setPlatformOS('web');
  });

  afterEach(() => {
    process.env = ORIGINAL_ENV;
    setPlatformOS(originalPlatformOS);
  });

  it('never calls requestPhotoCrop on native platforms', async () => {
    setPlatformOS('ios');
    configureSupabaseEnv(false);
    mockLaunchImageLibraryAsync.mockResolvedValue({ canceled: false, assets: [{ uri: 'file:///local/photo.jpg' }] });
    const { pickAndUploadImage } = require('../uploadImage');

    const result = await pickAndUploadImage('dogs', 'family-1', 'dog-1');

    expect(mockRequestPhotoCrop).not.toHaveBeenCalled();
    expect(result).toBe('file:///local/photo.jpg');
  });

  it('on web, calls requestPhotoCrop with the picked asset uri before returning (demo mode)', async () => {
    configureSupabaseEnv(false);
    mockLaunchImageLibraryAsync.mockResolvedValue({ canceled: false, assets: [{ uri: 'file:///local/photo.jpg' }] });
    mockRequestPhotoCrop.mockResolvedValue('blob:cropped-uri');
    const { pickAndUploadImage } = require('../uploadImage');

    const result = await pickAndUploadImage('dogs', 'family-1', 'dog-1');

    expect(mockRequestPhotoCrop).toHaveBeenCalledWith('file:///local/photo.jpg');
    expect(result).toBe('blob:cropped-uri');
  });

  it('on web, cancelling the crop step (requestPhotoCrop resolves null) cancels the whole pick', async () => {
    configureSupabaseEnv(false);
    mockLaunchImageLibraryAsync.mockResolvedValue({ canceled: false, assets: [{ uri: 'file:///local/photo.jpg' }] });
    mockRequestPhotoCrop.mockResolvedValue(null);
    const fetchSpy = jest.spyOn(global, 'fetch');
    const { pickAndUploadImage } = require('../uploadImage');

    const result = await pickAndUploadImage('dogs', 'family-1', 'dog-1');

    expect(result).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('on web with Supabase configured, uploads the CROPPED uri and forces image/jpeg regardless of the original asset mime type', async () => {
    configureSupabaseEnv(true);
    jest.spyOn(Date, 'now').mockReturnValue(1700000000000);
    const { uploadMock, fromMock } = mockConfiguredSupabase();
    mockLaunchImageLibraryAsync.mockResolvedValue({
      canceled: false,
      assets: [{ uri: 'file:///local/photo.png', mimeType: 'image/png' }],
    });
    mockRequestPhotoCrop.mockResolvedValue('blob:cropped-uri');
    jest.spyOn(global, 'fetch').mockResolvedValue({ arrayBuffer: () => Promise.resolve(new ArrayBuffer(4)) } as unknown as Response);
    const { pickAndUploadImage } = require('../uploadImage');

    await pickAndUploadImage('dogs', 'family-9', 'dog-3');

    expect(global.fetch).toHaveBeenCalledWith('blob:cropped-uri');
    expect(fromMock).toHaveBeenCalledWith('family-photos');
    expect(uploadMock).toHaveBeenCalledWith('family-9/dog/1700000000000.jpg', expect.any(ArrayBuffer), {
      contentType: 'image/jpeg',
      upsert: true,
    });
  });
});
