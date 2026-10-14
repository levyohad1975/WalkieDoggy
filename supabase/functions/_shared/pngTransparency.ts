// Shared, dependency-free transparency verification for generated dog
// cutouts.
//
// Why this exists: the Home hero composites `dogs.photo_cutout_url` directly
// over the family's background photo. If that file has no real alpha (an
// opaque PNG, a re-encoded original, a JPEG), the dog shows up as a
// rectangle with its original background. The background-removal provider is
// an external, best-effort service, so its output must be verified before it
// is ever persisted (Edge Function) and before it is ever composited (client
// safety net for cutouts persisted before verification existed).
//
// This file is imported by the Deno Edge Function and by the Expo client, so
// it must stay plain TypeScript: no imports, no Deno/Node/DOM globals.

/** Alpha at or below this is "see-through" background. */
export const TRANSPARENT_ALPHA_MAX = 16;
/** Alpha at or above this is solid subject. */
export const OPAQUE_ALPHA_MIN = 240;
/**
 * At least this share of the image must be removed background. Real-iPhone
 * QA (2026-10-14) produced a provider "cutout" that kept the room around the
 * dog: only 16.5% transparent, all above the head. Genuine cutouts measured
 * 55–60%; a frame-filling close-up still clears 20%.
 */
export const MIN_TRANSPARENT_FRACTION = 0.2;
/** Below this the image is effectively opaque (no background removal at all). */
export const FULLY_OPAQUE_TRANSPARENT_FRACTION = 0.04;
/** At least this share of the image must be visible subject. */
export const MIN_OPAQUE_FRACTION = 0.02;
/**
 * At least this share of the outer frame must be transparent. A cutout whose
 * edges are solid is exactly the "rectangle over the hero" failure, even if a
 * few interior pixels happen to be transparent.
 */
export const MIN_BORDER_TRANSPARENT_FRACTION = 0.25;
/** An edge is "solid" when at least this share of it is opaque subject. */
export const SOLID_EDGE_OPAQUE_FRACTION = 0.5;
/**
 * A dog may legitimately run off the bottom edge (cropped legs) or one side,
 * but when three or four edges are solid the result is a photo block with
 * its background, not a cutout — the exact rectangle seen on the hero.
 */
export const MAX_SOLID_EDGES = 2;

export interface EdgeStats {
  samples: number;
  opaque: number;
}

export interface AlphaStats {
  width: number;
  height: number;
  /** Pixels actually inspected (large images are sampled on a grid). */
  sampledPixels: number;
  transparentPixels: number;
  opaquePixels: number;
  borderPixels: number;
  borderTransparentPixels: number;
  edges: { top: EdgeStats; bottom: EdgeStats; left: EdgeStats; right: EdgeStats };
}

export type CutoutRejectionReason =
  | 'not_png'
  | 'corrupt_png'
  | 'unsupported_png'
  | 'no_alpha_channel'
  | 'fully_opaque'
  | 'opaque_border'
  | 'background_kept'
  | 'rectangular_subject'
  | 'empty_subject';

export type CutoutVerdict =
  | { ok: true; stats: AlphaStats }
  | { ok: false; reason: CutoutRejectionReason; stats?: AlphaStats };

/** Applies the shared thresholds to alpha statistics (server and client). */
export function judgeAlphaStats(stats: AlphaStats): CutoutVerdict {
  const total = Math.max(1, stats.sampledPixels);
  const transparentFraction = stats.transparentPixels / total;
  if (transparentFraction < FULLY_OPAQUE_TRANSPARENT_FRACTION) {
    return { ok: false, reason: 'fully_opaque', stats };
  }
  if (transparentFraction < MIN_TRANSPARENT_FRACTION) {
    return { ok: false, reason: 'background_kept', stats };
  }
  if (stats.opaquePixels / total < MIN_OPAQUE_FRACTION) {
    return { ok: false, reason: 'empty_subject', stats };
  }
  const border = Math.max(1, stats.borderPixels);
  if (stats.borderTransparentPixels / border < MIN_BORDER_TRANSPARENT_FRACTION) {
    return { ok: false, reason: 'opaque_border', stats };
  }
  if (countSolidEdges(stats) > MAX_SOLID_EDGES) {
    return { ok: false, reason: 'rectangular_subject', stats };
  }
  return { ok: true, stats };
}

/** Number of frame edges that are mostly solid subject. */
export function countSolidEdges(stats: AlphaStats): number {
  return [stats.edges.top, stats.edges.bottom, stats.edges.left, stats.edges.right]
    .filter((edge) => edge.samples > 0 && edge.opaque / edge.samples >= SOLID_EDGE_OPAQUE_FRACTION)
    .length;
}

/** Collects alpha statistics from straight RGBA bytes (e.g. canvas ImageData). */
export function alphaStatsFromRgba(rgba: ArrayLike<number>, width: number, height: number): AlphaStats {
  const stats = emptyStats(width, height);
  for (let y = 0; y < height; y += 1) {
    const rowOffset = y * width * 4;
    for (let x = 0; x < width; x += 1) {
      recordPixel(stats, x, y, rgba[rowOffset + x * 4 + 3]);
    }
  }
  return stats;
}

const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];
/** Keep the sampled grid near this many pixels on the long side. */
const SAMPLE_LONG_SIDE = 512;

export function isPng(bytes: Uint8Array): boolean {
  if (bytes.length < PNG_SIGNATURE.length) return false;
  return PNG_SIGNATURE.every((value, index) => bytes[index] === value);
}

/**
 * Inflates zlib data incrementally. The Edge Function passes a
 * DecompressionStream('deflate') reader; tests pass Node's zlib.
 */
export type InflateChunks = (zlibData: Uint8Array) => AsyncIterable<Uint8Array>;

/**
 * Decodes the PNG's alpha channel row by row (only two scanlines are held at
 * a time, so a 12 MP cutout does not need a full RGBA buffer) and judges it.
 */
export async function analyzePngTransparency(png: Uint8Array, inflate: InflateChunks): Promise<CutoutVerdict> {
  if (!isPng(png)) return { ok: false, reason: 'not_png' };

  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = -1;
  let interlace = 0;
  let trns: Uint8Array | null = null;
  const idatParts: Uint8Array[] = [];
  let idatLength = 0;

  let offset = 8;
  while (offset + 8 <= png.length) {
    const length = readUint32(png, offset);
    const type = String.fromCharCode(png[offset + 4], png[offset + 5], png[offset + 6], png[offset + 7]);
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    if (dataEnd + 4 > png.length) return { ok: false, reason: 'corrupt_png' };
    const data = png.subarray(dataStart, dataEnd);
    if (type === 'IHDR') {
      if (length < 13) return { ok: false, reason: 'corrupt_png' };
      width = readUint32(data, 0);
      height = readUint32(data, 4);
      bitDepth = data[8];
      colorType = data[9];
      interlace = data[12];
    } else if (type === 'tRNS') {
      trns = data;
    } else if (type === 'IDAT') {
      idatParts.push(data);
      idatLength += data.length;
    } else if (type === 'IEND') {
      break;
    }
    offset = dataEnd + 4; // skip CRC
  }

  if (width <= 0 || height <= 0 || idatLength === 0) return { ok: false, reason: 'corrupt_png' };

  const hasAlphaChannel = colorType === 4 || colorType === 6;
  if (!hasAlphaChannel && !trns) return { ok: false, reason: 'no_alpha_channel' };

  const channels = channelCount(colorType);
  if (channels === 0 || interlace !== 0 || !supportedDepth(colorType, bitDepth)) {
    return { ok: false, reason: 'unsupported_png' };
  }

  const bitsPerPixel = channels * bitDepth;
  const bytesPerPixel = Math.max(1, bitsPerPixel >> 3);
  const stride = Math.ceil((width * bitsPerPixel) / 8);
  const alphaAt = makeAlphaReader(colorType, bitDepth, trns);

  const idat = new Uint8Array(idatLength);
  let cursor = 0;
  for (const part of idatParts) {
    idat.set(part, cursor);
    cursor += part.length;
  }

  const stats = emptyStats(width, height);
  const step = Math.max(1, Math.ceil(Math.max(width, height) / SAMPLE_LONG_SIDE));
  let previous = new Uint8Array(stride);
  let current = new Uint8Array(stride);
  const pending = new Uint8Array(stride + 1);
  let pendingLength = 0;
  let y = 0;

  try {
    for await (const chunk of inflate(idat)) {
      let index = 0;
      while (index < chunk.length && y < height) {
        const take = Math.min(stride + 1 - pendingLength, chunk.length - index);
        pending.set(chunk.subarray(index, index + take), pendingLength);
        pendingLength += take;
        index += take;
        if (pendingLength < stride + 1) continue;

        const filter = pending[0];
        if (filter > 4) return { ok: false, reason: 'corrupt_png' };
        unfilterRow(filter, pending, current, previous, bytesPerPixel);
        if (y % step === 0 || y === height - 1) {
          for (let x = 0; x < width; x += 1) {
            if (x % step !== 0 && x !== width - 1) continue;
            recordPixel(stats, x, y, alphaAt(current, x));
          }
        }
        const swap = previous;
        previous = current;
        current = swap;
        pendingLength = 0;
        y += 1;
      }
      if (y >= height) break;
    }
  } catch {
    return { ok: false, reason: 'corrupt_png' };
  }

  if (y < height) return { ok: false, reason: 'corrupt_png' };
  return judgeAlphaStats(stats);
}

function emptyStats(width: number, height: number): AlphaStats {
  return {
    width,
    height,
    sampledPixels: 0,
    transparentPixels: 0,
    opaquePixels: 0,
    borderPixels: 0,
    borderTransparentPixels: 0,
    edges: {
      top: { samples: 0, opaque: 0 },
      bottom: { samples: 0, opaque: 0 },
      left: { samples: 0, opaque: 0 },
      right: { samples: 0, opaque: 0 },
    },
  };
}

function recordPixel(stats: AlphaStats, x: number, y: number, alpha: number): void {
  stats.sampledPixels += 1;
  const transparent = alpha <= TRANSPARENT_ALPHA_MAX;
  if (transparent) stats.transparentPixels += 1;
  else if (alpha >= OPAQUE_ALPHA_MIN) stats.opaquePixels += 1;
  if (x === 0 || y === 0 || x === stats.width - 1 || y === stats.height - 1) {
    stats.borderPixels += 1;
    if (transparent) stats.borderTransparentPixels += 1;
    const opaque = alpha >= OPAQUE_ALPHA_MIN;
    if (y === 0) countEdge(stats.edges.top, opaque);
    if (y === stats.height - 1) countEdge(stats.edges.bottom, opaque);
    if (x === 0) countEdge(stats.edges.left, opaque);
    if (x === stats.width - 1) countEdge(stats.edges.right, opaque);
  }
}

function countEdge(edge: EdgeStats, opaque: boolean): void {
  edge.samples += 1;
  if (opaque) edge.opaque += 1;
}

function readUint32(bytes: Uint8Array, at: number): number {
  return ((bytes[at] << 24) | (bytes[at + 1] << 16) | (bytes[at + 2] << 8) | bytes[at + 3]) >>> 0;
}

function channelCount(colorType: number): number {
  switch (colorType) {
    case 0: return 1; // grayscale
    case 2: return 3; // RGB
    case 3: return 1; // palette index
    case 4: return 2; // grayscale + alpha
    case 6: return 4; // RGBA
    default: return 0;
  }
}

function supportedDepth(colorType: number, bitDepth: number): boolean {
  if (colorType === 3) return bitDepth === 1 || bitDepth === 2 || bitDepth === 4 || bitDepth === 8;
  return bitDepth === 8 || bitDepth === 16;
}

function makeAlphaReader(colorType: number, bitDepth: number, trns: Uint8Array | null): (row: Uint8Array, x: number) => number {
  const wide = bitDepth === 16;
  if (colorType === 6) return wide ? (row, x) => row[x * 8 + 6] : (row, x) => row[x * 4 + 3];
  if (colorType === 4) return wide ? (row, x) => row[x * 4 + 2] : (row, x) => row[x * 2 + 1];
  if (colorType === 3) {
    const table = trns ?? new Uint8Array(0);
    const perByte = 8 / bitDepth;
    const mask = (1 << bitDepth) - 1;
    return (row, x) => {
      const byte = row[Math.floor(x / perByte)];
      const shift = 8 - bitDepth * ((x % perByte) + 1);
      const paletteIndex = (byte >> shift) & mask;
      return paletteIndex < table.length ? table[paletteIndex] : 255;
    };
  }
  // Grayscale / RGB with a single tRNS colour key (stored as 16-bit samples).
  const key = trns ?? new Uint8Array(0);
  const samples = colorType === 2 ? 3 : 1;
  const bytesPerSample = wide ? 2 : 1;
  return (row, x) => {
    const base = x * samples * bytesPerSample;
    for (let s = 0; s < samples; s += 1) {
      const sample = wide
        ? (row[base + s * 2] << 8) | row[base + s * 2 + 1]
        : row[base + s];
      const keySample = (key[s * 2] << 8) | key[s * 2 + 1];
      if (sample !== keySample) return 255;
    }
    return 0;
  };
}

function unfilterRow(filter: number, raw: Uint8Array, out: Uint8Array, prev: Uint8Array, bpp: number): void {
  const length = out.length;
  for (let i = 0; i < length; i += 1) {
    const value = raw[i + 1];
    const left = i >= bpp ? out[i - bpp] : 0;
    const up = prev[i];
    const upLeft = i >= bpp ? prev[i - bpp] : 0;
    let predictor = 0;
    switch (filter) {
      case 1: predictor = left; break;
      case 2: predictor = up; break;
      case 3: predictor = (left + up) >> 1; break;
      case 4: predictor = paeth(left, up, upLeft); break;
      default: predictor = 0;
    }
    out[i] = (value + predictor) & 0xff;
  }
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
