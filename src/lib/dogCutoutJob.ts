import { describeDogCutoutFailure, generateDogPhotoCutout } from './supabase';

/**
 * One explicit background-removal run for the dog's current source photo,
 * with an unambiguous outcome for the person who asked for it.
 *
 * The Edge Function only reports success after the authoritative PNG and
 * geometry checks pass and the new immutable asset is persisted. A second,
 * browser-specific check after persistence could fail too late to preserve
 * the prior asset. Home independently verifies before rendering and fails
 * closed.
 */
export type DogCutoutJobResult =
  | { status: 'ready'; cutoutUrl: string }
  | { status: 'failed'; error: unknown };

export interface DogCutoutJobDeps {
  generate: (dogId: string) => Promise<string>;
}

const defaultDeps: DogCutoutJobDeps = { generate: generateDogPhotoCutout };

const jobsInFlight = new Map<string, Promise<DogCutoutJobResult>>();

export function runDogCutoutJob(dogId: string, deps: DogCutoutJobDeps = defaultDeps): Promise<DogCutoutJobResult> {
  const running = jobsInFlight.get(dogId);
  if (running) return running;
  const job = (async (): Promise<DogCutoutJobResult> => {
    try {
      return { status: 'ready', cutoutUrl: await deps.generate(dogId) };
    } catch (error) {
      return { status: 'failed', error };
    } finally {
      jobsInFlight.delete(dogId);
    }
  })();
  jobsInFlight.set(dogId, job);
  return job;
}

export interface DogCutoutFeedback {
  tone: 'success' | 'error';
  title: string;
  message: string;
}

/** Hebrew feedback for a finished job. The original photo is always kept. */
export function describeDogCutoutJob(result: DogCutoutJobResult): DogCutoutFeedback {
  switch (result.status) {
    case 'ready':
      return {
        tone: 'success',
        title: 'הרקע הוסר',
        message: 'הכלב מוצג עכשיו במסך הבית על רקע הסצנה שבחרתם.',
      };
    default:
      return { tone: 'error', title: 'התמונה המקורית נשמרה', message: describeDogCutoutFailure(result.error) };
  }
}
