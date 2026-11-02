import { useEffect, useState } from 'react';
import { Platform } from 'react-native';
import { alphaStatsFromRgba, judgeAlphaStats } from '../../supabase/functions/_shared/pngTransparency';

/**
 * Client safety net for `dogs.photo_cutout_url`.
 *
 * The Edge Function now refuses to persist a non-transparent cutout, but rows
 * written before that check (and anything written by a future regression)
 * can still point at an opaque image. Compositing such a file over the hero
 * background is exactly the "rectangle with the original background" bug, so
 * the Home hero only composites a cutout whose alpha has been checked here.
 *
 * Verdicts:
 * - `transparent`  — genuine cutout; composite it.
 * - `opaque`       — no usable transparency; never composite, show mascot.
 * - `unverifiable` — could not inspect (network/CORS/no canvas); fail closed
 *                    and show the approved mascot.
 * - `pending`      — still checking; the slot stays visually empty.
 * - `none`         — no cutout URL.
 */
export type CutoutVerdictState = 'none' | 'pending' | 'transparent' | 'opaque' | 'unverifiable';
type SettledVerdict = Exclude<CutoutVerdictState, 'none' | 'pending'>;

// v3 discards older permissive verdicts and reruns the current geometry gate.
const STORAGE_PREFIX = 'walkie.cutoutVerdict.v3:';
/** The analysis is downscaled to this long side; plenty to see a background. */
const ANALYSIS_LONG_SIDE = 160;
// Production 2026-11-02: a family member's first launch on cellular showed the
// mascot instead of the dog. The ~0.9 MB cutout competes with every other
// first-launch download, so the old 8 s limit failed closed. The check runs
// in the background with the mascot showing, so it can afford to wait.
const VERIFY_TIMEOUT_MS = 20000;
/** Retries after an unverifiable check while the hero stays on screen. */
export const CUTOUT_RETRY_DELAYS_MS = [3000, 15000, 45000];

const settled = new Map<string, SettledVerdict>();
const inflight = new Map<string, Promise<SettledVerdict>>();

export interface CutoutPixelSource {
  /** Returns straight RGBA pixels of the image at `url`, downscaled. */
  readPixels: (url: string) => Promise<{ rgba: ArrayLike<number>; width: number; height: number }>;
}

/** Pure classification of downscaled RGBA pixels with the shared thresholds. */
export function classifyCutoutPixels(rgba: ArrayLike<number>, width: number, height: number): 'transparent' | 'opaque' {
  return judgeAlphaStats(alphaStatsFromRgba(rgba, width, height)).ok ? 'transparent' : 'opaque';
}

export function getCachedCutoutVerdict(url: string | undefined | null): SettledVerdict | undefined {
  if (!url) return undefined;
  const memory = settled.get(url);
  if (memory) return memory;
  const stored = readStoredVerdict(url);
  if (stored) settled.set(url, stored);
  return stored;
}

export function verifyCutoutTransparency(url: string, source: CutoutPixelSource | null = defaultPixelSource()): Promise<SettledVerdict> {
  const cached = getCachedCutoutVerdict(url);
  if (cached) return Promise.resolve(cached);
  const running = inflight.get(url);
  if (running) return running;

  const job = (async (): Promise<SettledVerdict> => {
    if (!source) return 'unverifiable';
    try {
      const { rgba, width, height } = await source.readPixels(url);
      if (!width || !height) return 'unverifiable';
      return classifyCutoutPixels(rgba, width, height);
    } catch (error) {
      console.warn('Dog cutout transparency check unavailable; trusting server verification:', error);
      return 'unverifiable';
    }
  })().then((verdict) => {
    inflight.delete(url);
    // Only definitive answers are remembered (in memory and across launches);
    // a transient network failure must be retried, not cached for the session.
    if (verdict !== 'unverifiable') {
      settled.set(url, verdict);
      writeStoredVerdict(url, verdict);
    }
    return verdict;
  });
  inflight.set(url, job);
  return job;
}

/** Test seam: forget cached verdicts. */
export function resetCutoutVerificationCache(): void {
  settled.clear();
  inflight.clear();
}

export function useCutoutVerdict(url: string | undefined | null, source?: CutoutPixelSource | null): CutoutVerdictState {
  const normalizedUrl = url ?? null;
  const [result, setResult] = useState<{ url: string | null; state: CutoutVerdictState }>(() => ({
    url: normalizedUrl,
    state: normalizedUrl ? getCachedCutoutVerdict(normalizedUrl) ?? 'pending' : 'none',
  }));

  useEffect(() => {
    if (!url) {
      setResult({ url: null, state: 'none' });
      return;
    }
    const cached = getCachedCutoutVerdict(url);
    if (cached) {
      setResult({ url, state: cached });
      return;
    }
    setResult({ url, state: 'pending' });
    let active = true;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    const pixelSource = source === undefined ? defaultPixelSource() : source;
    const attempt = (index: number) => {
      void verifyCutoutTransparency(url, pixelSource).then((verdict) => {
        if (!active) return;
        setResult({ url, state: verdict });
        // Unverifiable = could not read the image (slow network, timeout).
        // Keep the mascot and try again rather than waiting for a relaunch.
        if (verdict === 'unverifiable' && pixelSource && index < CUTOUT_RETRY_DELAYS_MS.length) {
          retryTimer = setTimeout(() => attempt(index + 1), CUTOUT_RETRY_DELAYS_MS[index]);
        }
      });
    };
    attempt(0);
    return () => {
      active = false;
      if (retryTimer) clearTimeout(retryTimer);
    };
  }, [url, source]);

  if (!normalizedUrl) return 'none';
  if (result.url !== normalizedUrl) return getCachedCutoutVerdict(normalizedUrl) ?? 'pending';
  return result.state;
}

/** Whether a verdict allows the cutout to be composited over the hero. */
export function canCompositeCutout(state: CutoutVerdictState): boolean {
  return state === 'transparent';
}

function defaultPixelSource(): CutoutPixelSource | null {
  if (Platform.OS !== 'web') return null;
  const g = globalThis as any;
  if (typeof g.fetch !== 'function' || typeof g.createImageBitmap !== 'function' || typeof g.document === 'undefined') {
    return null;
  }
  return {
    async readPixels(url: string) {
      const controller = typeof g.AbortController === 'function' ? new g.AbortController() : null;
      const timer = controller ? setTimeout(() => controller.abort(), VERIFY_TIMEOUT_MS) : null;
      try {
        // Fetching the bytes (rather than drawing an <img>) keeps the canvas
        // same-origin even when Safari already cached a non-CORS copy of the
        // image for the hero <img>, so getImageData never throws on taint.
        const response = await g.fetch(url, { mode: 'cors', credentials: 'omit', signal: controller?.signal });
        if (!response.ok) throw new Error(`cutout fetch ${response.status}`);
        const blob = await response.blob();
        const bitmap = await g.createImageBitmap(blob);
        const scale = Math.min(1, ANALYSIS_LONG_SIDE / Math.max(bitmap.width, bitmap.height));
        const width = Math.max(1, Math.round(bitmap.width * scale));
        const height = Math.max(1, Math.round(bitmap.height * scale));
        const canvas = g.document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const context = canvas.getContext('2d', { willReadFrequently: true });
        if (!context) throw new Error('2d canvas unavailable');
        context.clearRect(0, 0, width, height);
        context.drawImage(bitmap, 0, 0, width, height);
        if (typeof bitmap.close === 'function') bitmap.close();
        const { data } = context.getImageData(0, 0, width, height);
        // Release the backing store promptly; iPhone Safari caps canvas memory.
        canvas.width = 0;
        canvas.height = 0;
        return { rgba: data, width, height };
      } finally {
        if (timer) clearTimeout(timer);
      }
    },
  };
}

function readStoredVerdict(url: string): SettledVerdict | undefined {
  try {
    const storage = (globalThis as any).localStorage;
    const value = storage?.getItem(STORAGE_PREFIX + url);
    return value === 'transparent' || value === 'opaque' ? value : undefined;
  } catch {
    return undefined;
  }
}

function writeStoredVerdict(url: string, verdict: SettledVerdict): void {
  try {
    (globalThis as any).localStorage?.setItem(STORAGE_PREFIX + url, verdict);
  } catch {
    // Private mode / storage disabled: verdict stays in memory only.
  }
}
