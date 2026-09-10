import { CELEBRATION_ANIMATION_MANIFEST } from '../celebrationAnimationManifest';

describe('celebration animation manifest', () => {
  it('defines a finite local frame pack for every celebration', () => {
    expect(CELEBRATION_ANIMATION_MANIFEST).toHaveLength(9);
    for (const entry of CELEBRATION_ANIMATION_MANIFEST) {
      expect(entry.animationType).toBe('frame-sequence');
      expect(entry.approximateDurationMs).toBeGreaterThan(0);
      expect(entry.approximateDurationMs).toBeLessThanOrEqual(2500);
      expect(entry.localFrameDirectory).toContain(entry.id);
      expect(entry.expectedFrameFiles.length).toBeGreaterThanOrEqual(10);
      expect(entry.expectedFrameFiles[0]).toBe('frame-01.png');
    }
  });
});
