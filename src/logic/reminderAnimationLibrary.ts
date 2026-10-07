export type ReminderStage = 'pre-walk' | 'due' | 'late-15' | 'late-30';
export type ReminderAnimationId = 'happy-jump' | 'high-five' | 'thank-you-heart' | 'trophy' | 'sleepy-good-night' | 'leash-ready' | 'tail-wag' | 'curious-listen' | 'trophy-winner' | 'happy-spin';

export interface ReminderAnimationMoment {
  id: string;
  stage: ReminderStage;
  animationId: ReminderAnimationId;
  title: string;
  message: string;
}

/**
 * Real V2 reminder moments. Each visible lab entry is intentionally unique:
 * do not multiply copy variants that replay the same animation and make the
 * library look larger than its actual motion inventory. Selection excludes
 * the previous motion whenever another option is available.
 */
export const REMINDER_ANIMATION_LIBRARY: ReminderAnimationMoment[] = [
  { id: 'pre-jump', stage: 'pre-walk', animationId: 'happy-jump', title: 'מתחילים להתרגש', message: 'עוד מעט יוצאים לטיול! 🐾' },
  { id: 'due-high-five', stage: 'due', animationId: 'high-five', title: 'הגיע הזמן', message: 'הגיע הזמן לטיול — יוצאים?' },
  { id: 'late15-heart', stage: 'late-15', animationId: 'thank-you-heart', title: 'עדיין מחכה', message: 'אני עדיין מחכה לטיול שלנו…' },
  { id: 'due-trophy', stage: 'due', animationId: 'trophy', title: 'מוכנים למשימה', message: 'זמן לטיול — בואו נעשה את זה!' },
  { id: 'late30-sleepy', stage: 'late-30', animationId: 'sleepy-good-night', title: 'מחכה כבר הרבה זמן', message: 'הטיול מחכה לנו כבר חצי שעה…' },
  { id: 'pre-leash', stage: 'pre-walk', animationId: 'leash-ready', title: 'הרצועה כבר מוכנה', message: 'הרצועה בפה — עוד מעט יוצאים! 🐾' },
  { id: 'pre-tail', stage: 'pre-walk', animationId: 'tail-wag', title: 'הזנב כבר עובד', message: 'יש לי הרגשה שמתקרב טיול…' },
  { id: 'pre-listen', stage: 'pre-walk', animationId: 'curious-listen', title: 'שמעתי טיול?', message: 'אמרתם טיול? אני מקשיב!' },
  { id: 'due-spin', stage: 'due', animationId: 'happy-spin', title: 'יוצאים!', message: 'הגיע הזמן — אני כבר מתרגש!' },
  { id: 'late30-trophy-winner', stage: 'late-30', animationId: 'trophy-winner', title: 'הגביע מחכה', message: 'בואו נסיים את המשימה כמו אלופים!' },
];

export function selectReminderAnimation(stage?: ReminderStage, recentAnimationId?: ReminderAnimationId, random: () => number = Math.random): ReminderAnimationMoment {
  const stagePool = stage ? REMINDER_ANIMATION_LIBRARY.filter((item) => item.stage === stage) : REMINDER_ANIMATION_LIBRARY;
  const freshPool = recentAnimationId ? stagePool.filter((item) => item.animationId !== recentAnimationId) : stagePool;
  const pool = freshPool.length ? freshPool : stagePool;
  return pool[Math.min(pool.length - 1, Math.floor(random() * pool.length))];
}
