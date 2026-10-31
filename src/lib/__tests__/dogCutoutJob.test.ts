import { describeDogCutoutJob, runDogCutoutJob, type DogCutoutJobDeps } from '../dogCutoutJob';
import { DogCutoutError } from '../supabase';

function deps(overrides: Partial<DogCutoutJobDeps>): DogCutoutJobDeps & { generate: jest.Mock } {
  return {
    generate: jest.fn(async () => 'https://cdn/cutouts/dog-1-2.png'),
    ...overrides,
  } as DogCutoutJobDeps & { generate: jest.Mock };
}

describe('explicit dog background-removal job (retry flow)', () => {
  it('reports success only after the server returns its verified, persisted URL', async () => {
    const d = deps({});
    const result = await runDogCutoutJob('dog-1', d);
    expect(result).toEqual({ status: 'ready', cutoutUrl: 'https://cdn/cutouts/dog-1-2.png' });
    expect(d.generate).toHaveBeenCalledWith('dog-1');
    expect(describeDogCutoutJob(result)).toMatchObject({ tone: 'success', title: 'הרקע הוסר' });
  });

  it('deduplicates retry requests for the same dog while a provider job is running', async () => {
    let release!: (url: string) => void;
    const d = deps({ generate: jest.fn(() => new Promise<string>((resolve) => { release = resolve; })) });
    const first = runDogCutoutJob('dog-shared-lock-test', d);
    const second = runDogCutoutJob('dog-shared-lock-test', deps({}));
    expect(d.generate).toHaveBeenCalledTimes(1);
    release('https://cdn/cutouts/new.png');
    await expect(Promise.all([first, second])).resolves.toEqual([
      { status: 'ready', cutoutUrl: 'https://cdn/cutouts/new.png' },
      { status: 'ready', cutoutUrl: 'https://cdn/cutouts/new.png' },
    ]);
  });

  it('surfaces server rejection / quota errors without verifying anything', async () => {
    const d = deps({ generate: jest.fn(async () => { throw new DogCutoutError('cutout_not_transparent'); }) });
    const result = await runDogCutoutJob('dog-1', d);
    expect(result.status).toBe('failed');
    expect(describeDogCutoutJob(result)).toMatchObject({ tone: 'error', title: 'התמונה המקורית נשמרה' });
    expect(describeDogCutoutJob(result).message).toContain('לא הצלחנו להפריד את הכלב מהרקע');

    const quota = await runDogCutoutJob('dog-1', deps({
      generate: jest.fn(async () => { throw new DogCutoutError('background_removal_quota_exhausted'); }),
    }));
    expect(describeDogCutoutJob(quota).message).toContain('מכסה');
  });
});
