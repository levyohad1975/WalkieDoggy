import { describeDogCutoutJob, runDogCutoutJob, type DogCutoutJobDeps } from '../dogCutoutJob';
import { DogCutoutError } from '../supabase';

function deps(overrides: Partial<DogCutoutJobDeps>): DogCutoutJobDeps & { generate: jest.Mock; verify: jest.Mock } {
  return {
    generate: jest.fn(async () => 'https://cdn/cutouts/dog-1-2.png'),
    verify: jest.fn(async () => 'transparent' as const),
    ...overrides,
  } as DogCutoutJobDeps & { generate: jest.Mock; verify: jest.Mock };
}

describe('explicit dog background-removal job (retry flow)', () => {
  it('reports success only after the returned cutout passes the Home transparency check', async () => {
    const d = deps({});
    const result = await runDogCutoutJob('dog-1', d);
    expect(result).toEqual({ status: 'ready', cutoutUrl: 'https://cdn/cutouts/dog-1-2.png' });
    expect(d.generate).toHaveBeenCalledWith('dog-1');
    expect(d.verify).toHaveBeenCalledWith('https://cdn/cutouts/dog-1-2.png');
    expect(describeDogCutoutJob(result)).toMatchObject({ tone: 'success', title: 'הרקע הוסר' });
  });

  it('does not claim success when the server returns a cutout that kept the background', async () => {
    const result = await runDogCutoutJob('dog-1', deps({ verify: jest.fn(async () => 'opaque' as const) }));
    expect(result).toEqual({ status: 'not_clean', cutoutUrl: 'https://cdn/cutouts/dog-1-2.png' });
    const feedback = describeDogCutoutJob(result);
    expect(feedback.tone).toBe('error');
    expect(feedback.title).toBe('הרקע לא הוסר בצורה נקייה');
    expect(feedback.message).toContain('הקמע');
    expect(feedback.message).toContain('התמונה המקורית נשמרה');
  });

  it('trusts server verification when the device cannot inspect pixels', async () => {
    const result = await runDogCutoutJob('dog-1', deps({ verify: jest.fn(async () => 'unverifiable' as const) }));
    expect(result.status).toBe('ready');
  });

  it('surfaces server rejection / quota errors without verifying anything', async () => {
    const d = deps({ generate: jest.fn(async () => { throw new DogCutoutError('cutout_not_transparent'); }) });
    const result = await runDogCutoutJob('dog-1', d);
    expect(result.status).toBe('failed');
    expect(d.verify).not.toHaveBeenCalled();
    expect(describeDogCutoutJob(result)).toMatchObject({ tone: 'error', title: 'התמונה המקורית נשמרה' });
    expect(describeDogCutoutJob(result).message).toContain('לא הצלחנו להפריד את הכלב מהרקע');

    const quota = await runDogCutoutJob('dog-1', deps({
      generate: jest.fn(async () => { throw new DogCutoutError('background_removal_quota_exhausted'); }),
    }));
    expect(describeDogCutoutJob(quota).message).toContain('מכסה');
  });
});
