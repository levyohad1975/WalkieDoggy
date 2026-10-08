export type ReminderStage = 'pre-walk' | 'due' | 'late-15' | 'late-30';
export type ReminderAnimationId = 'happy-jump' | 'high-five' | 'thank-you-heart' | 'trophy' | 'sleepy-good-night' | 'leash-ready' | 'playful-wait' | 'trophy-lift' | 'paw-wave';

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
  { id: 'pre-paw-wave', stage: 'pre-walk', animationId: 'paw-wave', title: 'היי, הגיע הזמן', message: 'אני כאן ומוכן — עוד מעט יוצאים לטיול!' },
  { id: 'due-high-five', stage: 'due', animationId: 'high-five', title: 'הגיע הזמן', message: 'הגיע הזמן לטיול — יוצאים?' },
  { id: 'late15-heart', stage: 'late-15', animationId: 'thank-you-heart', title: 'עדיין מחכה', message: 'אני עדיין מחכה לטיול שלנו…' },
  { id: 'due-trophy', stage: 'due', animationId: 'trophy', title: 'מוכנים למשימה', message: 'זמן לטיול — בואו נעשה את זה!' },
  { id: 'late30-sleepy', stage: 'late-30', animationId: 'sleepy-good-night', title: 'מחכה כבר הרבה זמן', message: 'הטיול מחכה לנו כבר חצי שעה…' },
];

/**
 * Mascot-notification-experiences round — maps the server/push notification
 * stage vocabulary ('T-15' | 'T' | 'T+15' | 'T+30', src/types/index.ts's
 * NotificationKind — the actual `stage` field
 * supabase/functions/send-walk-reminders/index.ts sends) onto this file's
 * own ReminderStage vocabulary, so a real notification tap can select the
 * stage-appropriate animation via selectReminderAnimation() below instead
 * of always falling back to its full, unfiltered pool. T+30 (the
 * responsible member's own copy of the final overdue stage) maps to the
 * same 'late-30' escalation treatment already defined for it.
 */
export function reminderStageForNotificationKind(kind: 'T-15' | 'T' | 'T+15' | 'T+30'): ReminderStage {
  switch (kind) {
    case 'T-15':
      return 'pre-walk';
    case 'T':
      return 'due';
    case 'T+15':
      return 'late-15';
    case 'T+30':
      return 'late-30';
  }
}

export function selectReminderAnimation(stage?: ReminderStage, recentAnimationId?: ReminderAnimationId, random: () => number = Math.random): ReminderAnimationMoment {
  const stagePool = stage ? REMINDER_ANIMATION_LIBRARY.filter((item) => item.stage === stage) : REMINDER_ANIMATION_LIBRARY;
  const freshPool = recentAnimationId ? stagePool.filter((item) => item.animationId !== recentAnimationId) : stagePool;
  const pool = freshPool.length ? freshPool : stagePool;
  return pool[Math.min(pool.length - 1, Math.floor(random() * pool.length))];
}
