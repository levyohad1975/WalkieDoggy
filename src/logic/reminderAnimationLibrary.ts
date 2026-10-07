export type ReminderStage = 'pre-walk' | 'due' | 'late-15' | 'late-30';
export type ReminderAnimationId = 'happy-jump' | 'high-five' | 'thank-you-heart' | 'trophy' | 'sleepy-good-night' | 'leash-ready' | 'playful-wait' | 'trophy-lift';

export interface ReminderAnimationMoment {
  id: string;
  stage: ReminderStage;
  animationId: ReminderAnimationId;
  title: string;
  message: string;
}

export const REMINDER_ANIMATION_LIBRARY: ReminderAnimationMoment[] = [
  { id: 'pre-jump', stage: 'pre-walk', animationId: 'happy-jump', title: 'מתחילים להתרגש', message: 'עוד מעט יוצאים לטיול! 🐾' },
  { id: 'pre-leash-ready', stage: 'pre-walk', animationId: 'leash-ready', title: 'הרצועה מוכנה', message: 'עוד מעט יוצאים — אני כבר מוכן עם הרצועה!' },
  { id: 'late15-playful-wait', stage: 'late-15', animationId: 'playful-wait', title: 'מחכה לך', message: 'אני כאן ומחכה — יוצאים לטיול?' },
  { id: 'due-trophy-lift', stage: 'due', animationId: 'trophy-lift', title: 'יוצאים לנצח', message: 'מוכנים לטיול? אני כבר מוכן!' },
  { id: 'due-high-five', stage: 'due', animationId: 'high-five', title: 'הגיע הזמן', message: 'הגיע הזמן לטיול — יוצאים?' },
  { id: 'late15-heart', stage: 'late-15', animationId: 'thank-you-heart', title: 'עדיין מחכה', message: 'אני עדיין מחכה לטיול שלנו…' },
  { id: 'due-trophy', stage: 'due', animationId: 'trophy', title: 'מוכנים למשימה', message: 'זמן לטיול — בואו נעשה את זה!' },
  { id: 'late30-sleepy', stage: 'late-30', animationId: 'sleepy-good-night', title: 'מחכה כבר הרבה זמן', message: 'הטיול מחכה לנו כבר חצי שעה…' },
];

export function selectReminderAnimation(stage?: ReminderStage, recentAnimationId?: ReminderAnimationId, random: () => number = Math.random): ReminderAnimationMoment {
  const stagePool = stage ? REMINDER_ANIMATION_LIBRARY.filter((item) => item.stage === stage) : REMINDER_ANIMATION_LIBRARY;
  const freshPool = recentAnimationId ? stagePool.filter((item) => item.animationId !== recentAnimationId) : stagePool;
  const pool = freshPool.length ? freshPool : stagePool;
  return pool[Math.min(pool.length - 1, Math.floor(random() * pool.length))];
}
