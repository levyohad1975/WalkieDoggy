import type { MascotState } from '../components/WalkieMascot';

export type CelebrationCategory = 'thanks' | 'playful' | 'achievement' | 'night' | 'surprise';
export type CelebrationRarity = 'common' | 'uncommon' | 'rare';

/** Metadata only. A future path may refer to Supabase Storage; never binary media in application data. */
export interface CelebrationAssetReference { provider: 'local' | 'supabase-storage'; path: string; variant: string; reducedMotionPath: string; }
export interface CelebrationDefinition {
  id: string; category: CelebrationCategory; rarity: CelebrationRarity; eyebrow: string; title: string; message: string;
  accent: string; confetti: boolean; mascotState: MascotState; timeOfDay?: 'night'; minimumWalkDuration?: number;
  rewardTeaser?: string; asset: CelebrationAssetReference;
}
export interface CelebrationSelectionInput { completedAt?: Date; durationMinutes?: number; recentIds?: string[]; random?: () => number; }
export interface CompletionCelebration extends CelebrationDefinition { reaction: string; }

const asset = (variant: string): CelebrationAssetReference => ({
  provider: 'local',
  // The shipped branded fallback is the only approved raster today. Future
  // curated variants can swap this path (or provider) independently of data logic.
  path: 'assets/branding/walkie-doggy-mascot.png',
  variant,
  reducedMotionPath: 'assets/branding/walkie-doggy-mascot.png',
});

/** Pre-generated-library metadata. Local slots can later be replaced with curated files or Supabase Storage references. */
export const CELEBRATION_LIBRARY: CelebrationDefinition[] = [
  { id: 'thank-you-heart', category: 'thanks', rarity: 'common', eyebrow: 'הטיול הושלם', title: 'תודה על הטיול! ♥', message: 'איזה כיף לחזור הביתה יחד.', accent: '♥', confetti: false, mascotState: 'success', asset: asset('thank-you-heart') },
  { id: 'happy-jump', category: 'playful', rarity: 'common', eyebrow: 'יששש!', title: 'קפיצת שמחה!', message: 'עוד טיול מעולה נכנס ליומן המשפחתי.', accent: '✦', confetti: false, mascotState: 'excited', asset: asset('happy-jump') },
  { id: 'high-five', category: 'thanks', rarity: 'common', eyebrow: 'משימה הושלמה', title: 'כיף! מגיע לך היי־פייב', message: 'עשית עבודה נהדרת.', accent: '✋', confetti: false, mascotState: 'ready', asset: asset('high-five') },
  { id: 'confetti', category: 'playful', rarity: 'uncommon', eyebrow: 'איזה כיף!', title: 'טיול מוצלח במיוחד', message: 'קונפטי קטן, כי רגעים כאלה שווים חגיגה.', accent: '✦', confetti: true, mascotState: 'success', asset: asset('confetti') },
  { id: 'paw-party', category: 'playful', rarity: 'common', eyebrow: 'כפה של תודה', title: 'כף אל כף! 🐾', message: 'כבר מחכים להרפתקה הבאה איתך.', accent: '🐾', confetti: false, mascotState: 'excited', asset: asset('paw-party') },
  { id: 'trophy-teaser', category: 'achievement', rarity: 'uncommon', eyebrow: 'רמז קטן להמשך', title: 'עוד טיול לאוסף המשפחתי', message: 'המשך/י כך — בקרוב יהיו כאן גם הפתעות קטנות.', accent: '🏆', confetti: true, mascotState: 'success', rewardTeaser: 'עוד טיול בדרך להפתעה', asset: asset('trophy-teaser') },
  { id: 'sleepy-good-night', category: 'night', rarity: 'common', eyebrow: 'טיול לילה הושלם', title: 'לילה טוב 🌙', message: 'תודה על הסיבוב האחרון להיום. עכשיו זמן למנוחה נעימה.', accent: '☾', confetti: false, mascotState: 'idle', timeOfDay: 'night', asset: asset('sleepy-good-night') },
  { id: 'long-walk', category: 'achievement', rarity: 'uncommon', eyebrow: 'וואו, איזה סיבוב!', title: 'טיול ארוך במיוחד', message: 'איזו השקעה — זה בהחלט ראוי לחגיגה.', accent: '★', confetti: true, mascotState: 'success', minimumWalkDuration: 45, rewardTeaser: 'רמז: הטיולים הארוכים נספרים', asset: asset('long-walk') },
  { id: 'special-surprise', category: 'surprise', rarity: 'rare', eyebrow: 'הפתעה קטנה', title: 'היום את/ה כוכב/ת!', message: 'רגע נדיר של שמחה במיוחד בשבילך.', accent: '✧', confetti: true, mascotState: 'excited', asset: asset('special-surprise') },
];

function isNight(date: Date) { const hour = date.getHours(); return hour >= 21 || hour < 6; }

/** Deterministic when `random` is supplied; excludes recent repeats when alternatives exist. */
export function selectWalkCompletionCelebration(input: CelebrationSelectionInput = {}): CompletionCelebration {
  const completedAt = input.completedAt ?? new Date();
  const random = input.random ?? Math.random;
  const recentIds = new Set(input.recentIds ?? []);
  const night = isNight(completedAt) ? CELEBRATION_LIBRARY.filter((item) => item.timeOfDay === 'night') : [];
  const durationMinutes = input.durationMinutes;
  const longWalk = durationMinutes ? CELEBRATION_LIBRARY.filter((item) => item.minimumWalkDuration && durationMinutes >= item.minimumWalkDuration) : [];
  const base = [...night, ...longWalk];
  const contextual = base.length ? base : CELEBRATION_LIBRARY.filter((item) => !item.timeOfDay && !item.minimumWalkDuration);
  const withoutRecent = contextual.filter((item) => !recentIds.has(item.id));
  const pool = withoutRecent.length ? withoutRecent : contextual;
  const nonRare = pool.filter((item) => item.rarity !== 'rare');
  const candidates = random() < 0.08 ? pool : (nonRare.length ? nonRare : pool);
  const selected = candidates[Math.min(candidates.length - 1, Math.floor(random() * candidates.length))];
  return { ...selected, reaction: selected.id };
}
