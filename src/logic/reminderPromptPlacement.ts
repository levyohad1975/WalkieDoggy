/**
 * Where the notification-open mascot moment (speech bubble + mascot) sits
 * on Home.
 *
 * Real-iPhone QA: the moment was centred on the whole screen, which is
 * exactly where Home's next-walk card and its Start Walk button live, so
 * the mascot covered the one control the reminder is about. It now lives
 * in a lane BELOW that card (measured on screen) and above the bottom tab
 * bar, and the mascot image shrinks — same approved asset, only rendered
 * smaller — when that lane is short. Nothing on the Dashboard moves.
 */
export interface ScreenRect { x: number; y: number; width: number; height: number }

export interface ReminderPromptPlacement {
  /** Lane top/bottom insets from the window edges, in px. */
  top: number;
  bottom: number;
  /** Rendered square size of the mascot image. */
  mascotSize: number;
  /** False only when the screen is too short to clear the card even at the minimum size. */
  clearsAvoidRect: boolean;
}

export const REMINDER_MASCOT_MAX_SIZE = 216;
export const REMINDER_MASCOT_MIN_SIZE = 112;
/** Two-line bubble + tail above the mascot. */
export const REMINDER_BUBBLE_ALLOWANCE = 96;
const GAP_BELOW_AVOID_RECT = 8;

export function computeReminderPromptPlacement(input: {
  windowHeight: number;
  /** Bottom tab bar row height (excluding the home-indicator inset). */
  tabBarReserve: number;
  /** Home-indicator safe-area inset. */
  bottomInset: number;
  /** On-screen rect of the next-walk card (incl. Start Walk), when measured. */
  avoid?: ScreenRect | null;
}): ReminderPromptPlacement {
  const { windowHeight, tabBarReserve, bottomInset, avoid } = input;
  const measured = !!avoid && avoid.height > 0;
  // Unmeasured (card not on screen yet): still stay out of the upper half,
  // where the card normally sits, instead of the old dead-centre spot.
  const wantedTop = measured
    ? Math.max(0, avoid!.y + avoid!.height + GAP_BELOW_AVOID_RECT)
    : windowHeight * 0.5;
  const minNeeded = REMINDER_MASCOT_MIN_SIZE + REMINDER_BUBBLE_ALLOWANCE;

  // Preferred lane ends above the tab bar. On a compact phone that lane can
  // be too short; the brief, self-dismissing moment may then extend over
  // the tab bar (never the home indicator) — covering navigation for a few
  // seconds is better than covering Start Walk.
  let laneBottom = Math.max(0, windowHeight - bottomInset - tabBarReserve);
  if (laneBottom - wantedTop < minNeeded) laneBottom = Math.max(0, windowHeight - bottomInset);

  const available = laneBottom - wantedTop;
  const mascotSize = Math.round(
    Math.min(REMINDER_MASCOT_MAX_SIZE, Math.max(REMINDER_MASCOT_MIN_SIZE, available - REMINDER_BUBBLE_ALLOWANCE))
  );
  const needed = mascotSize + REMINDER_BUBBLE_ALLOWANCE;
  const clears = available >= needed;
  // Still too short to clear: hug the bottom so any overlap is with the
  // card's lowest edge only.
  const top = clears ? wantedTop : Math.max(0, laneBottom - needed);
  return { top: Math.round(top), bottom: Math.round(windowHeight - laneBottom), mascotSize, clearsAvoidRect: clears || !measured };
}
