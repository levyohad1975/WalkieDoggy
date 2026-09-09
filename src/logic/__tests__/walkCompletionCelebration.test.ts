import { CELEBRATION_LIBRARY, selectWalkCompletionCelebration } from '../walkCompletionCelebration';

describe('selectWalkCompletionCelebration', () => {
  it('uses a gentle night-time reaction for late walks', () => {
    expect(selectWalkCompletionCelebration({ completedAt: new Date(2026, 8, 9, 22, 15) }).id).toBe('sleepy-good-night');
  });

  it('selects daytime reactions from a stable random input', () => {
    expect(selectWalkCompletionCelebration({ completedAt: new Date(2026, 8, 9, 13), random: () => 0 }).id).toBe('thank-you-heart');
  });

  it('avoids recent reactions when another suitable entry is available', () => {
    const picked = selectWalkCompletionCelebration({
      completedAt: new Date(2026, 8, 9, 13),
      recentIds: ['thank-you-heart', 'happy-jump', 'high-five', 'confetti', 'paw-party', 'trophy-teaser'],
      random: () => 0,
    });
    expect(picked.id).not.toBe('thank-you-heart');
  });

  it('prefers a long-walk celebration when duration is available', () => {
    expect(selectWalkCompletionCelebration({ completedAt: new Date(2026, 8, 9, 13), durationMinutes: 50, random: () => 0 }).id).toBe('long-walk');
  });

  it('keeps metadata-only asset references and reduced-motion fallbacks for every entry', () => {
    expect(CELEBRATION_LIBRARY).toHaveLength(9);
    expect(CELEBRATION_LIBRARY.every((item) => item.asset.provider === 'local' && !!item.asset.path && !!item.asset.reducedMotionPath)).toBe(true);
  });
});
