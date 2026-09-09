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
});
