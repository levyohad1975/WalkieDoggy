import { REMINDER_ANIMATION_LIBRARY, selectReminderAnimation } from '../reminderAnimationLibrary';

describe('reminderAnimationLibrary', () => {
  it('never presents duplicate motion assets as separate animation choices', () => {
    const ids = REMINDER_ANIMATION_LIBRARY.map((item) => item.animationId);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toEqual(expect.arrayContaining(['happy-jump', 'high-five', 'thank-you-heart', 'trophy', 'sleepy-good-night', 'leash-ready', 'playful-wait', 'trophy-lift', 'paw-wave']));
    expect(ids).toHaveLength(9);
  });

  it('covers pre-walk, due, and escalating overdue reminder moments', () => {
    expect(new Set(REMINDER_ANIMATION_LIBRARY.map((item) => item.stage))).toEqual(
      new Set(['pre-walk', 'due', 'late-15', 'late-30'])
    );
  });

  it('avoids immediately repeating the previous motion when another exists', () => {
    const selected = selectReminderAnimation(undefined, 'high-five', () => 0);
    expect(selected.animationId).not.toBe('high-five');
  });

  it('keeps reminder copy independent of a family dog name', () => {
    expect(REMINDER_ANIMATION_LIBRARY.some((item) => item.title.includes('טופי') || item.message.includes('טופי'))).toBe(false);
  });
});
