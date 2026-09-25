import { requestDogPhotoCutout } from '../backgroundRemoval';
import { supabase } from '../supabase';

// Defined as a literal inside the factory — see verifiedAdminOnboarding.test.ts's
// comment for why that pattern matters with jest.mock()'s hoisting.
jest.mock('../supabase', () => ({
  isSupabaseConfigured: true,
  supabase: {
    functions: { invoke: jest.fn() },
  },
}));

const mockInvoke = (supabase as unknown as { functions: { invoke: jest.Mock } }).functions.invoke;
// Mutated per-test via a plain `require()` (not `import * as ns`, which
// Babel's ESM interop copies into a fresh object for a non-`__esModule`
// mock, decoupling it from the live registry entry) so this reaches the
// exact same object backgroundRemoval.ts's compiled `require('./supabase')`
// reads `isSupabaseConfigured` from on every call.
const supabaseModuleMock = require('../supabase') as { isSupabaseConfigured: boolean };

describe('requestDogPhotoCutout — best-effort background-removal request', () => {
  beforeEach(() => {
    mockInvoke.mockReset();
    supabaseModuleMock.isSupabaseConfigured = true;
  });

  it('returns the cutout URL on a successful provider response', async () => {
    mockInvoke.mockResolvedValue({ data: { cutoutUrl: 'https://example.com/cutout.png' }, error: null });

    const result = await requestDogPhotoCutout('https://example.com/original.jpg');

    expect(result).toBe('https://example.com/cutout.png');
    expect(mockInvoke).toHaveBeenCalledWith('remove-photo-background', {
      body: { photoUrl: 'https://example.com/original.jpg' },
    });
  });

  it('returns null — never throws — when the Edge Function reports an error', async () => {
    mockInvoke.mockResolvedValue({ data: null, error: new Error('provider failed') });

    await expect(requestDogPhotoCutout('https://example.com/original.jpg')).resolves.toBeNull();
  });

  it('returns null when the response has no cutoutUrl', async () => {
    mockInvoke.mockResolvedValue({ data: {}, error: null });

    await expect(requestDogPhotoCutout('https://example.com/original.jpg')).resolves.toBeNull();
  });

  it('returns null — never throws — on a network/invoke exception', async () => {
    mockInvoke.mockRejectedValue(new Error('network down'));

    await expect(requestDogPhotoCutout('https://example.com/original.jpg')).resolves.toBeNull();
  });

  it('never calls the Edge Function when Supabase is not configured (demo mode)', async () => {
    supabaseModuleMock.isSupabaseConfigured = false;

    const result = await requestDogPhotoCutout('file:///local/photo.jpg');

    expect(result).toBeNull();
    expect(mockInvoke).not.toHaveBeenCalled();
  });
});
