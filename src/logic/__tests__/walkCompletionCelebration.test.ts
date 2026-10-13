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
      recentIds: ['thank-you-heart', 'happy-jump', 'high-five'],
      random: () => 0,
    });
    expect(picked.id).toBe('trophy-teaser');
  });

  it('keeps metadata-only asset references and reduced-motion fallbacks for every entry', () => {
    // fix: remove duplicate and legacy completion celebrations — the library
    // was trimmed from 9 to 5 (confetti/paw-party/long-walk/special-surprise
    // removed as duplicates/legacy of the remaining variants).
    expect(CELEBRATION_LIBRARY).toHaveLength(5);
    expect(CELEBRATION_LIBRARY.every((item) => item.asset.provider === 'local' && !!item.asset.path && !!item.asset.reducedMotionPath)).toBe(true);
  });

  it('does not use a family dog name as the brand mascot in celebration copy', () => {
    expect(CELEBRATION_LIBRARY.some((item) => item.eyebrow.includes('טופי') || item.title.includes('טופי') || item.message.includes('טופי'))).toBe(false);
  });

  it('falls back to the full contextual pool when recentIds excludes every candidate', () => {
    const allDaytimeIds = ['thank-you-heart', 'happy-jump', 'high-five', 'trophy-teaser'];
    const picked = selectWalkCompletionCelebration({
      completedAt: new Date(2026, 8, 9, 13),
      recentIds: allDaytimeIds,
      random: () => 0,
    });
    expect(allDaytimeIds).toContain(picked.id);
  });

  it('defaults completedAt and random to the real current moment/Math.random when called with no argument', () => {
    const picked = selectWalkCompletionCelebration();
    expect(CELEBRATION_LIBRARY.map((item) => item.id)).toContain(picked.id);
  });
});
