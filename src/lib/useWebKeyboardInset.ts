import { useEffect, useState } from 'react';
import { Platform } from 'react-native';

/** Anything smaller is browser chrome moving, not an on-screen keyboard. */
const MIN_KEYBOARD_HEIGHT = 120;

/**
 * Pure part of useWebKeyboardInset(): how many CSS pixels at the bottom of
 * the layout viewport are covered by the on-screen keyboard.
 *
 * iOS Safari (and an installed Home Screen PWA) does not resize the layout
 * viewport when the keyboard opens — it only shrinks the VISUAL viewport, so
 * a composer pinned to the bottom of a full-height layout ends up hidden
 * behind the keyboard. A pinch-zoomed page also has a smaller visual
 * viewport, which must not be mistaken for a keyboard.
 */
export function computeKeyboardInset(
  layoutHeight: number,
  visual: { height: number; offsetTop: number; scale: number } | null | undefined
): number {
  if (!visual || !Number.isFinite(layoutHeight)) return 0;
  if (Math.abs(visual.scale - 1) > 0.01) return 0;
  const covered = layoutHeight - visual.height - visual.offsetTop;
  return covered >= MIN_KEYBOARD_HEIGHT ? Math.round(covered) : 0;
}

/** Web only: the current on-screen keyboard overlap in px. Always 0 on native, where KeyboardAvoidingView handles it. */
export function useWebKeyboardInset(): number {
  const [inset, setInset] = useState(0);

  useEffect(() => {
    if (Platform.OS !== 'web' || typeof window === 'undefined') return undefined;
    const viewport = window.visualViewport;
    if (!viewport) return undefined;

    const update = () => {
      const next = computeKeyboardInset(window.innerHeight, viewport);
      setInset((current) => (current === next ? current : next));
      // Safari scrolls the page to reveal a focused field even though the
      // app shell does not scroll; undo that so the header stays in place.
      if (next > 0 && window.scrollY !== 0) window.scrollTo(0, 0);
    };

    update();
    viewport.addEventListener('resize', update);
    viewport.addEventListener('scroll', update);
    return () => {
      viewport.removeEventListener('resize', update);
      viewport.removeEventListener('scroll', update);
    };
  }, []);

  return inset;
}
