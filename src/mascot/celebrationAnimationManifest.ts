import type { CelebrationDefinition } from '../logic/walkCompletionCelebration';
import { CLEAN_MASCOT_MASTER_ASSET } from './mascotAssetManifest';

export interface CelebrationAnimationManifestEntry {
  id: string;
  visualConcept: string;
  animationType: 'frame-sequence';
  localFrameDirectory: string;
  expectedFrameFiles: string[];
  fallbackPath: string;
  reducedMotionPath: string;
  dimensions: '512x512';
  transparency: true;
  fps: 10 | 12;
  approximateDurationMs: number;
  futureStoragePrefix: string;
  sourceMasterPath: string;
  sourceMasterStatus: 'approved-clean-mascot-master';
}

const concept: Record<string, string> = {
  'thank-you-heart': 'Head/body response and a presented heart.',
  'happy-jump': 'Crouch, jump with ears/paws moving, then land.',
  'high-five': 'Raised-paw high five gesture.',
  confetti: 'Joyful body response while confetti appears.',
  'paw-party': 'Playful paw and body movement.',
  'trophy-teaser': 'Notices and presents a trophy.',
  'sleepy-good-night': 'Yawn/blink and calm lowered head.',
  'long-walk': 'Proud energetic reaction for a long walk.',
  'special-surprise': 'Distinctive, tasteful surprise such as a double jump.',
};

/** Exact production brief for the local, offline-first frame packs. No binary artwork is fabricated here. */
export const CELEBRATION_ANIMATION_MANIFEST: CelebrationAnimationManifestEntry[] = [
  'thank-you-heart', 'happy-jump', 'high-five', 'confetti', 'paw-party', 'trophy-teaser', 'sleepy-good-night', 'long-walk', 'special-surprise',
].map((id) => ({
  id,
  visualConcept: concept[id],
  animationType: 'frame-sequence',
  localFrameDirectory: `assets/celebrations/${id}`,
  expectedFrameFiles: Array.from({ length: id === 'sleepy-good-night' ? 18 : 14 }, (_, index) => `frame-${String(index + 1).padStart(2, '0')}.png`),
  fallbackPath: 'assets/branding/walkie-doggy-mascot-transparent.png',
  reducedMotionPath: 'assets/branding/walkie-doggy-mascot-transparent.png',
  dimensions: '512x512',
  transparency: true,
  fps: id === 'sleepy-good-night' ? 10 : 12,
  approximateDurationMs: id === 'sleepy-good-night' ? 2200 : 1800,
  futureStoragePrefix: `celebrations/${id}/v1/`,
  sourceMasterPath: CLEAN_MASCOT_MASTER_ASSET.expectedPath,
  sourceMasterStatus: CLEAN_MASCOT_MASTER_ASSET.status,
}));

export function animationManifestFor(definition: Pick<CelebrationDefinition, 'id'>) {
  return CELEBRATION_ANIMATION_MANIFEST.find((entry) => entry.id === definition.id);
}
