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
      /<PhotoCropModal visible uri=\{uri\} onConfirm=\{handleConfirm\} onCancel=\{handleCancel\} \/>/,
    );
  });

  it('renders nothing at all until a crop is actually requested — never mounts <PhotoCropModal>/its <Modal> unconditionally at app start', () => {
    // Bug fix: react-native-web's Modal gives every instance the SAME
    // fixed z-index, so two simultaneously-open Modals stack by plain DOM
    // order. PhotoCropHost lives near App.tsx's root — mounting
    // <PhotoCropModal> (and its underlying <Modal>, which creates its
    // portal <div> immediately on mount regardless of `visible`)
    // unconditionally would permanently put its portal EARLIER in the DOM
    // than any screen-level Modal (e.g. DogDetailsModal) opened later,
    // leaving the crop step rendered behind an already-open modal and
    // completely unreachable. Returning null until uri is set ensures the
    // Modal only mounts (and portals) AFTER whichever screen modal
    // triggered the photo picker is already open.
    expect(source).toMatch(/if \(uri === null\) return null;/);
  });
});
