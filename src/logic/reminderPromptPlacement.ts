/**
 * Where the notification-open mascot moment (speech bubble + mascot) sits
 * on Home.
 *
 * Real-iPhone QA: the moment was centred on the whole screen, which is
 * exactly where Home's next-walk card and its Start Walk button live, so
 * the mascot covered the one control the reminder is about.
 *
 * Rule: the moment lives only in the lane BELOW that card (measured on
 * screen) and ABOVE the bottom tab bar. It never covers either. When the
 * lane is short the same approved mascot asset is rendered smaller, and
 * when it is too short for bubble-above-mascot the two sit side by side
 * (`compact`). Nothing on the Dashboard moves.
 */
export interface ScreenRect { x: number; y: number; width: number; height: number }

export interface ReminderPromptPlacement {
  /** Lane top/bottom insets from the window edges, in px. */
  top: number;
  bottom: number;
  /** Rendered square size of the mascot image. */
  mascotSize: number;
  /** True: bubble beside the mascot (short lane). False: bubble above it. */
  compact: boolean;
  /** False only when the lane is shorter than even the compact layout. */
  clearsAvoidRect: boolean;
}

export const REMINDER_MASCOT_MAX_SIZE = 216;
/** Smallest mascot in the stacked (bubble above) layout. */
export const REMINDER_MASCOT_MIN_SIZE = 112;
/** Smallest mascot at all (compact layout). */
export const REMINDER_MASCOT_COMPACT_MIN_SIZE = 64;
/** Two-line bubble + tail above the mascot. */
export const REMINDER_BUBBLE_ALLOWANCE = 96;
/** Height of the two-line bubble when it sits beside the mascot. */
export const REMINDER_COMPACT_MIN_HEIGHT = 72;
const GAP = 8;

export function computeReminderPromptPlacement(input: {
  windowHeight: number;
  /** Bottom tab bar row height (excluding the home-indicator inset). */
  tabBarHeight: number;
  /** Home-indicator safe-area inset. */
  bottomInset: number;
  /** On-screen rect of the next-walk card (incl. Start Walk), when measured. */
  avoid?: ScreenRect | null;
}): ReminderPromptPlacement {
  const { windowHeight, tabBarHeight, bottomInset, avoid } = input;
  const measured = !!avoid && avoid.height > 0;
  // The tab bar (and the home indicator under it) is never covered.
  const laneBottom = Math.max(0, windowHeight - bottomInset - tabBarHeight - GAP);
  // Unmeasured (card not on screen yet): still stay out of the upper half,
  // where the card normally sits, instead of the old dead-centre spot.
  const wantedTop = Math.min(
    laneBottom,
    measured ? Math.max(0, avoid!.y + avoid!.height + GAP) : windowHeight * 0.5
  );
  const available = laneBottom - wantedTop;
  const bottom = Math.round(windowHeight - laneBottom);

  if (available >= REMINDER_MASCOT_MIN_SIZE + REMINDER_BUBBLE_ALLOWANCE) {
    const mascotSize = Math.round(Math.min(REMINDER_MASCOT_MAX_SIZE, available - REMINDER_BUBBLE_ALLOWANCE));
    return { top: Math.round(wantedTop), bottom, mascotSize, compact: false, clearsAvoidRect: true };
  }

  const mascotSize = Math.round(
    Math.min(REMINDER_MASCOT_MIN_SIZE, Math.max(REMINDER_MASCOT_COMPACT_MIN_SIZE, available))
  );
  const needed = Math.max(mascotSize, REMINDER_COMPACT_MIN_HEIGHT);
  const clears = available >= needed;
  // Lane shorter than even the compact row (the card reaches almost to the
  // tab bar): keep navigation free and hug the lane bottom, so the only
  // overlap is a sliver of the card's lowest edge.
  const top = clears ? wantedTop : Math.max(0, laneBottom - needed);
  return { top: Math.round(top), bottom, mascotSize, compact: true, clearsAvoidRect: clears || !measured };
}

/**
 * The placement above is in WINDOW coordinates (that is what
 * measureInWindow reports for the next-walk card). The overlay itself is
 * an absolutely positioned view inside the screen, whose own box usually
 * starts below the status bar and ends above the tab bar — so the lane has
 * to be translated into that host box before it is used as top/bottom
 * insets. With no host measurement yet, the host is assumed to be the
 * whole window.
 */
export function reminderLaneInHost(
  placement: Pick<ReminderPromptPlacement, 'top' | 'bottom'>,
  windowHeight: number,
  host?: Pick<ScreenRect, 'y' | 'height'> | null
): { top: number; bottom: number } {
  const hostTop = host && host.height > 0 ? host.y : 0;
  const hostBottom = host && host.height > 0 ? host.y + host.height : windowHeight;
  const laneBottomInWindow = windowHeight - placement.bottom;
  return {
    top: Math.max(0, Math.round(placement.top - hostTop)),
    bottom: Math.max(0, Math.round(hostBottom - laneBottomInWindow)),
  };
}
