import { REMINDER_ANIMATION_LIBRARY, selectReminderAnimation } from '../reminderAnimationLibrary';

describe('reminderAnimationLibrary', () => {
  it('ships a broad set of reminder moments across all timing stages', () => {
    expect(REMINDER_ANIMATION_LIBRARY).toHaveLength(12);
    expect(new Set(REMINDER_ANIMATION_LIBRARY.map((item) => item.stage))).toEqual(
      new Set(['pre-walk', 'due', 'late-15', 'late-30'])
    );
  });

  it('offers three choices for every reminder stage', () => {
    for (const stage of ['pre-walk', 'due', 'late-15', 'late-30'] as const) {
      expect(REMINDER_ANIMATION_LIBRARY.filter((item) => item.stage === stage)).toHaveLength(3);
    }
  });

  it('avoids immediately repeating the previous motion when another exists', () => {
    const selected = selectReminderAnimation('due', 'high-five', () => 0);
    expect(selected.animationId).not.toBe('high-five');
  });

  it('keeps reminder copy independent of a family dog name', () => {
    expect(REMINDER_ANIMATION_LIBRARY.some((item) => item.title.includes('טופי') || item.message.includes('טופי'))).toBe(false);
  });
});
