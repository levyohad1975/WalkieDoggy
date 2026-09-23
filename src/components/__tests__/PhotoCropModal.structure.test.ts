import fs from 'fs';

/**
 * PRD §12 — profile-photo crop/zoom/pan, web-only (native already has
 * OS-native crop via expo-image-picker's allowsEditing — see
 * uploadImage.ts). Source-scan convention: this repo has no render-test
 * harness for gesture/canvas-heavy modals (see MascotFrameAnimation.test.tsx
 * for where a genuine render test was worth the setup instead — PanResponder
 * gesture simulation + a fully stubbed <canvas>/Image DOM here would be a
 * lot of scaffolding for a component that is itself a thin, readable
 * wrapper over well-established primitives).
 */
describe('PhotoCropModal (structural)', () => {
  const source = fs.readFileSync(require.resolve('../PhotoCropModal'), 'utf8').replace(/\r\n/g, '\n');

  it('renders nothing on native platforms — Web-only, no new native dependency', () => {
    expect(source).toMatch(/if \(Platform\.OS !== 'web'\) return null;/);
  });

  it('uses PanResponder (core React Native) for panning, not a new gesture-handling dependency', () => {
    expect(source).toMatch(/PanResponder\.create\(/);
    expect(source).toMatch(/onPanResponderMove/);
  });

  it('zoom is plain +/- step buttons, not pinch-gesture math', () => {
    expect(source).toMatch(/const handleZoomIn = \(\)/);
    expect(source).toMatch(/const handleZoomOut = \(\)/);
    expect(source).toMatch(/MIN_ZOOM/);
    expect(source).toMatch(/MAX_ZOOM/);
  });

  it('clamps pan so the image can never reveal empty space inside the viewport', () => {
    expect(source).toMatch(/const clampPan = useCallback/);
    expect(source).toMatch(/Math\.min\(maxPanX, Math\.max\(-maxPanX, x\)\)/);
  });

  it('produces the actual pixel crop with a plain HTML5 canvas, only on confirm', () => {
    expect(source).toMatch(/document\.createElement\('canvas'\)/);
    expect(source).toMatch(/ctx\.drawImage\(/);
    expect(source).toMatch(/canvas\.toBlob\(/);
  });

  it('cancelling resolves via onCancel, never silently swallowed', () => {
    expect(source).toMatch(/onPress=\{onCancel\}/);
  });
});
