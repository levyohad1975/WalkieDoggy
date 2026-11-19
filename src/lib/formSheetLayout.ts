import { useContext, useEffect, useState } from 'react';
import { Platform, useWindowDimensions } from 'react-native';
import { SafeAreaInsetsContext } from 'react-native-safe-area-context';
import { useWebKeyboardInset } from './useWebKeyboardInset';

/** The sheet never covers more than this share of the screen, so the backdrop stays visible and tappable. */
export const FORM_SHEET_MAX_FRACTION = 0.88;
/** Minimum strip of backdrop kept above the sheet, below any top safe area (notch / Dynamic Island). */
export const FORM_SHEET_TOP_GAP = 24;
/** Minimum breathing room under the action footer when there is no home indicator or keyboard. */
export const FORM_SHEET_FOOTER_MIN_PADDING = 12;

export interface FormSheetLayoutInput {
  /** Height of the box the modal fills (web: the layout viewport, `window.innerHeight`). */
  viewportHeight: number;
  /** Pixels at the bottom of that box covered by the on-screen keyboard (web only; native uses KeyboardAvoidingView). */
  keyboardInset: number;
  safeAreaTop: number;
  safeAreaBottom: number;
}

export interface FormSheetLayout {
  /** Explicit sheet height in px, or undefined when the viewport size is not known yet. */
  sheetHeight: number | undefined;
  /** Lifts the sheet above the on-screen keyboard. */
  backdropPaddingBottom: number;
  /** Keeps the action footer clear of the home indicator (no extra gap when the keyboard already covers it). */
  footerPaddingBottom: number;
}

function nonNegative(value: number): number {
  return Number.isFinite(value) && value > 0 ? value : 0;
}

/**
 * Pure sizing for a bottom sheet whose body scrolls and whose action footer
 * must always stay on screen (iPhone Safari / Home Screen PWA).
 *
 * The sheet is sized in pixels from the real viewport instead of a CSS
 * percentage chain, and shrinks by the keyboard overlap, because iOS Safari
 * does not resize the layout viewport for the keyboard — it only covers it.
 */
export function computeFormSheetLayout(input: FormSheetLayoutInput): FormSheetLayout {
  const viewportHeight = nonNegative(input.viewportHeight);
  const keyboardInset = nonNegative(input.keyboardInset);
  const safeAreaTop = nonNegative(input.safeAreaTop);
  const safeAreaBottom = nonNegative(input.safeAreaBottom);

  const footerPaddingBottom = keyboardInset > 0
    ? FORM_SHEET_FOOTER_MIN_PADDING
    : Math.max(safeAreaBottom, FORM_SHEET_FOOTER_MIN_PADDING);

  if (viewportHeight === 0) {
    return { sheetHeight: undefined, backdropPaddingBottom: keyboardInset, footerPaddingBottom };
  }

  const available = viewportHeight - keyboardInset - safeAreaTop - FORM_SHEET_TOP_GAP;
  const sheetHeight = Math.max(0, Math.floor(Math.min(viewportHeight * FORM_SHEET_MAX_FRACTION, available)));
  return { sheetHeight, backdropPaddingBottom: keyboardInset, footerPaddingBottom };
}

function readWebViewportHeight(): number {
  if (typeof window === 'undefined') return 0;
  return window.innerHeight || window.document?.documentElement?.clientHeight || 0;
}

/** Web: the live layout-viewport height (what a full-screen fixed modal fills). Native: the window height. */
function useViewportHeight(): number {
  const { height: windowHeight } = useWindowDimensions();
  const [webHeight, setWebHeight] = useState(() => (Platform.OS === 'web' ? readWebViewportHeight() : 0));

  useEffect(() => {
    if (Platform.OS !== 'web' || typeof window === 'undefined' || typeof window.addEventListener !== 'function') return undefined;
    const update = () => {
      const next = readWebViewportHeight();
      setWebHeight((current) => (current === next ? current : next));
    };
    update();
    window.addEventListener('resize', update);
    window.addEventListener('orientationchange', update);
    return () => {
      window.removeEventListener('resize', update);
      window.removeEventListener('orientationchange', update);
    };
  }, []);

  return Platform.OS === 'web' ? webHeight || windowHeight : windowHeight;
}

/** Live layout for a bottom form sheet with a scrollable body and a pinned action footer. */
export function useFormSheetLayout(): FormSheetLayout {
  // Read the context directly so a sheet rendered without a provider (tests,
  // an early boot path) falls back to zero insets instead of throwing.
  const insets = useContext(SafeAreaInsetsContext);
  const viewportHeight = useViewportHeight();
  const keyboardInset = useWebKeyboardInset();
  return computeFormSheetLayout({
    viewportHeight,
    keyboardInset,
    safeAreaTop: insets?.top ?? 0,
    safeAreaBottom: insets?.bottom ?? 0,
  });
}
