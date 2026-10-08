import {
  computeReminderPromptPlacement,
  reminderLaneInHost,
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

describe('reminderLaneInHost — window lane translated into the in-screen overlay', () => {
  it('with no host measurement, treats the host as the whole window', () => {
    expect(reminderLaneInHost({ top: 430, bottom: 98 }, 844, null)).toEqual({ top: 430, bottom: 98 });
  });

  it('subtracts the host top (status bar / header above the screen)', () => {
    // Screen box: y 47..754 (ends at the tab bar top on an 844pt phone: 844 - 34 - 56).
    const lane = reminderLaneInHost({ top: 430, bottom: 98 }, 844, { y: 47, height: 707 });
    expect(lane.top).toBe(383);
    // Lane bottom in window = 746; host bottom = 754 -> 8px gap above the tab bar.
    expect(lane.bottom).toBe(8);
  });

  it('never yields negative insets when the lane starts above or ends below the host', () => {
    const lane = reminderLaneInHost({ top: 10, bottom: 0 }, 844, { y: 47, height: 707 });
    expect(lane.top).toBe(0);
    expect(lane.bottom).toBe(0);
  });

  it('ignores a zero-size host measurement', () => {
    expect(reminderLaneInHost({ top: 430, bottom: 98 }, 844, { y: 47, height: 0 })).toEqual({ top: 430, bottom: 98 });
  });
});
