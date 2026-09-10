import type { ImageSourcePropType } from 'react-native';
import type { CelebrationAssetReference } from '../logic/walkCompletionCelebration';

const MASCOT_FALLBACK = require('../../assets/branding/walkie-doggy-mascot.png');

export interface ResolvedCelebrationAsset {
  source: ImageSourcePropType;
  fallbackSource: ImageSourcePropType;
  frames: ImageSourcePropType[];
  isPlaceholder: boolean;
}

/**
 * The only shipped celebration visual is a temporary branded fallback; it
 * contains the wordmark and must be replaced once the approved clean mascot
 * master is supplied. This registry keeps that replacement to one point.
 */
export function resolveCelebrationAsset(reference: CelebrationAssetReference | undefined): ResolvedCelebrationAsset {
  if (!reference || reference.reducedMotionPath !== 'assets/branding/walkie-doggy-mascot.png') {
    return { source: MASCOT_FALLBACK, fallbackSource: MASCOT_FALLBACK, frames: [], isPlaceholder: true };
  }

  if (reference.provider === 'local' && reference.path === 'assets/branding/walkie-doggy-mascot.png') {
    return { source: MASCOT_FALLBACK, fallbackSource: MASCOT_FALLBACK, frames: [], isPlaceholder: true };
  }

  if (reference.provider === 'supabase-storage' && /^https:\/\//.test(reference.path)) {
    return { source: { uri: reference.path }, fallbackSource: MASCOT_FALLBACK, frames: [], isPlaceholder: false };
  }

  return { source: MASCOT_FALLBACK, fallbackSource: MASCOT_FALLBACK, frames: [], isPlaceholder: true };
}
