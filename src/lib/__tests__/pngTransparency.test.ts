import zlib from 'zlib';
import {
  analyzePngTransparency,
  alphaStatsFromRgba,
  judgeAlphaStats,
  isPng,
  type InflateChunks,
} from '../../../supabase/functions/_shared/pngTransparency';

// ---------------------------------------------------------------------------
// Minimal PNG encoder for fixtures. The decoder ignores CRCs, so they are 0.
// Each row is written with a rotating filter type (None/Sub/Up/Average/Paeth)
// so the decoder's unfiltering is exercised against every predictor.
// ---------------------------------------------------------------------------
function chunk(type: string, data: Uint8Array): Buffer {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, 'ascii');
  return Buffer.concat([head, Buffer.from(data), Buffer.alloc(4)]);
}

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

interface EncodeOptions {
  width: number;
  height: number;
  colorType: number;
  bitDepth?: number;
  /** Raw (unfiltered) scanline bytes for row y. */
  row: (y: number) => number[];
  trns?: number[];
  plte?: number[];
  interlace?: number;
  idatSplit?: number;
}

function encodePng(opts: EncodeOptions): Uint8Array {
  const bitDepth = opts.bitDepth ?? 8;
  const channelsByType: Record<number, number> = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };
  const channels = channelsByType[opts.colorType];
  const bpp = Math.max(1, (channels * bitDepth) >> 3);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(opts.width, 0);
  ihdr.writeUInt32BE(opts.height, 4);
  ihdr[8] = bitDepth;
  ihdr[9] = opts.colorType;
  ihdr[12] = opts.interlace ?? 0;

  const raw: number[] = [];
  let prev: number[] = [];
  for (let y = 0; y < opts.height; y += 1) {
    const cur = opts.row(y);
    if (prev.length === 0) prev = new Array(cur.length).fill(0);
    const filter = y % 5;
    raw.push(filter);
    for (let i = 0; i < cur.length; i += 1) {
      const left = i >= bpp ? cur[i - bpp] : 0;
      const up = prev[i];
      const upLeft = i >= bpp ? prev[i - bpp] : 0;
      const predictor = [0, left, up, (left + up) >> 1, paeth(left, up, upLeft)][filter];
      raw.push((cur[i] - predictor) & 0xff);
    }
    prev = cur;
  }
  const compressed = zlib.deflateSync(Buffer.from(raw));
  const split = opts.idatSplit ?? compressed.length;
  const idats: Buffer[] = [];
  for (let at = 0; at < compressed.length; at += split) idats.push(chunk('IDAT', compressed.subarray(at, at + split)));

  return new Uint8Array(Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    ...(opts.plte ? [chunk('PLTE', Uint8Array.from(opts.plte))] : []),
    ...(opts.trns ? [chunk('tRNS', Uint8Array.from(opts.trns))] : []),
    ...idats,
    chunk('IEND', new Uint8Array(0)),
  ]));
}

/** Streams the inflated data in small pieces to exercise row reassembly. */
const nodeInflate: InflateChunks = async function* (data) {
  const out = zlib.inflateSync(Buffer.from(data));
  for (let at = 0; at < out.length; at += 37) yield new Uint8Array(out.subarray(at, at + 37));
};

/** Soft-edged "dog" ellipse in the lower-middle of the frame, like a real cutout. */
function dogAlpha(x: number, y: number, w: number, h: number): number {
  const dx = (x - w * 0.5) / (w * 0.32);
  const dy = (y - h * 0.62) / (h * 0.34);
  const d = Math.sqrt(dx * dx + dy * dy);
  if (d <= 0.9) return 255;
  if (d >= 1.05) return 0;
  return Math.round(255 * (1.05 - d) / 0.15); // fur-like feathered edge
}

function rgbaRow(w: number, h: number, alpha: (x: number, y: number) => number) {
  return (y: number) => {
    const row: number[] = [];
    for (let x = 0; x < w; x += 1) row.push((x * 7) & 0xff, (y * 5) & 0xff, 120, alpha(x, y));
    return row;
  };
}

describe('generated dog cutout transparency verification', () => {
  const W = 120;
  const H = 100;

  it('accepts a genuine RGBA cutout with a transparent surround and feathered fur edges', async () => {
    const png = encodePng({ width: W, height: H, colorType: 6, row: rgbaRow(W, H, (x, y) => dogAlpha(x, y, W, H)) });
    const verdict = await analyzePngTransparency(png, nodeInflate);
    expect(verdict.ok).toBe(true);
    if (verdict.ok) {
      expect(verdict.stats.transparentPixels / verdict.stats.sampledPixels).toBeGreaterThan(0.3);
      expect(verdict.stats.borderTransparentPixels).toBe(verdict.stats.borderPixels);
    }
  });

  it('accepts a cutout whose dog touches the bottom edge (cropped legs)', async () => {
    const png = encodePng({
      width: W,
      height: H,
      colorType: 6,
      row: rgbaRow(W, H, (x, y) => (y > H * 0.4 && x > W * 0.2 && x < W * 0.8 ? 255 : 0)),
    });
    expect((await analyzePngTransparency(png, nodeInflate)).ok).toBe(true);
  });

  it('rejects an RGBA PNG that is fully opaque (the rectangular-background regression)', async () => {
    const png = encodePng({ width: W, height: H, colorType: 6, row: rgbaRow(W, H, () => 255) });
    await expect(analyzePngTransparency(png, nodeInflate)).resolves.toMatchObject({ ok: false, reason: 'fully_opaque' });
  });

  it('rejects a PNG with no alpha channel at all (original photo re-encoded as RGB)', async () => {
    const png = encodePng({
      width: W,
      height: H,
      colorType: 2,
      row: (y) => Array.from({ length: W * 3 }, (_, i) => (i + y) & 0xff),
    });
    await expect(analyzePngTransparency(png, nodeInflate)).resolves.toEqual({ ok: false, reason: 'no_alpha_channel' });
  });

  it('rejects a JPEG or any non-PNG payload', async () => {
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 16, 74, 70, 73, 70, 0]);
    expect(isPng(jpeg)).toBe(false);
    await expect(analyzePngTransparency(jpeg, nodeInflate)).resolves.toEqual({ ok: false, reason: 'not_png' });
  });

  it('rejects a cutout with a solid frame around a transparent hole (opaque border / white strip)', async () => {
    const png = encodePng({
      width: W,
      height: H,
      colorType: 6,
      row: rgbaRow(W, H, (x, y) => (x < 8 || y < 8 || x >= W - 8 || y >= H - 8 ? 255 : y > H / 2 ? 255 : 0)),
    });
    await expect(analyzePngTransparency(png, nodeInflate)).resolves.toMatchObject({ ok: false, reason: 'opaque_border' });
  });

  it('rejects an empty (fully transparent) result where the dog was erased', async () => {
    const png = encodePng({ width: W, height: H, colorType: 6, row: rgbaRow(W, H, () => 0) });
    await expect(analyzePngTransparency(png, nodeInflate)).resolves.toMatchObject({ ok: false, reason: 'empty_subject' });
  });

  it('reads 16-bit RGBA, grey+alpha and palette+tRNS cutouts', async () => {
    const rgba16 = encodePng({
      width: W,
      height: H,
      colorType: 6,
      bitDepth: 16,
      row: (y) => {
        const row: number[] = [];
        for (let x = 0; x < W; x += 1) {
          const a = dogAlpha(x, y, W, H);
          row.push(1, 2, 3, 4, 5, 6, a, a);
        }
        return row;
      },
    });
    expect((await analyzePngTransparency(rgba16, nodeInflate)).ok).toBe(true);

    const greyAlpha = encodePng({
      width: W,
      height: H,
      colorType: 4,
      row: (y) => Array.from({ length: W }, (_, x) => [90, dogAlpha(x, y, W, H)]).flat(),
    });
    expect((await analyzePngTransparency(greyAlpha, nodeInflate)).ok).toBe(true);

    const palette = encodePng({
      width: W,
      height: H,
      colorType: 3,
      plte: [0, 0, 0, 200, 150, 100],
      trns: [0],
      row: (y) => Array.from({ length: W }, (_, x) => (dogAlpha(x, y, W, H) > 128 ? 1 : 0)),
    });
    expect((await analyzePngTransparency(palette, nodeInflate)).ok).toBe(true);
  });

  it('handles image data split across several IDAT chunks', async () => {
    const png = encodePng({ width: W, height: H, colorType: 6, idatSplit: 50, row: rgbaRow(W, H, (x, y) => dogAlpha(x, y, W, H)) });
    expect((await analyzePngTransparency(png, nodeInflate)).ok).toBe(true);
  });

  it('samples large photos on a grid without losing the verdict', async () => {
    const big = { w: 1300, h: 1100 };
    const png = encodePng({ width: big.w, height: big.h, colorType: 6, row: rgbaRow(big.w, big.h, (x, y) => dogAlpha(x, y, big.w, big.h)) });
    const verdict = await analyzePngTransparency(png, nodeInflate);
    expect(verdict.ok).toBe(true);
    if (verdict.ok) expect(verdict.stats.sampledPixels).toBeLessThan(big.w * big.h / 4);
  });

  it('reports truncated or corrupt image data instead of accepting it', async () => {
    const png = encodePng({ width: W, height: H, colorType: 6, row: rgbaRow(W, H, (x, y) => dogAlpha(x, y, W, H)) });
    const truncated = png.subarray(0, png.length - 40);
    await expect(analyzePngTransparency(truncated, nodeInflate)).resolves.toMatchObject({ ok: false });
    const interlaced = encodePng({ width: W, height: H, colorType: 6, interlace: 1, row: rgbaRow(W, H, () => 0) });
    await expect(analyzePngTransparency(interlaced, nodeInflate)).resolves.toEqual({ ok: false, reason: 'unsupported_png' });
  });

  it('applies the same thresholds to canvas RGBA pixels on the client', () => {
    const w = 40;
    const h = 30;
    const opaque = new Uint8ClampedArray(w * h * 4).fill(255);
    expect(judgeAlphaStats(alphaStatsFromRgba(opaque, w, h))).toMatchObject({ ok: false, reason: 'fully_opaque' });
    const cut = new Uint8ClampedArray(w * h * 4);
    for (let y = 0; y < h; y += 1) for (let x = 0; x < w; x += 1) cut[(y * w + x) * 4 + 3] = dogAlpha(x, y, w, h);
    expect(judgeAlphaStats(alphaStatsFromRgba(cut, w, h)).ok).toBe(true);
  });
});
