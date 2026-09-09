/**
 * C8 — centralized mascot-state <-> message-category <-> reminder-stage
 * pairing. This is the ONLY place that maps a reminder stage to a mascot
 * animation state and a message category — every screen that wants "the
 * mascot for right now" goes through `deriveMascotMoment()` below rather
 * than recomputing its own stage-to-animation logic. Keeps the pairing
 * testable in one place instead of scattered across HomeScreen/
 * NextWalkCard/CompleteWalkModal (C8's explicit requirement).
 */

import type { Walk } from '../types';
import type { MascotState } from '../components/WalkieMascot';
import type { MessageCategory } from './messageLibrary';
import { minutesUntil } from '../logic/nextWalk';

export type MascotStage = 'idle' | 'excited' | 'ready' | 'waiting' | 'concerned' | 'success';

/**
 * Centralized pairing table (C8) — one row per meaningful moment in the
 * walk lifecycle. `mascotState` drives WalkieMascot's animation,
 * `messageCategory` drives which slice of the message library
 * (messageLibrary.ts) selectMessage() draws from. Kept as a plain lookup
 * object (not scattered conditionals) so a future stage can be added in one
 * place.
 */
export const MASCOT_MOMENT_MAP: Record<MascotStage, { mascotState: MascotState; messageCategory: MessageCategory }> = {
  idle: { mascotState: 'idle', messageCategory: 'encouragement' },
  excited: { mascotState: 'excited', messageCategory: 'excited' },
  ready: { mascotState: 'ready', messageCategory: 'ready' },
  waiting: { mascotState: 'waiting', messageCategory: 'waiting' },
  concerned: { mascotState: 'concerned', messageCategory: 'concerned' },
  success: { mascotState: 'success', messageCategory: 'success' },
};

/**
 * Derives the mascot stage for a still-pending walk purely from how far
 * `now` is from its scheduled time — the client-side counterpart of the
 * server reminder scheduler's T-15/T/T+15/T+30 stages (migration 0025,
 * src/logic/reminderMessages.ts's ReminderStage), but computed locally so
 * the in-app mascot can react continuously rather than only at the four
 * exact moments a push notification fires. Deliberately reuses
 * `minutesUntil()` (src/logic/nextWalk.ts) rather than re-deriving its own
 * date math.
 *
 * Bucketing (minutesUntil is positive before the scheduled time, negative
 * after — see nextWalk.ts):
 *   > 15                : idle      — nothing urgent yet.
 *   (0, 15]              : excited   — T-15 zone, approaching walk time.
 *   (-15, 0]              : ready     — at/just past the scheduled time.
 *   (-30, -15]            : waiting   — T+15 zone, walk overdue.
 *   <= -30                : concerned — T+30 zone, walk significantly overdue.
 */
export function deriveMascotStageForPendingWalk(walk: Pick<Walk, 'date' | 'scheduledTime'>, now: Date = new Date()): MascotStage {
  const diff = minutesUntil(walk, now);
  if (diff > 15) return 'idle';
  if (diff > 0) return 'excited';
  if (diff > -15) return 'ready';
  if (diff > -30) return 'waiting';
  return 'concerned';
}

/** One-stop lookup: stage -> { mascotState, messageCategory }. */
export function deriveMascotMoment(
  walk: Pick<Walk, 'date' | 'scheduledTime'> | null | undefined,
  now: Date = new Date()
): { stage: MascotStage; mascotState: MascotState; messageCategory: MessageCategory } {
  const stage = walk ? deriveMascotStageForPendingWalk(walk, now) : 'idle';
  return { stage, ...MASCOT_MOMENT_MAP[stage] };
}
