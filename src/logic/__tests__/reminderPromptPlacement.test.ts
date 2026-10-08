import {
  computeReminderPromptPlacement,
  REMINDER_BUBBLE_ALLOWANCE,
  REMINDER_MASCOT_MAX_SIZE,
  REMINDER_MASCOT_MIN_SIZE,
} from '../reminderPromptPlacement';

/**
 * Real-iPhone QA regression: the notification-open mascot and its speech
 * bubble sat dead-centre on Home, covering the next-walk card and its
 * Start Walk button.
 */
describe('computeReminderPromptPlacement — keeps the mascot moment off the next-walk card', () => {
  const card = (y: number, height: number) => ({ x: 12, y, width: 366, height });

  it('places the lane entirely below the measured card and above the tab bar', () => {
    const p = computeReminderPromptPlacement({ windowHeight: 844, tabBarReserve: 88, bottomInset: 34, avoid: card(180, 250) });
    expect(p.top).toBeGreaterThanOrEqual(180 + 250);
    expect(p.bottom).toBe(122);
    expect(p.clearsAvoidRect).toBe(true);
    expect(844 - p.bottom - p.top).toBeGreaterThanOrEqual(p.mascotSize + REMINDER_BUBBLE_ALLOWANCE);
  });

  it('uses the full approved size when there is room', () => {
    const p = computeReminderPromptPlacement({ windowHeight: 932, tabBarReserve: 88, bottomInset: 34, avoid: card(170, 240) });
    expect(p.mascotSize).toBe(REMINDER_MASCOT_MAX_SIZE);
  });

  it('shrinks the mascot (never below the minimum) instead of overlapping when the lane is short', () => {
    const p = computeReminderPromptPlacement({ windowHeight: 736, tabBarReserve: 88, bottomInset: 0, avoid: card(170, 250) });
    expect(p.mascotSize).toBeLessThan(REMINDER_MASCOT_MAX_SIZE);
    expect(p.mascotSize).toBeGreaterThanOrEqual(REMINDER_MASCOT_MIN_SIZE);
    expect(p.top).toBeGreaterThanOrEqual(170 + 250);
    expect(p.bottom).toBe(88);
    expect(p.clearsAvoidRect).toBe(true);
  });

  it('on a compact phone (iPhone SE height) extends over the tab bar rather than covering Start Walk', () => {
    const p = computeReminderPromptPlacement({ windowHeight: 667, tabBarReserve: 88, bottomInset: 0, avoid: card(170, 250) });
    expect(p.top).toBeGreaterThanOrEqual(170 + 250);
    expect(p.bottom).toBe(0);
    expect(p.clearsAvoidRect).toBe(true);
  });

  it('never extends into the home-indicator inset', () => {
    const p = computeReminderPromptPlacement({ windowHeight: 700, tabBarReserve: 88, bottomInset: 34, avoid: card(170, 250) });
    expect(p.bottom).toBe(34);
  });

  it('when even that cannot clear the card, hugs the bottom at minimum size and reports it', () => {
    const p = computeReminderPromptPlacement({ windowHeight: 568, tabBarReserve: 88, bottomInset: 0, avoid: card(200, 260) });
    expect(p.mascotSize).toBe(REMINDER_MASCOT_MIN_SIZE);
    expect(p.clearsAvoidRect).toBe(false);
    expect(568 - p.bottom - p.top).toBe(REMINDER_MASCOT_MIN_SIZE + REMINDER_BUBBLE_ALLOWANCE);
  });

  it('with no measurement yet, stays in the lower half rather than the old centre spot', () => {
    const p = computeReminderPromptPlacement({ windowHeight: 844, tabBarReserve: 88, bottomInset: 34, avoid: null });
    expect(p.top).toBeGreaterThanOrEqual(422);
    expect(p.bottom).toBe(122);
  });

  it('a card scrolled above the viewport does not push the lane off-screen', () => {
    const p = computeReminderPromptPlacement({ windowHeight: 844, tabBarReserve: 88, bottomInset: 34, avoid: card(-400, 250) });
    expect(p.top).toBe(0);
    expect(p.mascotSize).toBe(REMINDER_MASCOT_MAX_SIZE);
  });
});
