import type { ImageSourcePropType } from 'react-native';
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
  'tail-wag': {
    source: require('../../assets/mascot-animations/tail-wag.png'),
    columns: 6, rows: 4, frameSize: 256, frameCount: 24, fps: 12, transparent: true,
  },
  'curious-listen': {
    source: require('../../assets/mascot-animations/curious-listen.png'),
    columns: 6, rows: 4, frameSize: 256, frameCount: 24, fps: 12, transparent: true,
  },
} as const;

export type CuratedMascotSpriteId = keyof typeof CURATED_MASCOT_SPRITE_SHEETS;

/**
 * Real-device QA found a solid BLACK rectangle behind the mascot on iPhone
 * Safari/PWA for some of these. The sheets themselves were cleared first —
 * every sheet is a genuine RGBA PNG with a real 0-255 alpha range and
 * transparent edges, with no ICC/gamma chunk present either, so this is not
 * corrupted or flattened artwork. The actual cause is MascotSpriteAnimation's
 * own technique: it renders the FULL 1536x1024 sheet as one absolutely
 * positioned, oversized Image layer (24x a single visible cell's pixel
 * area) and clips it down to one ~84x84 cell with an ancestor
 * `overflow: hidden` View — itself nested inside MascotSafeZone's own
 * `overflow: hidden` stage. A GPU layer that is mostly off-screen/clipped,
 * combined with alpha and non-native scaling, is a known WebKit/iOS Safari
 * compositing defect class: the backing store can rasterize opaque black
 * instead of honoring alpha, especially in standalone PWA mode. This map
 * and `curatedSpriteForCelebration` are kept as a general-purpose sheet
 * utility (and are still covered by MascotSpriteAnimation's own tests), but
 * `WalkCompletionCelebration` no longer renders celebrations through them —
 * see `MASCOT_FRAME_SETS`/`framesForCelebration` below for the technique it
 * uses instead.
 */
const CELEBRATION_SPRITE_MAP: Record<string, CuratedMascotSpriteId> = {
  // Use the distinct transparent sprite packs already bundled in the app.
  // The static approved mascot remains the reduced-motion fallback.
  'thank-you-heart': 'tail-wag',
  'happy-jump': 'happy-spin',
  'high-five': 'high-five',
  'confetti': 'happy-spin',
  'paw-party': 'high-five',
  'trophy-teaser': 'trophy-winner',
  'sleepy-good-night': 'sleepy-good-night',
  'long-walk': 'leash-ready',
  'special-surprise': 'peek-a-boo',
};

/**
 * These post-processed PNG sheets have real per-pixel alpha (verified
 * byte-for-byte — see the comment above `CELEBRATION_SPRITE_MAP`), not the
 * original flattened video frames. Kept as a general sheet-lookup utility;
 * `WalkCompletionCelebration` itself now uses `framesForCelebration` instead
 * (same mapping, discrete-frame rendering technique — see that function's
 * own doc comment for why).
 */
export function curatedSpriteForCelebration(id: string): (typeof CURATED_MASCOT_SPRITE_SHEETS)[CuratedMascotSpriteId] | undefined {
  const spriteId = CELEBRATION_SPRITE_MAP[id];
  return spriteId ? CURATED_MASCOT_SPRITE_SHEETS[spriteId] : undefined;
}

/**
 * Discrete per-frame transparent PNGs, sliced losslessly from the curated
 * sprite sheets above (see assets/mascot-animations/<id>/frame-NN.png) —
 * each file is an exact crop of the already-approved sheet, re-encoded with
 * Pillow; no pixel was generated, redrawn, or altered, and every sliced
 * frame's alpha channel was individually re-verified after slicing.
 *
 * This is the technique `WalkCompletionCelebration` actually renders
 * through. Unlike MascotSpriteAnimation's single-oversized-layer sheet crop
 * (see `CELEBRATION_SPRITE_MAP`'s doc comment for the real-device bug that
 * technique caused), MascotFrameAnimation swaps a plain `Image`'s `source`
 * once per tick inside a container that is always exactly its own display
 * size (`resizeMode="contain"`, no absolute positioning, no layer larger
 * than what is actually visible) — the same technique already shipping
 * safely in OnboardingMascotWink. There is no GPU layer that is mostly
 * clipped away, so the WebKit compositing defect class this file's other
 * comments describe cannot occur here regardless of ancestor
 * `overflow: hidden` wrappers.
 */
export const MASCOT_FRAME_SETS: Record<CuratedMascotSpriteId, ImageSourcePropType[]> = {
  'high-five': [
    require('../../assets/mascot-animations/high-five/frame-01.png'),
    require('../../assets/mascot-animations/high-five/frame-02.png'),
    require('../../assets/mascot-animations/high-five/frame-03.png'),
    require('../../assets/mascot-animations/high-five/frame-04.png'),
    require('../../assets/mascot-animations/high-five/frame-05.png'),
    require('../../assets/mascot-animations/high-five/frame-06.png'),
    require('../../assets/mascot-animations/high-five/frame-07.png'),
    require('../../assets/mascot-animations/high-five/frame-08.png'),
    require('../../assets/mascot-animations/high-five/frame-09.png'),
    require('../../assets/mascot-animations/high-five/frame-10.png'),
    require('../../assets/mascot-animations/high-five/frame-11.png'),
    require('../../assets/mascot-animations/high-five/frame-12.png'),
    require('../../assets/mascot-animations/high-five/frame-13.png'),
    require('../../assets/mascot-animations/high-five/frame-14.png'),
    require('../../assets/mascot-animations/high-five/frame-15.png'),
    require('../../assets/mascot-animations/high-five/frame-16.png'),
    require('../../assets/mascot-animations/high-five/frame-17.png'),
    require('../../assets/mascot-animations/high-five/frame-18.png'),
    require('../../assets/mascot-animations/high-five/frame-19.png'),
    require('../../assets/mascot-animations/high-five/frame-20.png'),
    require('../../assets/mascot-animations/high-five/frame-21.png'),
    require('../../assets/mascot-animations/high-five/frame-22.png'),
    require('../../assets/mascot-animations/high-five/frame-23.png'),
    require('../../assets/mascot-animations/high-five/frame-24.png'),
  ],
  'happy-spin': [
    require('../../assets/mascot-animations/happy-spin/frame-01.png'),
    require('../../assets/mascot-animations/happy-spin/frame-02.png'),
    require('../../assets/mascot-animations/happy-spin/frame-03.png'),
    require('../../assets/mascot-animations/happy-spin/frame-04.png'),
    require('../../assets/mascot-animations/happy-spin/frame-05.png'),
    require('../../assets/mascot-animations/happy-spin/frame-06.png'),
    require('../../assets/mascot-animations/happy-spin/frame-07.png'),
    require('../../assets/mascot-animations/happy-spin/frame-08.png'),
    require('../../assets/mascot-animations/happy-spin/frame-09.png'),
    require('../../assets/mascot-animations/happy-spin/frame-10.png'),
    require('../../assets/mascot-animations/happy-spin/frame-11.png'),
    require('../../assets/mascot-animations/happy-spin/frame-12.png'),
    require('../../assets/mascot-animations/happy-spin/frame-13.png'),
    require('../../assets/mascot-animations/happy-spin/frame-14.png'),
    require('../../assets/mascot-animations/happy-spin/frame-15.png'),
    require('../../assets/mascot-animations/happy-spin/frame-16.png'),
    require('../../assets/mascot-animations/happy-spin/frame-17.png'),
    require('../../assets/mascot-animations/happy-spin/frame-18.png'),
    require('../../assets/mascot-animations/happy-spin/frame-19.png'),
    require('../../assets/mascot-animations/happy-spin/frame-20.png'),
    require('../../assets/mascot-animations/happy-spin/frame-21.png'),
    require('../../assets/mascot-animations/happy-spin/frame-22.png'),
    require('../../assets/mascot-animations/happy-spin/frame-23.png'),
    require('../../assets/mascot-animations/happy-spin/frame-24.png'),
  ],
  'trophy-winner': [
    require('../../assets/mascot-animations/trophy-winner/frame-01.png'),
    require('../../assets/mascot-animations/trophy-winner/frame-02.png'),
    require('../../assets/mascot-animations/trophy-winner/frame-03.png'),
    require('../../assets/mascot-animations/trophy-winner/frame-04.png'),
    require('../../assets/mascot-animations/trophy-winner/frame-05.png'),
    require('../../assets/mascot-animations/trophy-winner/frame-06.png'),
    require('../../assets/mascot-animations/trophy-winner/frame-07.png'),
    require('../../assets/mascot-animations/trophy-winner/frame-08.png'),
    require('../../assets/mascot-animations/trophy-winner/frame-09.png'),
    require('../../assets/mascot-animations/trophy-winner/frame-10.png'),
    require('../../assets/mascot-animations/trophy-winner/frame-11.png'),
    require('../../assets/mascot-animations/trophy-winner/frame-12.png'),
    require('../../assets/mascot-animations/trophy-winner/frame-13.png'),
    require('../../assets/mascot-animations/trophy-winner/frame-14.png'),
    require('../../assets/mascot-animations/trophy-winner/frame-15.png'),
    require('../../assets/mascot-animations/trophy-winner/frame-16.png'),
    require('../../assets/mascot-animations/trophy-winner/frame-17.png'),
    require('../../assets/mascot-animations/trophy-winner/frame-18.png'),
    require('../../assets/mascot-animations/trophy-winner/frame-19.png'),
    require('../../assets/mascot-animations/trophy-winner/frame-20.png'),
    require('../../assets/mascot-animations/trophy-winner/frame-21.png'),
    require('../../assets/mascot-animations/trophy-winner/frame-22.png'),
    require('../../assets/mascot-animations/trophy-winner/frame-23.png'),
    require('../../assets/mascot-animations/trophy-winner/frame-24.png'),
  ],
  'sleepy-good-night': [
    require('../../assets/mascot-animations/sleepy-good-night/frame-01.png'),
    require('../../assets/mascot-animations/sleepy-good-night/frame-02.png'),
    require('../../assets/mascot-animations/sleepy-good-night/frame-03.png'),
    require('../../assets/mascot-animations/sleepy-good-night/frame-04.png'),
    require('../../assets/mascot-animations/sleepy-good-night/frame-05.png'),
    require('../../assets/mascot-animations/sleepy-good-night/frame-06.png'),
    require('../../assets/mascot-animations/sleepy-good-night/frame-07.png'),
    require('../../assets/mascot-animations/sleepy-good-night/frame-08.png'),
    require('../../assets/mascot-animations/sleepy-good-night/frame-09.png'),
    require('../../assets/mascot-animations/sleepy-good-night/frame-10.png'),
    require('../../assets/mascot-animations/sleepy-good-night/frame-11.png'),
    require('../../assets/mascot-animations/sleepy-good-night/frame-12.png'),
    require('../../assets/mascot-animations/sleepy-good-night/frame-13.png'),
    require('../../assets/mascot-animations/sleepy-good-night/frame-14.png'),
    require('../../assets/mascot-animations/sleepy-good-night/frame-15.png'),
    require('../../assets/mascot-animations/sleepy-good-night/frame-16.png'),
    require('../../assets/mascot-animations/sleepy-good-night/frame-17.png'),
    require('../../assets/mascot-animations/sleepy-good-night/frame-18.png'),
    require('../../assets/mascot-animations/sleepy-good-night/frame-19.png'),
    require('../../assets/mascot-animations/sleepy-good-night/frame-20.png'),
    require('../../assets/mascot-animations/sleepy-good-night/frame-21.png'),
    require('../../assets/mascot-animations/sleepy-good-night/frame-22.png'),
    require('../../assets/mascot-animations/sleepy-good-night/frame-23.png'),
    require('../../assets/mascot-animations/sleepy-good-night/frame-24.png'),
  ],
  'peek-a-boo': [
    require('../../assets/mascot-animations/peek-a-boo/frame-01.png'),
    require('../../assets/mascot-animations/peek-a-boo/frame-02.png'),
    require('../../assets/mascot-animations/peek-a-boo/frame-03.png'),
    require('../../assets/mascot-animations/peek-a-boo/frame-04.png'),
    require('../../assets/mascot-animations/peek-a-boo/frame-05.png'),
    require('../../assets/mascot-animations/peek-a-boo/frame-06.png'),
    require('../../assets/mascot-animations/peek-a-boo/frame-07.png'),
    require('../../assets/mascot-animations/peek-a-boo/frame-08.png'),
    require('../../assets/mascot-animations/peek-a-boo/frame-09.png'),
    require('../../assets/mascot-animations/peek-a-boo/frame-10.png'),
    require('../../assets/mascot-animations/peek-a-boo/frame-11.png'),
    require('../../assets/mascot-animations/peek-a-boo/frame-12.png'),
    require('../../assets/mascot-animations/peek-a-boo/frame-13.png'),
    require('../../assets/mascot-animations/peek-a-boo/frame-14.png'),
    require('../../assets/mascot-animations/peek-a-boo/frame-15.png'),
    require('../../assets/mascot-animations/peek-a-boo/frame-16.png'),
    require('../../assets/mascot-animations/peek-a-boo/frame-17.png'),
    require('../../assets/mascot-animations/peek-a-boo/frame-18.png'),
    require('../../assets/mascot-animations/peek-a-boo/frame-19.png'),
    require('../../assets/mascot-animations/peek-a-boo/frame-20.png'),
    require('../../assets/mascot-animations/peek-a-boo/frame-21.png'),
    require('../../assets/mascot-animations/peek-a-boo/frame-22.png'),
    require('../../assets/mascot-animations/peek-a-boo/frame-23.png'),
    require('../../assets/mascot-animations/peek-a-boo/frame-24.png'),
  ],
  'leash-ready': [
    require('../../assets/mascot-animations/leash-ready/frame-01.png'),
    require('../../assets/mascot-animations/leash-ready/frame-02.png'),
    require('../../assets/mascot-animations/leash-ready/frame-03.png'),
    require('../../assets/mascot-animations/leash-ready/frame-04.png'),
    require('../../assets/mascot-animations/leash-ready/frame-05.png'),
    require('../../assets/mascot-animations/leash-ready/frame-06.png'),
    require('../../assets/mascot-animations/leash-ready/frame-07.png'),
    require('../../assets/mascot-animations/leash-ready/frame-08.png'),
    require('../../assets/mascot-animations/leash-ready/frame-09.png'),
    require('../../assets/mascot-animations/leash-ready/frame-10.png'),
    require('../../assets/mascot-animations/leash-ready/frame-11.png'),
    require('../../assets/mascot-animations/leash-ready/frame-12.png'),
    require('../../assets/mascot-animations/leash-ready/frame-13.png'),
    require('../../assets/mascot-animations/leash-ready/frame-14.png'),
    require('../../assets/mascot-animations/leash-ready/frame-15.png'),
    require('../../assets/mascot-animations/leash-ready/frame-16.png'),
    require('../../assets/mascot-animations/leash-ready/frame-17.png'),
    require('../../assets/mascot-animations/leash-ready/frame-18.png'),
    require('../../assets/mascot-animations/leash-ready/frame-19.png'),
    require('../../assets/mascot-animations/leash-ready/frame-20.png'),
    require('../../assets/mascot-animations/leash-ready/frame-21.png'),
    require('../../assets/mascot-animations/leash-ready/frame-22.png'),
    require('../../assets/mascot-animations/leash-ready/frame-23.png'),
    require('../../assets/mascot-animations/leash-ready/frame-24.png'),
  ],
  'tail-wag': [
    require('../../assets/mascot-animations/tail-wag/frame-01.png'),
    require('../../assets/mascot-animations/tail-wag/frame-02.png'),
    require('../../assets/mascot-animations/tail-wag/frame-03.png'),
    require('../../assets/mascot-animations/tail-wag/frame-04.png'),
    require('../../assets/mascot-animations/tail-wag/frame-05.png'),
    require('../../assets/mascot-animations/tail-wag/frame-06.png'),
    require('../../assets/mascot-animations/tail-wag/frame-07.png'),
    require('../../assets/mascot-animations/tail-wag/frame-08.png'),
    require('../../assets/mascot-animations/tail-wag/frame-09.png'),
    require('../../assets/mascot-animations/tail-wag/frame-10.png'),
    require('../../assets/mascot-animations/tail-wag/frame-11.png'),
    require('../../assets/mascot-animations/tail-wag/frame-12.png'),
    require('../../assets/mascot-animations/tail-wag/frame-13.png'),
    require('../../assets/mascot-animations/tail-wag/frame-14.png'),
    require('../../assets/mascot-animations/tail-wag/frame-15.png'),
    require('../../assets/mascot-animations/tail-wag/frame-16.png'),
    require('../../assets/mascot-animations/tail-wag/frame-17.png'),
    require('../../assets/mascot-animations/tail-wag/frame-18.png'),
    require('../../assets/mascot-animations/tail-wag/frame-19.png'),
    require('../../assets/mascot-animations/tail-wag/frame-20.png'),
    require('../../assets/mascot-animations/tail-wag/frame-21.png'),
    require('../../assets/mascot-animations/tail-wag/frame-22.png'),
    require('../../assets/mascot-animations/tail-wag/frame-23.png'),
    require('../../assets/mascot-animations/tail-wag/frame-24.png'),
  ],
  'curious-listen': [
    require('../../assets/mascot-animations/curious-listen/frame-01.png'),
    require('../../assets/mascot-animations/curious-listen/frame-02.png'),
    require('../../assets/mascot-animations/curious-listen/frame-03.png'),
    require('../../assets/mascot-animations/curious-listen/frame-04.png'),
    require('../../assets/mascot-animations/curious-listen/frame-05.png'),
    require('../../assets/mascot-animations/curious-listen/frame-06.png'),
    require('../../assets/mascot-animations/curious-listen/frame-07.png'),
    require('../../assets/mascot-animations/curious-listen/frame-08.png'),
    require('../../assets/mascot-animations/curious-listen/frame-09.png'),
    require('../../assets/mascot-animations/curious-listen/frame-10.png'),
    require('../../assets/mascot-animations/curious-listen/frame-11.png'),
    require('../../assets/mascot-animations/curious-listen/frame-12.png'),
    require('../../assets/mascot-animations/curious-listen/frame-13.png'),
    require('../../assets/mascot-animations/curious-listen/frame-14.png'),
    require('../../assets/mascot-animations/curious-listen/frame-15.png'),
    require('../../assets/mascot-animations/curious-listen/frame-16.png'),
    require('../../assets/mascot-animations/curious-listen/frame-17.png'),
    require('../../assets/mascot-animations/curious-listen/frame-18.png'),
    require('../../assets/mascot-animations/curious-listen/frame-19.png'),
    require('../../assets/mascot-animations/curious-listen/frame-20.png'),
    require('../../assets/mascot-animations/curious-listen/frame-21.png'),
    require('../../assets/mascot-animations/curious-listen/frame-22.png'),
    require('../../assets/mascot-animations/curious-listen/frame-23.png'),
    require('../../assets/mascot-animations/curious-listen/frame-24.png'),
  ],
};

/**
 * The real source material is ~24fps; the original sprite-sheet playback
 * ran it at half that (`fps: 12` above). All 24 frames were already being
 * extracted — only the playback rate was throttled — so this is purely a
 * smoothness fix, not a new-asset change. `WalkCompletionCelebration` plays
 * these frames at `MASCOT_FRAME_FPS`, close to the original cadence.
 */
export const MASCOT_FRAME_FPS = 24;

export function framesForCelebration(id: string): ImageSourcePropType[] | undefined {
  const spriteId = CELEBRATION_SPRITE_MAP[id];
  return spriteId ? MASCOT_FRAME_SETS[spriteId] : undefined;
}
