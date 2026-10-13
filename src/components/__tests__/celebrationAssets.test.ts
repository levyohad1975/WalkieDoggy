import { resolveCelebrationAsset } from '../celebrationAssets';
import { CELEBRATION_LIBRARY } from '../../logic/walkCompletionCelebration';

describe('celebration asset resolution', () => {
  it('resolves every current library entry to a bundled fallback', () => {
    for (const celebration of CELEBRATION_LIBRARY) {
      const resolved = resolveCelebrationAsset(celebration.asset);
      expect(resolved.source).toBeTruthy();
      expect(resolved.fallbackSource).toBeTruthy();
    }
  });

  it('fails safely when a metadata reference is missing or invalid', () => {
    expect(resolveCelebrationAsset(undefined).isPlaceholder).toBe(true);
    expect(resolveCelebrationAsset({ provider: 'local', path: 'assets/missing.png', variant: 'missing', reducedMotionPath: 'missing.png' }).isPlaceholder).toBe(true);
  });

  it('returns the SAME frames array reference across repeated calls — MascotFrameAnimation depends on it by reference, so a fresh `[]` literal per call would reset any in-progress playback on every re-render', () => {
    const first = resolveCelebrationAsset(CELEBRATION_LIBRARY[0].asset);
    const second = resolveCelebrationAsset(CELEBRATION_LIBRARY[0].asset);
    expect(first.frames).toBe(second.frames);
    // Also true across different celebrations and the undefined/invalid paths.
    expect(resolveCelebrationAsset(undefined).frames).toBe(first.frames);
    expect(resolveCelebrationAsset(CELEBRATION_LIBRARY[1].asset).frames).toBe(first.frames);
  });
});
