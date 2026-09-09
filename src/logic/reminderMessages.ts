/**
 * Message generation for the server-side walk reminder scheduler (Batch 2).
 * Pure, framework-agnostic, unit-tested — this is the CANONICAL copy.
 * supabase/functions/send-walk-reminders/index.ts keeps an inlined copy
 * (Deno can't import an RN-project file at deploy time — same limitation
 * documented in supabase/functions/send-request-push/index.ts for
 * src/logic/pushRouting.ts). Keep both in sync if this ever changes.
 *
 * Requirements covered here (Batch 2 requirement 6): dynamic dog name,
 * dynamic dog sex with a neutral fallback when unknown, multiple possible
 * phrases per stage (so reminders don't read as robotic/identical every
 * time), and increasing urgency by stage.
 *
 * HEBREW GRAMMAR NOTE: this codebase's existing convention for a
 * gender-unknown HUMAN is a literal "אחראי/ת" slash form (see
 * supabase/functions/send-request-push/index.ts's Hebrew templates) — reused
 * here unchanged for the responsible member. For the DOG's sex (new in this
 * batch — see migrations/0022_family_timezone_and_dog_sex.sql), the same
 * slash-form idiom is used for the one verb whose spelling actually differs
 * by gender without niqqud (יצא/יצאה — "went out"); when sex is known, the
 * single correct form is used instead. When sex is unknown, phrasing
 * deliberately prefers the dog's bare name (ungendered) over "הכלב"/"הכלבה"
 * so as never to guess.
 */

import type { Dog } from '../types';

export type ReminderStage = 'T-15' | 'T' | 'T+15' | 'T+30';

/**
 * Fixed, deliberately short list — exactly the four stages Decision 5
 * approves. There is no code path anywhere that appends a fifth stage;
 * REMINDER_STAGES is the single source of truth every caller (client and
 * the inlined Edge Function copy) iterates, so "no endless reminders after
 * T+30" holds by construction, not by convention.
 */
export const REMINDER_STAGES: ReminderStage[] = ['T-15', 'T', 'T+15', 'T+30'];

export const REMINDER_STAGE_OFFSET_MINUTES: Record<ReminderStage, number> = {
  'T-15': -15,
  T: 0,
  'T+15': 15,
  'T+30': 30,
};

/** Monotonically increasing with stage — for any future UI that wants to visually escalate. Purely a documentation/testing aid; not consulted by the sender. */
export function reminderUrgencyLevel(stage: ReminderStage): 1 | 2 | 3 | 4 {
  switch (stage) {
    case 'T-15':
      return 1;
    case 'T':
      return 2;
    case 'T+15':
      return 3;
    case 'T+30':
      return 4;
  }
}

export interface ReminderMessageInput {
  stage: ReminderStage;
  dogName: string;
  dogSex?: Dog['sex'] | null;
  responsibleName: string;
  /** "HH:mm", in the family's authoritative timezone (see families.timezone). */
  scheduledTime: string;
  /**
   * Picks a stable variant among this stage's phrase pool — same input
   * always picks the same phrase (so retries/re-renders don't flicker
   * between wordings), different walks naturally vary. Not a security
   * value; any stable string works — callers pass the walk id.
   */
  varietySeed: string;
}

export interface ReminderMessage {
  title: string;
  body: string;
}

function stableIndex(seed: string, length: number): number {
  let h = 0;
  for (let i = 0; i < seed.length; i += 1) {
    h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  }
  return h % length;
}

function pick<T>(items: T[], seed: string): T {
  return items[stableIndex(seed, items.length)];
}

/**
 * "הכלב X" / "הכלבה X" / just "X" when sex is unknown — see this file's
 * header note on never guessing. Exported (Batch 4) so the mascot message
 * engine (src/mascot/messageEngine.ts) reuses this exact, already-correct
 * gendering logic instead of re-implementing it — one source of truth for
 * "how do we phrase this dog's sex in Hebrew copy" across push-notification
 * text and in-app mascot copy.
 */
export function dogNoun(dogName: string, dogSex: Dog['sex'] | null | undefined): string {
  if (dogSex === 'male') return `הכלב ${dogName}`;
  if (dogSex === 'female') return `הכלבה ${dogName}`;
  return dogName;
}

/** "יצא" (m) / "יצאה" (f) / "יצא/ה" (unknown) — see this file's header note. Exported for reuse by the mascot message engine (Batch 4). */
export function wentOutForm(dogSex: Dog['sex'] | null | undefined): string {
  if (dogSex === 'male') return 'יצא';
  if (dogSex === 'female') return 'יצאה';
  return 'יצא/ה';
}

export function buildWalkReminderMessage(input: ReminderMessageInput): ReminderMessage {
  const { stage, dogName, dogSex, responsibleName, scheduledTime, varietySeed } = input;
  const noun = dogNoun(dogName, dogSex);
  const seed = `${varietySeed}:${stage}`;

  if (stage === 'T-15') {
    const variants: ReminderMessage[] = [
      {
        title: `🐶 עוד 15 דקות לטיול של ${dogName}`,
        body: `${responsibleName} אחראי/ת על הטיול בשעה ${scheduledTime}`,
      },
      {
        title: '⏰ טיול בקרוב',
        body: `בעוד 15 דקות הגיע הזמן לטייל את ${dogName} — ${responsibleName} אחראי/ת`,
      },
    ];
    return pick(variants, seed);
  }

  if (stage === 'T') {
    const variants: ReminderMessage[] = [
      {
        title: '🐾 הגיע הזמן לטיול!',
        body: `${noun} מחכה לטיול עכשיו — ${responsibleName} אחראי/ת`,
      },
      {
        title: `🐾 זמן לטייל את ${dogName}`,
        body: `השעה ${scheduledTime} הגיעה — ${responsibleName} אחראי/ת על הטיול`,
      },
    ];
    return pick(variants, seed);
  }

  if (stage === 'T+15') {
    const variants: ReminderMessage[] = [
      {
        title: '⏰ הטיול עדיין לא סומן כבוצע',
        body: `${noun} עדיין מחכה — הטיול משעה ${scheduledTime} טרם סומן. ${responsibleName} אחראי/ת`,
      },
      {
        title: `⏰ ${dogName} עדיין מחכה לטיול`,
        body: `הטיול משעה ${scheduledTime} עדיין ממתין — ${responsibleName} אחראי/ת. אפשר לסמן כבוצע באפליקציה`,
      },
    ];
    return pick(variants, seed);
  }

  // T+30 — the responsible member's own copy of the reminder (the separate
  // admin-escalation message is buildWalkAttentionEscalationMessage below).
  const variants: ReminderMessage[] = [
    {
      title: '🚨 הטיול דורש תשומת לב',
      body: `${noun} עדיין לא ${wentOutForm(dogSex)} לטיול משעה ${scheduledTime} — ${responsibleName} אחראי/ת`,
    },
    {
      title: '🚨 טיול באיחור משמעותי',
      body: `הטיול של ${dogName} משעה ${scheduledTime} עדיין לא סומן כבוצע — ${responsibleName} אחראי/ת`,
    },
  ];
  return pick(variants, seed);
}

/**
 * T+30 escalation to Family Admin(s) — Decision 5's "also escalate to
 * Family Admin". Deliberately a separate function/message (not a reuse of
 * buildWalkReminderMessage's T+30 output): this copy is framed as a status
 * report to someone who is NOT the responsible member, not as an
 * instruction to them.
 */
export function buildWalkAttentionEscalationMessage(
  input: Omit<ReminderMessageInput, 'stage'>
): ReminderMessage {
  const { dogName, responsibleName, scheduledTime, varietySeed } = input;
  const seed = `${varietySeed}:T+30:escalation`;
  const variants: ReminderMessage[] = [
    {
      title: '🚨 טיול דורש תשומת לב',
      body: `הטיול של ${dogName} משעה ${scheduledTime}, באחריות ${responsibleName}, עדיין לא בוצע`,
    },
    {
      title: '🚨 עדכון למשפחה',
      body: `${dogName} עדיין לא יצא/ה לטיול (${scheduledTime}) — ${responsibleName} היה/תה אחראי/ת`,
    },
  ];
  return pick(variants, seed);
}

