import { CELEBRATION_ANIMATION_MANIFEST } from '../celebrationAnimationManifest';
import { CLEAN_MASCOT_MASTER_ASSET, CLEAN_MASCOT_REPLACEMENT_TARGETS } from '../mascotAssetManifest';

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
      expect(entry.sourceMasterPath).toBe(CLEAN_MASCOT_MASTER_ASSET.expectedPath);
      expect(entry.sourceMasterStatus).toBe('pending-approved-clean-mascot-artwork');
    }
  });

  it('keeps the approved clean, no-text mascot master explicitly pending', () => {
    expect(CLEAN_MASCOT_MASTER_ASSET).toEqual(expect.objectContaining({
      expectedPath: 'assets/branding/walkie-doggy-mascot-clean.png',
      status: 'pending-approved-clean-mascot-artwork',
      fallbackPath: 'assets/branding/walkie-doggy-mascot.png',
    }));
    expect(CLEAN_MASCOT_REPLACEMENT_TARGETS).toEqual(expect.arrayContaining([
      'src/components/WalkieMascot.tsx',
      'src/components/celebrationAssets.ts',
      'assets/icon.png',
    ]));
  });
});
