import fs from 'fs';
import path from 'path';
import { MASCOT_FRAME_SETS, MASCOT_FRAME_FPS, framesForCelebration, highFivePoseForCelebration } from '../celebrationAnimationManifest';
import { CELEBRATION_LIBRARY } from '../../logic/walkCompletionCelebration';

/**
 * Real-device QA fix — see celebrationAnimationManifest.ts's own doc
 * comments (above `CELEBRATION_SPRITE_MAP` and `MASCOT_FRAME_SETS`) for the
 * full root-cause analysis of the black-rectangle bug this replaces. This
 * file guards the two things that fix depends on staying true: every
 * celebration resolves to a full, genuinely-transparent 24-frame set, and
 * the sliced frame files on disk were never silently re-flattened.
 *
 * Real-device QA round 6 — `high-five`/`paw-party` no longer render
 * through this discrete-frame-swap path at all (WalkCompletionCelebration
 * now uses MascotPoseCelebration — a single pose, animated via transforms
 * — for those two specifically; see celebrationAnimationManifest.ts's own
 * doc comment above HIGH_FIVE_POSE for why). `framesForCelebration` is
 * back to its original, simple form; `highFivePoseForCelebration` is
 * tested separately below.
 */
describe('MASCOT_FRAME_SETS — discrete per-frame celebration assets', () => {
  it('every sprite id has exactly 24 frames', () => {
    for (const [id, frames] of Object.entries(MASCOT_FRAME_SETS)) {
      expect(frames).toHaveLength(24);
      void id;
    }
  });

  it('every celebration in the library that maps to a sprite resolves the full 24-frame set', () => {
    for (const celebration of CELEBRATION_LIBRARY) {
      const frames = framesForCelebration(celebration.id);
      if (frames) expect(frames).toHaveLength(24);
    }
  });

  it('plays close to the ~24fps source cadence, not the previous half-rate 12fps', () => {
    expect(MASCOT_FRAME_FPS).toBe(24);
  });

  it('framesForCelebration returns undefined for an id with no sprite mapping', () => {
    expect(framesForCelebration('not-a-real-celebration-id')).toBeUndefined();
  });
});

describe('highFivePoseForCelebration — single-pose celebration rendering', () => {
  it('resolves the same real, approved frame for both high-five and paw-party', () => {
    const highFivePose = highFivePoseForCelebration('high-five');
    const pawPartyPose = highFivePoseForCelebration('paw-party');
    expect(highFivePose).toBeTruthy();
    expect(pawPartyPose).toBe(highFivePose);
    // It must be one of the real, approved high-five frames — not invented.
    expect(MASCOT_FRAME_SETS['high-five']).toContain(highFivePose);
  });

  it('returns undefined for every celebration that does not share the high-five sprite', () => {
    for (const celebration of CELEBRATION_LIBRARY) {
      if (celebration.id === 'high-five' || celebration.id === 'paw-party') continue;
      expect(highFivePoseForCelebration(celebration.id)).toBeUndefined();
    }
  });
});

/**
 * Minimal, dependency-free PNG IHDR check: byte 25 of a PNG is the
 * color-type field, and 6 means "RGBA with alpha" (vs. 2 = RGB with no
 * alpha, the shape a flattened/black-background export would have). This
 * does not decode full pixel data — it is a fast, zero-dependency regression
 * guard that the slicing step (or any future re-export) never silently
 * drops the alpha channel the real-device fix depends on.
 */
function pngColorType(filePath: string): number {
  const buffer = Buffer.alloc(26);
  const fd = fs.openSync(filePath, 'r');
  try {
    fs.readSync(fd, buffer, 0, 26, 0);
  } finally {
    fs.closeSync(fd);
  }
  const signatureOk = buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  if (!signatureOk) throw new Error(`${filePath} is not a PNG`);
  return buffer.readUInt8(25);
}

describe('sliced mascot frame PNGs — alpha channel integrity', () => {
  const ASSET_DIR = path.join(__dirname, '../../../assets/mascot-animations');
  const spriteIds = Object.keys(MASCOT_FRAME_SETS);

  it('every sprite directory has frame-01.png through frame-24.png, each declaring RGBA (PNG color type 6)', () => {
    for (const spriteId of spriteIds) {
      for (let i = 1; i <= 24; i++) {
        const frameFile = path.join(ASSET_DIR, spriteId, `frame-${String(i).padStart(2, '0')}.png`);
        expect(fs.existsSync(frameFile)).toBe(true);
        expect(pngColorType(frameFile)).toBe(6);
      }
    }
  });

  it('the original sheets these frames were sliced from also still declare RGBA (never silently re-flattened)', () => {
    for (const spriteId of spriteIds) {
      const sheetFile = path.join(ASSET_DIR, `${spriteId}.png`);
      expect(pngColorType(sheetFile)).toBe(6);
    }
  });
});
