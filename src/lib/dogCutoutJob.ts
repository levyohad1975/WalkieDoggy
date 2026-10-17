import { describeDogCutoutFailure, generateDogPhotoCutout } from './supabase';
import { verifyCutoutTransparency } from './cutoutVerification';

/**
 * One explicit background-removal run for the dog's current source photo,
 * with an unambiguous outcome for the person who asked for it.
 *
 * The Edge Function reporting success is not enough: a cutout that still
 * carries the photo's background is never composited on Home (the hero
 * shows the mascot instead), so telling the family "done" would contradict
 * what they see. The returned cutout is therefore checked with the same
 * transparency rules Home uses before the outcome is reported.
 */
export type DogCutoutJobResult =
  | { status: 'ready'; cutoutUrl: string }
  | { status: 'not_clean'; cutoutUrl: string }
  | { status: 'failed'; error: unknown };

export interface DogCutoutJobDeps {
  generate: (dogId: string) => Promise<string>;
  verify: (url: string) => Promise<'transparent' | 'opaque' | 'unverifiable'>;
}

const defaultDeps: DogCutoutJobDeps = {
  generate: generateDogPhotoCutout,
  verify: (url) => verifyCutoutTransparency(url),
};

export async function runDogCutoutJob(dogId: string, deps: DogCutoutJobDeps = defaultDeps): Promise<DogCutoutJobResult> {
  let cutoutUrl: string;
  try {
    cutoutUrl = await deps.generate(dogId);
  } catch (error) {
    return { status: 'failed', error };
  }
  // `unverifiable` (no canvas / network hiccup) falls back to the server's
  // own verification, exactly as the Home hero does.
  const verdict = await deps.verify(cutoutUrl);
  return verdict === 'opaque' ? { status: 'not_clean', cutoutUrl } : { status: 'ready', cutoutUrl };
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
    case 'not_clean':
      return {
        tone: 'error',
        title: 'הרקע לא הוסר בצורה נקייה',
        message: 'בתמונה הזו נשאר חלק מהרקע המקורי, ולכן במסך הבית ממשיך להופיע הקמע. התמונה המקורית נשמרה — אפשר לנסות שוב או לבחור תמונה שבה הכלב בולט יותר על הרקע.',
      };
    default:
      return { tone: 'error', title: 'התמונה המקורית נשמרה', message: describeDogCutoutFailure(result.error) };
  }
}
