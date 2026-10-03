import fs from 'fs';
import path from 'path';

/**
 * Real-device QA bug: Dog Settings' background picker showed two
 * simultaneous checkmarks for "Walkie Park" because a hardcoded illustrated
 * tile (<WalkieParkBackground />, draftId === 'walkie-park') coexisted with
 * the photographic 'walkie-park' entry already in DOG_BACKGROUNDS — both
 * bound to the same id, both rendering their own `selected`/checkmark. There
 * is no React Native component-rendering test infrastructure for this file
 * (matching every other screen/component test in this repo — see e.g.
 * HomeScreen.dogScene.test.ts's own doc comment), so this asserts directly
 * against the source: every tile must be driven by DOG_BACKGROUNDS/the
 * explicit "default" branch only, never by a second hardcoded id.
 */
describe('DogHeroBackgroundPicker — single-select source guard', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '../DogHeroBackgroundPicker.tsx'),
    'utf8'
  );

  it('no longer imports or renders the retired illustrated WalkieParkBackground component', () => {
    expect(source).not.toContain('WalkieParkBackground');
  });

  it('never hardcodes the walkie-park id as a second, separate tile', () => {
    expect(source).not.toContain("'walkie-park'");
    expect(source).not.toContain('"walkie-park"');
  });

  it('renders exactly one Pressable per DOG_BACKGROUNDS item plus the one default tile', () => {
    const pressableCount = source.match(/<Pressable/g)?.length ?? 0;
    expect(pressableCount).toBe(2); // the default tile + the single DOG_BACKGROUNDS.map() tile
  });

  it('derives selection/checkmark state from draftId === item.id — one id, one tile', () => {
    expect(source).toContain('const selected = draftId === item.id;');
  });
});
