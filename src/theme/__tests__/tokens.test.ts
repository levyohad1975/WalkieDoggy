import { breakpoints, layout, motion, radii, spacing, typography } from '../tokens';
import { colors } from '../colors';

describe('Walkie Doggy design foundations', () => {
  it('keeps the established turquoise identity and semantic status palette', () => {
    expect(colors.primary).toBe('#20A7B5');
    expect(colors.success).toBe(colors.statusDone);
    expect(colors.danger).toBe(colors.statusSkipped);
  });

  it('defines a coherent mobile-first scale and accessible targets', () => {
    expect(spacing).toMatchObject({ xs: 4, sm: 8, md: 12, lg: 16, xl: 20, xxl: 28 });
    expect(radii).toMatchObject({ sm: 10, md: 14, lg: 18, xl: 24, round: 999 });
    expect(layout.minTouchTarget).toBeGreaterThanOrEqual(44);
    expect(breakpoints.readingColumn).toBeLessThan(breakpoints.desktopContent);
  });

  it('keeps Hebrew-friendly text and bounded motion scales available to every screen', () => {
    expect(typography.screenTitle.lineHeight).toBeGreaterThan(typography.screenTitle.fontSize);
    expect(motion.feedback).toBeLessThan(motion.transition);
    expect(motion.celebrationMax).toBeLessThanOrEqual(2500);
  });
});
