import fs from 'fs';
import path from 'path';

/**
 * PRD §12 — PhotoCropHost must be mounted unconditionally (same
 * "always rendered outside the branching tree" precedent as the
 * isSystemAdmin corner button — see App.systemAdminGate.test.ts) so
 * requestPhotoCrop() from uploadImage.ts always has a live handler to call
 * into once the app is hydrated, regardless of which screen/branch is
 * currently showing.
 */
describe('App.tsx mounts PhotoCropHost (structural)', () => {
  const source = fs.readFileSync(path.resolve(__dirname, '../App.tsx'), 'utf8').replace(/\r\n/g, '\n');

  it('imports PhotoCropHost', () => {
    expect(source).toMatch(/import \{ PhotoCropHost \} from '\.\/src\/components\/PhotoCropHost';/);
  });

  it('renders <PhotoCropHost /> inside the hydrated branch, outside the screen-branching conditional', () => {
    const idx = source.indexOf('<PhotoCropHost />');
    expect(idx).toBeGreaterThan(-1);
    const adminIdx = source.indexOf('SystemAdminScreen visible={systemAdminOpen}');
    expect(adminIdx).toBeGreaterThan(-1);
    expect(idx).toBeGreaterThan(adminIdx);
  });
});
