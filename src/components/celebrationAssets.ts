import type { ImageSourcePropType } from 'react-native';
import type { CelebrationAssetReference } from '../logic/walkCompletionCelebration';

const MASCOT_FALLBACK = require('../../assets/branding/walkie-doggy-mascot-transparent.png');

// A single shared, stable reference — never a fresh `[]` literal per call.
// MascotFrameAnimation's playback effect depends on `frames` BY REFERENCE
// (see its own doc comment), so a new array identity on every render would
// reset any in-progress frame playback to frame 0. Invisible today (every
// branch below is still frame-less, so playback never actually starts —
// see MASCOT_SPEC.md's "final frame artwork does not [exist]"), but this
// keeps that latent bug from resurfacing the moment real frame arrays are
// wired in here.
const EMPTY_FRAMES: ImageSourcePropType[] = [];

export interface ResolvedCelebrationAsset {
  source: ImageSourcePropType;
  fallbackSource: ImageSourcePropType;
  frames: ImageSourcePropType[];
  isPlaceholder: boolean;
}

/**
 * The only shipped celebration visual is the approved clean mascot fallback.
 * Frame packs remain pending, so this registry keeps their future replacement
 * at one point.
 */
export function resolveCelebrationAsset(reference: CelebrationAssetReference | undefined): ResolvedCelebrationAsset {
  if (!reference || reference.reducedMotionPath !== 'assets/branding/walkie-doggy-mascot-transparent.png') {
    return { source: MASCOT_FALLBACK, fallbackSource: MASCOT_FALLBACK, frames: EMPTY_FRAMES, isPlaceholder: true };
  }

  if (reference.provider === 'local' && reference.path === 'assets/branding/walkie-doggy-mascot-transparent.png') {
    return { source: MASCOT_FALLBACK, fallbackSource: MASCOT_FALLBACK, frames: EMPTY_FRAMES, isPlaceholder: true };
  }

  if (reference.provider === 'supabase-storage' && /^https:\/\//.test(reference.path)) {
    return { source: { uri: reference.path }, fallbackSource: MASCOT_FALLBACK, frames: EMPTY_FRAMES, isPlaceholder: false };
  }

  return { source: MASCOT_FALLBACK, fallbackSource: MASCOT_FALLBACK, frames: EMPTY_FRAMES, isPlaceholder: true };
}
