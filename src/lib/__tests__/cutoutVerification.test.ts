import { act, renderHook, waitFor } from '@testing-library/react-native';
import {
  canCompositeCutout,
  classifyCutoutPixels,
  getCachedCutoutVerdict,
  resetCutoutVerificationCache,
  useCutoutVerdict,
  verifyCutoutTransparency,
  type CutoutPixelSource,
} from '../cutoutVerification';

const W = 48;
const H = 40;

function pixels(alpha: (x: number, y: number) => number): Uint8ClampedArray {
  const data = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y += 1) {
    for (let x = 0; x < W; x += 1) {
      const i = (y * W + x) * 4;
      data[i] = 180;
      data[i + 1] = 140;
      data[i + 2] = 90;
      data[i + 3] = alpha(x, y);
    }
  }
  return data;
}

const transparentDog = pixels((x, y) => {
  const dx = (x - W / 2) / (W * 0.3);
  const dy = (y - H * 0.6) / (H * 0.35);
  return dx * dx + dy * dy < 1 ? 255 : 0;
});
const opaquePhoto = pixels(() => 255);

function source(rgba: Uint8ClampedArray): CutoutPixelSource & { readPixels: jest.Mock } {
  return { readPixels: jest.fn(async () => ({ rgba, width: W, height: H })) };
}

function installLocalStorage(): Map<string, string> {
  const store = new Map<string, string>();
  (globalThis as any).localStorage = {
    getItem: (key: string) => (store.has(key) ? store.get(key)! : null),
    setItem: (key: string, value: string) => store.set(key, value),
    removeItem: (key: string) => store.delete(key),
  };
  return store;
}

beforeEach(() => {
  resetCutoutVerificationCache();
  delete (globalThis as any).localStorage;
  jest.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  (console.warn as jest.Mock).mockRestore?.();
});

describe('client cutout transparency guard', () => {
  it('classifies a real cutout as transparent and an opaque photo as opaque', () => {
    expect(classifyCutoutPixels(transparentDog, W, H)).toBe('transparent');
    expect(classifyCutoutPixels(opaquePhoto, W, H)).toBe('opaque');
  });

  it('rejects a central rectangular remnant even though the outer frame is transparent', () => {
    const rectangle = pixels((x, y) => x >= 8 && x <= 39 && y >= 7 && y <= 32 ? 255 : 0);
    expect(classifyCutoutPixels(rectangle, W, H)).toBe('opaque');
  });

  it('only allows compositing cutouts whose pixels were verified on this client', () => {
    expect(canCompositeCutout('transparent')).toBe(true);
    expect(canCompositeCutout('unverifiable')).toBe(false);
    expect(canCompositeCutout('opaque')).toBe(false);
    expect(canCompositeCutout('pending')).toBe(false);
    expect(canCompositeCutout('none')).toBe(false);
  });

  it('marks a persisted opaque cutout as opaque so Home never draws the rectangle', async () => {
    await expect(verifyCutoutTransparency('https://x/cutouts/opaque.png', source(opaquePhoto))).resolves.toBe('opaque');
  });

  it('fails closed when pixels cannot be read (network/CORS) and retries next launch', async () => {
    const store = installLocalStorage();
    const failing = { readPixels: jest.fn(async () => { throw new Error('cors'); }) };
    await expect(verifyCutoutTransparency('https://x/cutouts/flaky.png', failing)).resolves.toBe('unverifiable');
    expect(store.size).toBe(0);
    await expect(verifyCutoutTransparency('https://x/cutouts/flaky.png', null)).resolves.toBe('unverifiable');
    expect(canCompositeCutout('unverifiable')).toBe(false);
  });

  it('deduplicates concurrent checks and caches the verdict for refreshes', async () => {
    const src = source(transparentDog);
    const url = 'https://x/cutouts/dog-1.png';
    const [a, b] = await Promise.all([verifyCutoutTransparency(url, src), verifyCutoutTransparency(url, src)]);
    expect([a, b]).toEqual(['transparent', 'transparent']);
    expect(src.readPixels).toHaveBeenCalledTimes(1);
    await verifyCutoutTransparency(url, src);
    expect(src.readPixels).toHaveBeenCalledTimes(1);
  });

  it('remembers definitive verdicts across app relaunches (page refresh) via localStorage', async () => {
    const store = installLocalStorage();
    const url = 'https://x/cutouts/opaque-legacy.png';
    await verifyCutoutTransparency(url, source(opaquePhoto));
    expect([...store.values()]).toEqual(['opaque']);

    resetCutoutVerificationCache(); // simulates a reload: in-memory cache gone
    expect(getCachedCutoutVerdict(url)).toBe('opaque');
    const again = source(transparentDog);
    await expect(verifyCutoutTransparency(url, again)).resolves.toBe('opaque');
    expect(again.readPixels).not.toHaveBeenCalled();
  });

  it('ignores verdicts cached by the previous (looser) rules after an app update', async () => {
    const store = installLocalStorage();
    const url = 'https://x/cutouts/kept-room.png';
    // What an iPhone running 766a56f stored for the false-positive cutout.
    store.set(`walkie.cutoutVerdict.v2:${url}`, 'transparent');
    expect(getCachedCutoutVerdict(url)).toBeUndefined();
    const recheck = source(opaquePhoto);
    await expect(verifyCutoutTransparency(url, recheck)).resolves.toBe('opaque');
    expect(recheck.readPixels).toHaveBeenCalledTimes(1);
    expect(store.get(`walkie.cutoutVerdict.v3:${url}`)).toBe('opaque');
  });

  it('re-verifies when a new upload produces a new cutout URL', async () => {
    installLocalStorage();
    await verifyCutoutTransparency('https://x/cutouts/dog-old.png', source(opaquePhoto));
    await expect(verifyCutoutTransparency('https://x/cutouts/dog-new.png', source(transparentDog))).resolves.toBe('transparent');
  });

  it('hook: hides the cutout while pending, then reveals a transparent one', async () => {
    const src = source(transparentDog);
    let release!: () => void;
    src.readPixels.mockImplementationOnce(() => new Promise<{ rgba: ArrayLike<number>; width: number; height: number }>((resolve) => {
      release = () => resolve({ rgba: transparentDog, width: W, height: H });
    }));
    const { result } = renderHook(() => useCutoutVerdict('https://x/cutouts/hook.png', src));
    expect(result.current).toBe('pending');
    expect(canCompositeCutout(result.current)).toBe(false);
    await act(async () => release());
    await waitFor(() => expect(result.current).toBe('transparent'));
  });

  it('hook: reports opaque for a bad cutout and none when the photo is removed', async () => {
    const src = source(opaquePhoto);
    const { result, rerender } = renderHook(({ url }: { url?: string }) => useCutoutVerdict(url, src), {
      initialProps: { url: 'https://x/cutouts/hook-opaque.png' as string | undefined },
    });
    await waitFor(() => expect(result.current).toBe('opaque'));
    rerender({ url: undefined });
    expect(result.current).toBe('none');
  });

  it('does not reuse a previous URL verdict for a newly regenerated cutout, even for the first render', async () => {
    const src = source(transparentDog);
    const { result, rerender } = renderHook(({ url }: { url: string }) => useCutoutVerdict(url, src), {
      initialProps: { url: 'https://x/cutouts/old.png' },
    });
    await waitFor(() => expect(result.current).toBe('transparent'));
    rerender({ url: 'https://x/cutouts/new.png' });
    expect(result.current).toBe('pending');
    await waitFor(() => expect(src.readPixels).toHaveBeenCalledTimes(2));
  });
});
