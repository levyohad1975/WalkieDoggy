import {
  computeReminderPromptPlacement,
  REMINDER_BUBBLE_ALLOWANCE,
  REMINDER_COMPACT_MIN_HEIGHT,
  REMINDER_MASCOT_COMPACT_MIN_SIZE,
  REMINDER_MASCOT_MAX_SIZE,
  REMINDER_MASCOT_MIN_SIZE,
} from '../reminderPromptPlacement';

/**
 * Real-iPhone QA regression: the notification-open mascot and its speech
 * bubble sat dead-centre on Home, covering the next-walk card and its
 * Start Walk button. The moment must cover neither that card nor the
 * bottom tab bar, on every iPhone that supports Home Screen web push.
 */
const TAB = 56;
const card = (bottom: number, height = 250) => ({ x: 12, y: bottom - height, width: 366, height });
const footprint = (p: { mascotSize: number; compact: boolean }) =>
  p.compact ? Math.max(p.mascotSize, REMINDER_COMPACT_MIN_HEIGHT) : p.mascotSize + REMINDER_BUBBLE_ALLOWANCE;

// Standalone-PWA viewport heights and home-indicator insets. iPhone 8 /
// SE 2-3 (667pt) is the smallest device that can receive web push (iOS 16.4+).
const IPHONES: [string, number, number][] = [
  ['iPhone SE 2/3, 8', 667, 0],
  ['iPhone 8 Plus', 736, 0],
  ['iPhone 13 mini', 812, 34],
  ['iPhone 14/15', 852, 34],
  ['iPhone 15 Pro Max', 932, 34],
];

describe('computeReminderPromptPlacement', () => {
  it.each(IPHONES)('%s: never covers the next-walk card or the tab bar, wherever the card ends', (_name, height, inset) => {
    const tabBarTop = height - inset - TAB;
    // Every card position that leaves at least the compact row (plus an 8px gap each side) free.
    for (let cardBottom = 300; cardBottom <= tabBarTop - 16 - REMINDER_COMPACT_MIN_HEIGHT; cardBottom += 4) {
      const p = computeReminderPromptPlacement({ windowHeight: height, tabBarHeight: TAB, bottomInset: inset, avoid: card(cardBottom) });
      const laneBottom = height - p.bottom;
      expect(p.clearsAvoidRect).toBe(true);
      expect(p.top).toBeGreaterThanOrEqual(cardBottom); // below Start Walk
      expect(laneBottom).toBeLessThanOrEqual(tabBarTop); // above navigation
      expect(laneBottom - p.top).toBeGreaterThanOrEqual(footprint(p)); // and it actually fits
    }
  });

  it('uses the full approved size, bubble above, when there is room', () => {
    const p = computeReminderPromptPlacement({ windowHeight: 932, tabBarHeight: TAB, bottomInset: 34, avoid: card(410) });
    expect(p.mascotSize).toBe(REMINDER_MASCOT_MAX_SIZE);
    expect(p.compact).toBe(false);
  });

  it('shrinks the stacked mascot before switching layout', () => {
    const p = computeReminderPromptPlacement({ windowHeight: 667, tabBarHeight: TAB, bottomInset: 0, avoid: card(380) });
    expect(p.compact).toBe(false);
    expect(p.mascotSize).toBeLessThan(REMINDER_MASCOT_MAX_SIZE);
    expect(p.mascotSize).toBeGreaterThanOrEqual(REMINDER_MASCOT_MIN_SIZE);
  });

  it('goes side-by-side (compact) on a short lane, e.g. a tall card on iPhone SE', () => {
    const p = computeReminderPromptPlacement({ windowHeight: 667, tabBarHeight: TAB, bottomInset: 0, avoid: card(480) });
    expect(p.compact).toBe(true);
    expect(p.mascotSize).toBeLessThanOrEqual(REMINDER_MASCOT_MIN_SIZE);
    expect(p.mascotSize).toBeGreaterThanOrEqual(REMINDER_MASCOT_COMPACT_MIN_SIZE);
    expect(p.top).toBeGreaterThanOrEqual(480);
    expect(p.clearsAvoidRect).toBe(true);
  });

  it('if the card reaches almost to the tab bar, still keeps navigation free and reports the sliver of overlap', () => {
    const p = computeReminderPromptPlacement({ windowHeight: 667, tabBarHeight: TAB, bottomInset: 0, avoid: card(580, 400) });
    expect(p.clearsAvoidRect).toBe(false);
    expect(667 - p.bottom).toBeLessThanOrEqual(667 - TAB);
    expect(p.mascotSize).toBe(REMINDER_MASCOT_COMPACT_MIN_SIZE);
  });

  it('never extends into the tab bar or the home-indicator inset', () => {
    for (const cardBottom of [300, 500, 700, 760]) {
      const p = computeReminderPromptPlacement({ windowHeight: 812, tabBarHeight: TAB, bottomInset: 34, avoid: card(cardBottom) });
      expect(p.bottom).toBeGreaterThanOrEqual(34 + TAB);
    }
  });

  it('with no measurement yet, stays in the lower half rather than the old centre spot', () => {
    const p = computeReminderPromptPlacement({ windowHeight: 844, tabBarHeight: TAB, bottomInset: 34, avoid: null });
    expect(p.top).toBeGreaterThanOrEqual(422);
    expect(p.bottom).toBeGreaterThanOrEqual(34 + TAB);
  });

  it('a card scrolled above the viewport does not push the lane off-screen', () => {
    const p = computeReminderPromptPlacement({ windowHeight: 844, tabBarHeight: TAB, bottomInset: 34, avoid: card(-150) });
    expect(p.top).toBe(0);
    expect(p.mascotSize).toBe(REMINDER_MASCOT_MAX_SIZE);
  });
});
