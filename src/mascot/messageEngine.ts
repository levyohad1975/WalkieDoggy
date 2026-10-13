/**
 * Selection + template-substitution engine for the Walkie Doggy mascot
 * message library (Batch 4, C5/C6). Pure, framework-agnostic, directly
 * unit-testable (see __tests__/messageEngine.test.ts) — no React Native
 * import here, matching this repo's existing "logic" modules convention
 * (src/logic/reminderMessages.ts, src/logic/walkActions.ts, ...).
 */

import type { Dog } from '../types';
import { dogNoun } from '../logic/reminderMessages';
import { MESSAGE_LIBRARY, type GenderedText, type MessageCategory, type MessageTemplate } from './messageLibrary';
import { DEFAULT_PERSONALITY_PRESET, type PersonalityPreset } from './personalityPresets';

export interface MessageContext {
  dogName?: string | null;
  dogSex?: Dog['sex'] | null;
  responsibleName?: string | null;
  /** "HH:mm" */
  scheduledTime?: string | null;
  /** "HH:mm" */
  completionTime?: string | null;
}

export interface SelectedMessage {
  /** The template id that was chosen — stable, useful for tests/telemetry, never shown to the user. */
  id: string;
  text: string;
}

/**
 * BATCH 4 CORRECTION #1 (item 2). Picks the natural, independently-written
 * branch for the dog's actual sex — never a mechanical slash-form. Anything
 * other than exactly 'male'/'female' (missing, null, or an unrecognized
 * value) gets `neutral`, which messageLibrary.ts's authors wrote as a real,
 * grammatical sentence on its own — never the male or female text with the
 * gendered ending simply removed.
 */
function resolveGenderedText(text: string | GenderedText, dogSex: Dog['sex'] | null | undefined): string {
  if (typeof text === 'string') return text;
  if (dogSex === 'male') return text.male;
  if (dogSex === 'female') return text.female;
  return text.neutral;
}

/**
 * C5 — safe fallbacks. A template referencing a variable the caller didn't
 * supply must never render broken text (a literal "undefined", or a
 * dangling gap) — every placeholder always resolves to *something*
 * grammatical, even with an empty MessageContext.
 *
 * BATCH 4 CORRECTION #1 (item 2): `template` may be a plain string or a
 * `GenderedText` — see resolveGenderedText above. The `{wentOut}` token this
 * function used to also substitute (reusing reminderMessages.ts's
 * wentOutForm()) has been removed: a bare Hebrew past-tense verb has no
 * natural gender-neutral single-word form, so a standalone token for it
 * could only ever produce a slash form ("יצא/ה") for the unknown-sex case —
 * exactly the defect this correction removes. It was never actually used in
 * any shipped message text (see messageLibrary.ts's doc comment).
 */
function renderMessageTemplate(template: string | GenderedText, ctx: MessageContext): string {
  const resolved = resolveGenderedText(template, ctx.dogSex ?? null);
  const hasDogName = Boolean(ctx.dogName?.trim());
  // BATCH 4 CORRECTION #1 (item 2): this fallback is itself substituted
  // directly into rendered mascot text (via {dogName}) whenever the caller
  // doesn't yet know the dog's name — so it must be real, slash-free Hebrew
  // too, not just the male/female/neutral branches above.
  const dogName = ctx.dogName?.trim() || 'הכלב או הכלבה שלכם';
  const responsibleName = ctx.responsibleName?.trim() || 'מישהו מהמשפחה';
  const scheduledTime = ctx.scheduledTime?.trim() || 'השעה הקרובה';
  const completionTime = ctx.completionTime?.trim() || 'עכשיו';
  // {dogNoun} is only meaningful when there's a real NAME to attach a
  // gendered "הכלב"/"הכלבה" prefix to — dogNoun('הכלב או הכלבה שלכם', 'male')
  // would otherwise double up into "הכלב הכלב או הכלבה שלכם". Without a real
  // name, {dogNoun} just falls back to the same already-natural fallback
  // phrase directly, unprefixed.
  const dogNounText = hasDogName ? dogNoun(dogName, ctx.dogSex ?? null) : dogName;

  return resolved
    .replace(/\{dogNoun\}/g, dogNounText)
    .replace(/\{dogName\}/g, dogName)
    .replace(/\{responsibleName\}/g, responsibleName)
    .replace(/\{scheduledTime\}/g, scheduledTime)
    .replace(/\{completionTime\}/g, completionTime);
}

/** Exported for direct testing of the male/female/unknown Hebrew grammar paths without going through selectMessage()'s randomness. */
export { renderMessageTemplate };

// ---------------------------------------------------------------------------
// C6 — anti-repetition
// ---------------------------------------------------------------------------

export interface AntiRepetitionHistory {
  recentIds(category: MessageCategory): string[];
  record(category: MessageCategory, id: string, windowSize: number): void;
}

/**
 * Simple in-memory, per-category recency window. Deliberately NOT persisted
 * across app restarts (AsyncStorage) — v1 scope is "don't repeat within the
 * current session", which is what actually matters for "the same few
 * messages keep showing again and again" during one sitting. A future
 * revision could persist this without changing selectMessage()'s shape.
 */
class InMemoryAntiRepetitionHistory implements AntiRepetitionHistory {
  private byCategory = new Map<MessageCategory, string[]>();

  recentIds(category: MessageCategory): string[] {
    return this.byCategory.get(category) ?? [];
  }

  record(category: MessageCategory, id: string, windowSize: number): void {
    const existing = this.byCategory.get(category) ?? [];
    this.byCategory.set(category, [id, ...existing.filter((x) => x !== id)].slice(0, windowSize));
  }
}

/** The module-level history real screens use. Tests should construct their own `new InMemoryAntiRepetitionHistory()`-shaped object instead, for isolation — see exportedForTesting below. */
export const defaultMessageHistory: AntiRepetitionHistory = new InMemoryAntiRepetitionHistory();

/** Anti-repetition recency window: avoid repeating any of the last N picks in the same category. Small on purpose — categories have 6-16 variants; too large a window would just fall back to "allow repeats" constantly once exhausted. */
export const ANTI_REPETITION_WINDOW = 3;

export interface SelectMessageOptions {
  preset?: PersonalityPreset;
  history?: AntiRepetitionHistory;
  windowSize?: number;
  /** Injectable for deterministic tests — defaults to Math.random. Must return a value in [0, 1). */
  random?: () => number;
}

/**
 * Picks one message for `category`, substitutes `ctx`'s variables, and
 * records the pick for that category's anti-repetition window. Selection is
 * scoped ONLY to the requested category/stage (never bleeds into another
 * category's variants) and, when a preset is given, further scoped to
 * templates that either belong to that preset or (the common case today —
 * see personalityPresets.ts) declare no preset at all.
 */
export function selectMessage(
  category: MessageCategory,
  ctx: MessageContext = {},
  options: SelectMessageOptions = {}
): SelectedMessage {
  const preset = options.preset ?? DEFAULT_PERSONALITY_PRESET;
  const history = options.history ?? defaultMessageHistory;
  const windowSize = options.windowSize ?? ANTI_REPETITION_WINDOW;
  const random = options.random ?? Math.random;

  const candidates = MESSAGE_LIBRARY.filter(
    (m: MessageTemplate) => m.category === category && (!m.presets || m.presets.includes(preset))
  );

  if (candidates.length === 0) {
    // Should be unreachable (every category has variants — see
    // messageLibrary.ts) but a category with zero matching templates must
    // still produce SOMETHING grammatical rather than throwing mid-render.
    return { id: `${category}:fallback`, text: renderMessageTemplate('{dogName} מחכה לטיול הבא.', ctx) };
  }

  const recent = history.recentIds(category);
  const pool = candidates.filter((c) => !recent.includes(c.id));
  // If the whole category's pool is inside the recency window (a small
  // category, or an unusually long session), allow repeats again rather
  // than ever failing to return a message — "avoid recently used variants
  // WHERE PRACTICAL" (C6), not at the cost of breaking selection entirely.
  const effectivePool = pool.length > 0 ? pool : candidates;

  const chosen = effectivePool[Math.floor(random() * effectivePool.length)] ?? effectivePool[0];
  history.record(category, chosen.id, windowSize);

  return { id: chosen.id, text: renderMessageTemplate(chosen.text, ctx) };
}

/** Test-only escape hatch for constructing an isolated history instance without exporting the class itself as public API. */
export function createAntiRepetitionHistory(): AntiRepetitionHistory {
  return new InMemoryAntiRepetitionHistory();
}
