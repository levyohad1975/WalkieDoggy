import { registerPhotoCropHandler, requestPhotoCrop } from '../photoCropHost';

/**
 * PRD §12 — the imperative bridge that lets uploadImage.ts (no JSX tree of
 * its own) trigger the web-only crop Modal mounted by PhotoCropHost near
 * App.tsx's root. Pure module logic, no RN/DOM dependency, so this is a
 * genuine unit test rather than the source-scan convention used for the
 * Modal/Host components themselves.
 */
describe('photoCropHost', () => {
  afterEach(() => {
    registerPhotoCropHandler(null);
  });

  it('fails open: resolves to the original uri unchanged when no host is registered', async () => {
    expect(await requestPhotoCrop('file:///local/photo.jpg')).toBe('file:///local/photo.jpg');
  });

  it('delegates to the registered handler and returns whatever it resolves to', async () => {
    const handler = jest.fn().mockResolvedValue('blob:cropped-result');
    registerPhotoCropHandler(handler);

    const result = await requestPhotoCrop('file:///local/photo.jpg');

    expect(handler).toHaveBeenCalledWith('file:///local/photo.jpg');
    expect(result).toBe('blob:cropped-result');
  });

  it('passes through a null resolution (user cancelled the crop step) unchanged', async () => {
    registerPhotoCropHandler(jest.fn().mockResolvedValue(null));

    expect(await requestPhotoCrop('file:///local/photo.jpg')).toBeNull();
  });

  it('unregistering falls back to pass-through again', async () => {
    registerPhotoCropHandler(jest.fn().mockResolvedValue('blob:should-not-be-used'));
    registerPhotoCropHandler(null);

    expect(await requestPhotoCrop('file:///local/photo.jpg')).toBe('file:///local/photo.jpg');
  });
});
