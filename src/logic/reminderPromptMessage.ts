import type { NotificationKind } from '../types';

/**
 * In-app mascot speech-bubble copy for a tapped walk-reminder notification.
 *
 * Real-iPhone QA: Home used one hardcoded "הגיע הזמן לטייל" sentence for
 * every stage, so a T-15 reminder tapped at 18:25 for an 18:40 walk told
 * the family it was already time to go. The copy is now chosen from the
 * notification's own stage AND the walk's real scheduled time, so a T-15
 * tap says how long is actually left ("מתחיל בעוד 15 דקות") and never
 * claims the walk is due before it is.
 *
 * Templates use messageEngine's renderMessageTemplate placeholders
 * ({responsibleName}, {dogNoun}); every verb here is identical for a male
 * and a female dog, so no gendered variants are needed.
 */
export const REMINDER_PROMPT_DUE_TEMPLATE = '{responsibleName}, הגיע הזמן לטייל עם {dogNoun} 🐾';

function minutesPhrase(minutes: number): string {
  return minutes === 1 ? 'בעוד דקה' : `בעוד ${minutes} דקות`;
}

/** Whole minutes until the walk's scheduled start, rounded up; null when the date/time can't be parsed. */
export function minutesUntilWalk(walkDate: string, scheduledTime: string, now: Date): number | null {
  // Validate the shape first: JS engines' lenient legacy date parsing turns
  // some garbage strings into a real (wrong) date instead of NaN.
  if (!/^\d{4}-\d{2}-\d{2}$/.test(walkDate) || !/^\d{2}:\d{2}$/.test(scheduledTime)) return null;
  const scheduledAt = new Date(`${walkDate}T${scheduledTime}:00`).getTime();
  if (!Number.isFinite(scheduledAt)) return null;
  return Math.ceil((scheduledAt - now.getTime()) / 60000);
}

export function reminderPromptTemplate(
  kind: NotificationKind,
  walkDate: string,
  scheduledTime: string,
  now: Date = new Date()
): string {
  if (kind === 'T-15') {
    const minutes = minutesUntilWalk(walkDate, scheduledTime, now);
    // Unparseable time: trust the stage itself rather than guess.
    if (minutes === null) return '{responsibleName}, הטיול עם {dogNoun} מתחיל בעוד 15 דקות 🐾';
    // A T-15 notification tapped late (after the walk's start time) is a
    // "due" moment by then — never "starts in 15 minutes".
    if (minutes <= 0) return REMINDER_PROMPT_DUE_TEMPLATE;
    return `{responsibleName}, הטיול עם {dogNoun} מתחיל ${minutesPhrase(minutes)} 🐾`;
  }
  if (kind === 'T') return REMINDER_PROMPT_DUE_TEMPLATE;
  if (kind === 'T+15') return '{responsibleName}, {dogNoun} עדיין מחכה לטיול 🐾';
  return '{responsibleName}, הטיול עם {dogNoun} מחכה כבר חצי שעה';
}
