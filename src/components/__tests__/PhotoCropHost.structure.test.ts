import fs from 'fs';

/**
 * PRD §12 — PhotoCropHost is the always-mounted bridge between
 * uploadImage.ts's imperative requestPhotoCrop() and the real
 * PhotoCropModal it renders. Source-scan convention (see
 * PhotoCropModal.structure.test.ts for why a render harness wasn't used).
 */
describe('PhotoCropHost (structural)', () => {
  const source = fs.readFileSync(require.resolve('../PhotoCropHost'), 'utf8').replace(/\r\n/g, '\n');

  it('registers its handler on mount and unregisters it on unmount', () => {
    expect(source).toMatch(/registerPhotoCropHandler\(\s*\(requestedUri\)/);
    expect(source).toMatch(/return \(\) => registerPhotoCropHandler\(null\);/);
  });

  it('is a no-op on native — registers no handler and renders null', () => {
    const effectIdx = source.indexOf('useEffect(() => {');
    expect(source.slice(effectIdx, effectIdx + 120)).toMatch(/if \(Platform\.OS !== 'web'\) return undefined;/);
    expect(source).toMatch(/if \(Platform\.OS !== 'web'\) return null;/);
  });

  it('resolves the pending crop promise on confirm and on cancel, never leaving it hanging', () => {
    expect(source).toMatch(/const handleConfirm = \(croppedUri: string\) => \{/);
    expect(source).toMatch(/resolverRef\.current\?\.\(croppedUri\);/);
    expect(source).toMatch(/const handleCancel = \(\) => \{/);
    expect(source).toMatch(/resolverRef\.current\?\.\(null\);/);
  });

  it('renders PhotoCropModal wired to its own confirm/cancel handlers', () => {
    expect(source).toMatch(
      /<PhotoCropModal visible=\{uri !== null\} uri=\{uri\} onConfirm=\{handleConfirm\} onCancel=\{handleCancel\} \/>/,
    );
  });
});
