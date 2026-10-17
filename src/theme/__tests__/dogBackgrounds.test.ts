import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { DEFAULT_DOG_BACKGROUND, DOG_BACKGROUNDS, getDogBackground, getDogBackgroundImageSource } from '../dogBackgrounds';

/**
 * Regression coverage for the real-device QA bug where Dog Settings showed
 * two simultaneous checkmarks for "Walkie Park": DOG_BACKGROUNDS already
 * carried a photographic 'walkie-park' entry, while DogHeroBackgroundPicker
 * separately hardcoded a second, illustrated tile using the very same id.
 * Both tiles lit up together on selection and both were labeled identically.
 * The fix removed the hardcoded illustrated tile; this test guards the data
 * source itself so a future addition can't reintroduce the same collision.
 */
describe('DOG_BACKGROUNDS', () => {
  it('has no duplicate ids — true single-select depends on a 1:1 id-to-tile mapping', () => {
    const ids = DOG_BACKGROUNDS.map((item) => item.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('has no duplicate visible labels — e.g. two entries both called "Walkie Park"', () => {
    const labels = DOG_BACKGROUNDS.map((item) => item.label);
    expect(new Set(labels).size).toBe(labels.length);
  });

  it('resolves the Walkie Park selection to the approved bundled park asset (4761eb1)', () => {
    const match = getDogBackground('walkie-park');
    expect(match?.label).toBe('Walkie Park');
    // Pinned to the exact user-approved bundled image, never a remote photo.
    expect(match?.source).toBe(DEFAULT_DOG_BACKGROUND.source);
    expect(match?.uri).toBeUndefined();
    expect(getDogBackgroundImageSource(match!)).toBe(DEFAULT_DOG_BACKGROUND.source);
  });

  it('uses the bundled approved park as the implicit and legacy default', () => {
    expect(getDogBackground()).toBe(DEFAULT_DOG_BACKGROUND);
    expect(getDogBackground('walkie-default-park')).toBe(DEFAULT_DOG_BACKGROUND);
    expect(DEFAULT_DOG_BACKGROUND.source).toBeDefined();
    expect(DEFAULT_DOG_BACKGROUND.uri).toBeUndefined();
    expect(getDogBackgroundImageSource(DEFAULT_DOG_BACKGROUND)).toBe(DEFAULT_DOG_BACKGROUND.source);
  });

  it('bundles the exact user-approved default park image bytes', () => {
    const imagePath = path.resolve(__dirname, '../../../assets/images/walkie-default-park.jpg');
    const sha256 = crypto.createHash('sha256').update(fs.readFileSync(imagePath)).digest('hex');

    expect(sha256).toBe('fbd7de06881962b7f9bf269d445e023cb26572d5209c00b8a304ef4218e5feed');
  });

  it('preserves an explicitly selected family background', () => {
    // 'walkie-park' now renders the bundled default itself, so a remote-backed
    // selection is what proves an explicit choice is never swapped for it.
    const selected = getDogBackground('dog-park');
    expect(selected?.id).toBe('dog-park');
    expect(selected?.uri).toMatch(/^https:\/\//);
    expect(getDogBackgroundImageSource(selected!)).toEqual({ uri: selected!.uri });
    expect(getDogBackgroundImageSource(selected!)).not.toBe(DEFAULT_DOG_BACKGROUND.source);
  });

  it('returns undefined for an unknown id rather than a false match', () => {
    expect(getDogBackground('not-a-real-id')).toBeUndefined();
  });
});
