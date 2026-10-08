import { REMINDER_ANIMATION_LIBRARY, selectReminderAnimation, reminderStageForNotificationKind } from '../reminderAnimationLibrary';

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

  // Mascot-notification-experiences round — a real notification tap now
  // selects a stage-appropriate animation instead of an unfiltered random
  // pick; this is the mapping from the server/push payload vocabulary.
  describe('reminderStageForNotificationKind', () => {
    it('maps every NotificationKind to its own ReminderStage, matching the T-15 excited / T playful / T+15 waiting / T+30 waiting-escalated intent', () => {
      expect(reminderStageForNotificationKind('T-15')).toBe('pre-walk');
      expect(reminderStageForNotificationKind('T')).toBe('due');
      expect(reminderStageForNotificationKind('T+15')).toBe('late-15');
      expect(reminderStageForNotificationKind('T+30')).toBe('late-30');
    });

    it('every mapped stage actually exists in the animation library, so a real tap never falls back to the unfiltered pool', () => {
      const stages = new Set(REMINDER_ANIMATION_LIBRARY.map((item) => item.stage));
      for (const kind of ['T-15', 'T', 'T+15', 'T+30'] as const) {
        expect(stages.has(reminderStageForNotificationKind(kind))).toBe(true);
      }
    });
  });
});
