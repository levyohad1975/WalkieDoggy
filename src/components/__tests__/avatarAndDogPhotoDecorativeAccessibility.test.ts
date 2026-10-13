import fs from 'fs';
import path from 'path';

/**
 * QA sweep: `Avatar`/`DogPhoto` have no `name` prop, so they can't build a
 * meaningful accessibilityLabel, yet every caller already shows the
 * person's/dog's name as adjacent text (or as an interactive parent's own
 * label). Without `accessible={false}` on the wrapping `View`, the bare
 * photo `<Image>` (RN's `Image` is an accessibility element by default) or
 * the emoji fallback `<RtlText>` becomes its own untitled screen-reader
 * stop, duplicating identity info already available elsewhere. Verifies
 * both components mark their wrapper decorative, via this repo's
 * established source-scan convention for RN components with no
 * render-test harness.
 */
const TARGET_FILES: Array<[string, string]> = [
  ['../Avatar.tsx', 'styles.circle'],
  ['../DogPhoto.tsx', 'styles.circle'],
];

describe('Avatar/DogPhoto wrapper View -> accessible={false}', () => {
  for (const [relativeFile, styleExpr] of TARGET_FILES) {
    it(`${relativeFile}'s wrapping <View style={[${styleExpr}, ...]}> carries accessible={false}`, () => {
      const source = fs.readFileSync(path.resolve(__dirname, relativeFile), 'utf8');
      const tagPattern = new RegExp(`<View[^>]*style=\\{\\[\\s*${styleExpr.replace('.', '\\.')}[^]*?>`, 'g');
      const matches = source.match(tagPattern) ?? [];
      expect(matches.length).toBe(1);
      expect(matches[0]).toContain('accessible={false}');
    });
  }
});

describe('Avatar replacement photo recovery', () => {
  it('retries loading when a new photo URL replaces a previously failed one', () => {
    const source = fs.readFileSync(path.resolve(__dirname, '../Avatar.tsx'), 'utf8');
    expect(source).toContain("useEffect(() => setFailed(false), [photoUrl]);");
  });
});
