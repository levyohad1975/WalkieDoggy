import fs from 'fs';
import path from 'path';

const ROOT = path.resolve(__dirname, '../../..');
const read = (relative: string) => fs.readFileSync(path.join(ROOT, relative), 'utf8');

describe('generateDogPhotoCutout client errors', () => {
  const ORIGINAL_ENV = process.env;
  const mockInvoke = jest.fn();

  function loadSupabaseLib() {
    jest.resetModules();
    process.env = {
      ...ORIGINAL_ENV,
      EXPO_PUBLIC_SUPABASE_URL: 'https://example.supabase.co',
      EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'anon-key',
    };
    jest.doMock('@supabase/supabase-js', () => ({
      createClient: () => ({ functions: { invoke: mockInvoke }, auth: {} }),
    }));
    return require('../supabase') as typeof import('../supabase');
  }

  afterEach(() => {
    process.env = ORIGINAL_ENV;
    mockInvoke.mockReset();
    jest.dontMock('@supabase/supabase-js');
  });

  it('returns the verified cutout URL on success', async () => {
    const lib = loadSupabaseLib();
    mockInvoke.mockResolvedValue({ data: { cutoutUrl: 'https://cdn/cutout.png' }, error: null });
    await expect(lib.generateDogPhotoCutout('dog-1')).resolves.toBe('https://cdn/cutout.png');
    expect(mockInvoke).toHaveBeenCalledWith('generate-dog-cutout', { body: { dogId: 'dog-1' } });
  });

  it('surfaces the Edge Function code when output was not transparent, with a Hebrew retry message', async () => {
    const lib = loadSupabaseLib();
    const context = { json: async () => ({ error: 'cutout_not_transparent', reason: 'fully_opaque' }) };
    mockInvoke.mockResolvedValue({ data: null, error: Object.assign(new Error('non-2xx'), { context }) });
    const failure = await lib.generateDogPhotoCutout('dog-1').catch((e: unknown) => e);
    expect(failure).toBeInstanceOf(lib.DogCutoutError);
    expect((failure as InstanceType<typeof lib.DogCutoutError>).code).toBe('cutout_not_transparent');
    expect(lib.describeDogCutoutFailure(failure)).toContain('לא הצלחנו להפריד את הכלב מהרקע');
  });

  it('maps provider quota / busy failures and unknown errors to clear messages', async () => {
    const lib = loadSupabaseLib();
    expect(lib.describeDogCutoutFailure(new lib.DogCutoutError('background_removal_quota_exhausted'))).toContain('מכסה');
    expect(lib.describeDogCutoutFailure(new lib.DogCutoutError('background_removal_busy'))).toContain('עמוס');
    expect(lib.describeDogCutoutFailure(new Error('boom'))).toBe('לא הצלחנו להסיר את הרקע כרגע. אפשר לנסות שוב מאותו מסך.');

    mockInvoke.mockResolvedValue({ data: null, error: Object.assign(new Error('network'), { context: undefined }) });
    await expect(lib.generateDogPhotoCutout('dog-1')).rejects.toMatchObject({ code: 'request_failed' });
    mockInvoke.mockResolvedValue({ data: {}, error: null });
    await expect(lib.generateDogPhotoCutout('dog-1')).rejects.toMatchObject({ code: 'no_cutout_url' });
  });
});

describe('generate-dog-cutout Edge Function contract', () => {
  const fn = read('supabase/functions/generate-dog-cutout/index.ts');

  it('verifies transparency before anything is stored or persisted', () => {
    const verify = fn.indexOf('await analyzePngTransparency(png, inflateChunks)');
    const upload = fn.indexOf('.upload(path, png');
    const persist = fn.indexOf('.update({ photo_cutout_url: cutoutUrl })');
    expect(fn).toContain('import { analyzePngTransparency } from "../_shared/pngTransparency.ts";');
    expect(verify).toBeGreaterThan(0);
    expect(verify).toBeLessThan(upload);
    expect(upload).toBeLessThan(persist);
  });

  it('rejects non-transparent output with 422 and never touches the dog row or storage', () => {
    const rejectBlock = fn.slice(fn.indexOf('if (!verdict.ok) {'), fn.indexOf('const admin = createClient'));
    expect(rejectBlock).toContain('"cutout_not_transparent"');
    expect(rejectBlock).toContain('status: 422');
    expect(rejectBlock).not.toContain('.upload(');
    expect(rejectBlock).not.toContain('.update(');
  });

  it('requests a transparent PNG (no bg colour) and maps quota/busy failures', () => {
    expect(fn).toContain('"https://bgninja.com/api/remove"');
    expect(fn).not.toMatch(/form\.append\("bg"/);
    expect(fn).toContain('"background_removal_quota_exhausted"');
    expect(fn).toContain('"background_removal_busy"');
    expect(fn).toContain('new DecompressionStream("deflate")');
  });

  it('keeps the original photo authoritative and guards against a racing upload', () => {
    expect(fn).toContain('.eq("photo_url", dog.photo_url)');
    expect(fn).toContain('Source photos are never deleted here.');
    expect(fn).not.toMatch(/update\(\{[^}]*photo_url:/);
  });
});

describe('dog photo upload pipeline (client)', () => {
  const settings = read('src/screens/SettingsScreen.tsx');
  const modal = read('src/components/DogProfileModal.tsx');
  const wizard = read('src/screens/FamilySetupWizard.tsx');
  const repository = read('src/data/supabaseRepository.ts');

  it('persists the new source photo and clears the stale cutout before requesting processing', () => {
    expect(settings).toContain('await persistDog({ photoUrl: uri, photoCutoutUrl: undefined });');
    expect(settings.indexOf('await persistDog({ photoUrl: uri, photoCutoutUrl: undefined });'))
      .toBeLessThan(settings.indexOf('await generateDogPhotoCutout(dog.id);'));
    expect(modal).toContain('saveDog({ ...dog, photoUrl: photoUrlToProcess, photoCutoutUrl: undefined })');
    expect(wizard).toContain('photoChanged ? { photoCutoutUrl: undefined } : {}');
  });

  it('keeps the original photo and explains the failure when processing fails', () => {
    expect(settings).toContain("Alert.alert('התמונה נשמרה ללא הסרת רקע', describeDogCutoutFailure(cutoutError));");
    expect(modal).toContain("Alert.alert('התמונה המקורית נשמרה', describeDogCutoutFailure(cutoutError));");
    expect(wizard).toContain('keeping source photo fallback');
  });

  it('reloads the family after a successful job so the persisted photo_cutout_url reaches Home', () => {
    expect(settings).toMatch(/await generateDogPhotoCutout\(dog\.id\);\s*await loadFamily\(familyId\);/);
    expect(modal).toMatch(/await generateDogPhotoCutout\(dogId\);\s*await loadFamily\(familyId\);/);
    expect(repository).toContain('photoCutoutUrl: row.photo_cutout_url ?? undefined');
    expect(repository).toContain('photo_cutout_url: dog.photoCutoutUrl ?? null');
  });

  it('offers background removal again when the saved cutout has no real transparency', () => {
    expect(modal).toContain("const cutoutNeedsProcessing = Boolean(dog?.photoUrl) && (!dog?.photoCutoutUrl || cutoutVerdict === 'opaque');");
    expect(modal).toContain('{cutoutNeedsProcessing ? (');
    expect(modal).toContain('accessibilityLabel="הסרת הרקע מתמונת הכלב"');
  });
});
