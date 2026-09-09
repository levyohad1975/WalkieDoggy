export type WalkCompletionReaction = 'heart' | 'jump' | 'highFive' | 'confetti' | 'paw' | 'sleepy' | 'trophy';

export interface CompletionCelebration {
  reaction: WalkCompletionReaction;
  eyebrow: string;
  title: string;
  message: string;
  accent: string;
  confetti: boolean;
}

const REACTIONS: Record<Exclude<WalkCompletionReaction, 'sleepy'>, Omit<CompletionCelebration, 'reaction'>> = {
  heart: { eyebrow: 'הטיול הושלם', title: 'תודה על הטיול! ♥', message: 'טופי שולח/ת חיבוק גדול על הזמן יחד.', accent: '♥', confetti: false },
  jump: { eyebrow: 'יששש!', title: 'קפיצת שמחה של טופי', message: 'עוד טיול מעולה נכנס ליומן המשפחתי.', accent: '✦', confetti: false },
  highFive: { eyebrow: 'משימה הושלמה', title: 'כיף! מגיע לך היי־פייב', message: 'טופי אומר/ת: עשית עבודה נהדרת.', accent: '✋', confetti: false },
  confetti: { eyebrow: 'איזה כיף!', title: 'טיול מוצלח במיוחד', message: 'קונפטי קטן, כי רגעים כאלה שווים חגיגה.', accent: '✦', confetti: true },
  paw: { eyebrow: 'כפה של תודה', title: 'כף אל כף! 🐾', message: 'טופי כבר מחכה להרפתקה הבאה איתך.', accent: '🐾', confetti: false },
  trophy: { eyebrow: 'רמז קטן להמשך', title: 'עוד טיול לאוסף המשפחתי', message: 'המשך/י כך — בקרוב יהיו כאן גם הפתעות קטנות.', accent: '🏆', confetti: true },
};

const SLEEPY: Omit<CompletionCelebration, 'reaction'> = {
  eyebrow: 'טיול לילה הושלם', title: 'לילה טוב מטופי 🌙', message: 'תודה על הסיבוב האחרון להיום. עכשיו זמן למנוחה נעימה.', accent: '☾', confetti: false,
};

/** UI-only and deterministic when a `random` function is supplied for tests. */
export function selectWalkCompletionCelebration(date = new Date(), random = Math.random): CompletionCelebration {
  const hour = date.getHours();
  if (hour >= 21 || hour < 6) return { reaction: 'sleepy', ...SLEEPY };
  const reactions = Object.keys(REACTIONS) as Array<Exclude<WalkCompletionReaction, 'sleepy'>>;
  const reaction = reactions[Math.min(reactions.length - 1, Math.floor(random() * reactions.length))];
  return { reaction, ...REACTIONS[reaction] };
}
