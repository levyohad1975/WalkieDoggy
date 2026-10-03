import { DOG_BACKGROUNDS, getDogBackground } from '../dogBackgrounds';

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

  it('still resolves the approved photographic Walkie Park entry by id', () => {
    const match = getDogBackground('walkie-park');
    expect(match?.label).toBe('Walkie Park');
    expect(match?.uri).toMatch(/^https:\/\//);
  });

  it('returns undefined for an unknown id rather than a false match', () => {
    expect(getDogBackground('not-a-real-id')).toBeUndefined();
    expect(getDogBackground(undefined)).toBeUndefined();
  });
});
