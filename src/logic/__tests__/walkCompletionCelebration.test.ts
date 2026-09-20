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

  it('keeps a spontaneous walk without duration out of the long-walk pool', () => {
    expect(selectWalkCompletionCelebration({ completedAt: new Date(2026, 8, 9, 13), random: () => 0 }).id).not.toBe('long-walk');
  });

  it('allows the rare surprise through its deliberate low-probability branch', () => {
    const random = jest.fn().mockReturnValueOnce(0.01).mockReturnValueOnce(0.99);
    expect(selectWalkCompletionCelebration({ completedAt: new Date(2026, 8, 9, 13), random }).id).toBe('special-surprise');
  });

  it('keeps metadata-only asset references and reduced-motion fallbacks for every entry', () => {
    expect(CELEBRATION_LIBRARY).toHaveLength(9);
    expect(CELEBRATION_LIBRARY.every((item) => item.asset.provider === 'local' && !!item.asset.path && !!item.asset.reducedMotionPath)).toBe(true);
  });

  it('does not use a family dog name as the brand mascot in celebration copy', () => {
    expect(CELEBRATION_LIBRARY.some((item) => item.eyebrow.includes('טופי') || item.title.includes('טופי') || item.message.includes('טופי'))).toBe(false);
  });

  it('falls back to the full contextual pool when recentIds excludes every candidate', () => {
    const allDaytimeIds = ['thank-you-heart', 'happy-jump', 'high-five', 'confetti', 'paw-party', 'trophy-teaser', 'special-surprise'];
    const picked = selectWalkCompletionCelebration({
      completedAt: new Date(2026, 8, 9, 13),
      recentIds: allDaytimeIds,
      random: () => 0,
    });
    expect(allDaytimeIds).toContain(picked.id);
  });

  it('falls back to the rare entry anyway when it is the only remaining candidate outside the 8% roll', () => {
    const picked = selectWalkCompletionCelebration({
      completedAt: new Date(2026, 8, 9, 13),
      recentIds: ['thank-you-heart', 'happy-jump', 'high-five', 'confetti', 'paw-party', 'trophy-teaser'],
      random: () => 0.5,
    });
    expect(picked.id).toBe('special-surprise');
  });

  it('defaults completedAt and random to the real current moment/Math.random when called with no argument', () => {
    const picked = selectWalkCompletionCelebration();
    expect(CELEBRATION_LIBRARY.map((item) => item.id)).toContain(picked.id);
  });
});
