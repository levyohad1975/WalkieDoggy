export type ReminderStage = 'pre-walk' | 'due' | 'late-15' | 'late-30';
export type ReminderAnimationId = 'happy-jump' | 'high-five' | 'thank-you-heart' | 'trophy' | 'sleepy-good-night';

export interface ReminderAnimationMoment {
  id: string;
  stage: ReminderStage;
  animationId: ReminderAnimationId;
  title: string;
  message: string;
}

/**
 * Real V2 reminder moments. The same motion can serve more than one timing
 * context, but a stage always has multiple choices so repeated reminders do
 * not feel mechanically identical. Selection excludes the previous motion
 * whenever another option is available.
 */
export const REMINDER_ANIMATION_LIBRARY: ReminderAnimationMoment[] = [
  { id: 'pre-jump', stage: 'pre-walk', animationId: 'happy-jump', title: 'מתחילים להתרגש', message: 'עוד מעט יוצאים לטיול! 🐾' },
  { id: 'pre-high-five', stage: 'pre-walk', animationId: 'high-five', title: 'מוכנים לצאת', message: 'הטיול מתקרב — אני כבר מוכן!' },
  { id: 'pre-heart', stage: 'pre-walk', animationId: 'thank-you-heart', title: 'מחכה לך', message: 'עוד מעט זמן לטיול שלנו ♥' },

  { id: 'due-high-five', stage: 'due', animationId: 'high-five', title: 'הגיע הזמן', message: 'הגיע הזמן לטיול — יוצאים?' },
  { id: 'due-jump', stage: 'due', animationId: 'happy-jump', title: 'יאללה לטיול', message: 'הגיע הזמן! אני כבר מתרגש 🐾' },
  { id: 'due-trophy', stage: 'due', animationId: 'trophy', title: 'מוכנים למשימה', message: 'זמן לטיול — בואו נעשה את זה!' },

  { id: 'late15-heart', stage: 'late-15', animationId: 'thank-you-heart', title: 'עדיין מחכה', message: 'אני עדיין מחכה לטיול שלנו…' },
  { id: 'late15-trophy', stage: 'late-15', animationId: 'trophy', title: 'לא שכחנו?', message: 'עברו כמה דקות — יוצאים לטיול?' },
  { id: 'late15-high-five', stage: 'late-15', animationId: 'high-five', title: 'כמעט יוצאים', message: 'אני מוכן. נשאר רק לצאת!' },

  { id: 'late30-sleepy', stage: 'late-30', animationId: 'sleepy-good-night', title: 'מחכה כבר הרבה זמן', message: 'הטיול מחכה לנו כבר חצי שעה…' },
  { id: 'late30-heart', stage: 'late-30', animationId: 'thank-you-heart', title: 'תזכורת נוספת', message: 'אפשר לצאת עכשיו לטיול? ♥' },
  { id: 'late30-trophy', stage: 'late-30', animationId: 'trophy', title: 'עוד לא יצאנו', message: 'הגיע הזמן להשלים את הטיול 🐾' },
];

export function selectReminderAnimation(stage: ReminderStage, recentAnimationId?: ReminderAnimationId, random: () => number = Math.random): ReminderAnimationMoment {
  const stagePool = REMINDER_ANIMATION_LIBRARY.filter((item) => item.stage === stage);
  const freshPool = recentAnimationId ? stagePool.filter((item) => item.animationId !== recentAnimationId) : stagePool;
  const pool = freshPool.length ? freshPool : stagePool;
  return pool[Math.min(pool.length - 1, Math.floor(random() * pool.length))];
}
