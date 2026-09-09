/**
 * C7 — future personality presets, ARCHITECTURE ONLY (Batch 4).
 *
 * The brief explicitly asks for the message system to be *designed* so a
 * future family preference ("רגוע" / "שובב" / "מצחיק") could be added later,
 * without building a settings UI for it now and without that future work
 * requiring a rewrite of the message library's shape.
 *
 * Today, exactly one preset ships and is always active: 'default'. Nothing
 * in the app lets a family choose a different one yet — there is no
 * settings screen, no stored per-family preference, no server column for
 * it. `messageLibrary.ts`'s `MessageTemplate.presets` field already exists
 * and any template may opt into a subset of these presets; every template
 * in this batch leaves it undefined ("belongs to every preset"), so
 * introducing 'calm'/'playful' later is purely additive: tag some existing
 * templates (or add new ones) with the new preset id, wire a per-family
 * selector into the engine's `selectMessage()` `preset` argument (already
 * accepted, see messageEngine.ts), and — only then — decide whether a
 * settings UI is worth building. No part of this file or the engine needs
 * to change shape to support that.
 */

export type PersonalityPreset = 'default' | 'calm' | 'playful' | 'funny';

export const DEFAULT_PERSONALITY_PRESET: PersonalityPreset = 'default';

/** Every preset id currently defined — 'default' is the only one with any live behavior difference (none: it simply doesn't filter). */
export const PERSONALITY_PRESETS: PersonalityPreset[] = ['default', 'calm', 'playful', 'funny'];
