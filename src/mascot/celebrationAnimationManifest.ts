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


/**
 * Curated sprite sheets generated from the approved OpenArt source videos.
 * Each sheet is 6 columns x 4 rows, 256px cells, 24 frames with alpha.
 * Only animations that have a distinct production use are exposed here.
 * Extracted source sprites can remain in assets for QA without becoming
 * runtime celebrations.
 */
export const CURATED_MASCOT_SPRITE_SHEETS = {
  'high-five': {
    source: require('../../assets/mascot-animations/high-five.png'),
    columns: 6, rows: 4, frameSize: 256, frameCount: 24, fps: 12, transparent: true,
  },
  'happy-spin': {
    source: require('../../assets/mascot-animations/happy-spin.png'),
    columns: 6, rows: 4, frameSize: 256, frameCount: 24, fps: 12, transparent: true,
  },
  'trophy-winner': {
    source: require('../../assets/mascot-animations/trophy-winner.png'),
    columns: 6, rows: 4, frameSize: 256, frameCount: 24, fps: 12, transparent: true,
  },
  'sleepy-good-night': {
    source: require('../../assets/mascot-animations/sleepy-good-night.png'),
    columns: 6, rows: 4, frameSize: 256, frameCount: 24, fps: 12, transparent: true,
  },
  'peek-a-boo': {
    source: require('../../assets/mascot-animations/peek-a-boo.png'),
    columns: 6, rows: 4, frameSize: 256, frameCount: 24, fps: 12, transparent: true,
  },
  'leash-ready': {
    source: require('../../assets/mascot-animations/leash-ready.png'),
    columns: 6, rows: 4, frameSize: 256, frameCount: 24, fps: 12, transparent: true,
  },
  'curious-listen': {
    source: require('../../assets/mascot-animations/curious-listen.png'),
    columns: 6, rows: 4, frameSize: 256, frameCount: 24, fps: 12, transparent: true,
  },
} as const;

export type CuratedMascotSpriteId = keyof typeof CURATED_MASCOT_SPRITE_SHEETS;

/**
 * The generated sprite sheets are retained as source/QA assets, but are not
 * served at runtime until every frame pack passes transparent-alpha visual QA
 * on Safari/iOS. A sheet with flattened black pixels cannot be repaired by a
 * React Native style; using the approved transparent mascot is the safe
 * runtime fallback and guarantees no black rectangle behind the character.
 */
const CELEBRATION_SPRITE_MAP: Partial<Record<string, CuratedMascotSpriteId>> = {
  // Only the rebuilt Kling high-five sheet has passed the current alpha
  // processing gate. Keep every other legacy sheet out of Safari/iOS runtime
  // until it is regenerated and visually approved; the celebration component
  // will render the clean transparent mascot fallback instead.
  'thank-you-heart': 'high-five',
  'high-five': 'high-five',
  'paw-party': 'high-five',
};

/**
 * These runtime sheets are the post-processed PNG exports with real alpha
 * (transparent pixels), not the original flattened video frames that caused
 * the black rectangle on Safari/iOS. Keep the mapping explicit so every
 * celebration has a reviewed transparent animation or falls back safely.
 */
export function curatedSpriteForCelebration(id: string): (typeof CURATED_MASCOT_SPRITE_SHEETS)[CuratedMascotSpriteId] | undefined {
  const spriteId = CELEBRATION_SPRITE_MAP[id];
  return spriteId ? CURATED_MASCOT_SPRITE_SHEETS[spriteId] : undefined;
}
