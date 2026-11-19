import {
  computeFormSheetLayout,
  FORM_SHEET_FOOTER_MIN_PADDING,
  FORM_SHEET_MAX_FRACTION,
  FORM_SHEET_TOP_GAP,
} from '../formSheetLayout';

/**
 * Real-iPhone P0 — the health/grooming edit sheet ran past the bottom of the
 * screen and "מחיקת משימה" was unreachable. The sheet is now sized in px from
 * the real viewport, lifted above the keyboard, and its action footer clears
 * the home indicator. These cases pin that math for small and large iPhones.
 */
describe('computeFormSheetLayout (bottom form sheet on iPhone Safari / PWA)', () => {
  // Footer = Save (52) + gap (8) + Cancel/Delete row (52) + top padding/border (~9).
  const FOOTER_CONTENT_HEIGHT = 52 + 8 + 52 + 9;
  const HEADER_HEIGHT = 24 + 30; // sheet top padding + title line

  const devices = [
    { name: 'iPhone SE (3rd gen) Safari tab', height: 548, top: 20, bottom: 0 },
    { name: 'iPhone SE (3rd gen) Home Screen PWA', height: 667, top: 20, bottom: 0 },
    { name: 'iPhone 13 mini PWA', height: 812, top: 50, bottom: 34 },
    { name: 'iPhone 15 Pro PWA', height: 852, top: 59, bottom: 34 },
  ];

  it.each(devices)('$name: the whole sheet, including the action footer, fits on screen', ({ height, top, bottom }) => {
    const layout = computeFormSheetLayout({ viewportHeight: height, keyboardInset: 0, safeAreaTop: top, safeAreaBottom: bottom });
    expect(layout.sheetHeight).toBeDefined();
    const sheet = layout.sheetHeight as number;
    // Never taller than the visible screen minus the top safe area and a visible backdrop strip.
    expect(sheet).toBeLessThanOrEqual(height - top - FORM_SHEET_TOP_GAP);
    expect(sheet).toBeLessThanOrEqual(height * FORM_SHEET_MAX_FRACTION);
    // Sheet bottom == screen bottom, so the footer's last pixel is on screen.
    expect(layout.backdropPaddingBottom).toBe(0);
    // Room is left for a scrollable body between the header and the footer.
    const body = sheet - HEADER_HEIGHT - FOOTER_CONTENT_HEIGHT - layout.footerPaddingBottom;
    expect(body).toBeGreaterThan(150);
  });

  it('respects the bottom safe-area inset (home indicator) under the footer', () => {
    expect(computeFormSheetLayout({ viewportHeight: 852, keyboardInset: 0, safeAreaTop: 59, safeAreaBottom: 34 }).footerPaddingBottom).toBe(34);
    expect(computeFormSheetLayout({ viewportHeight: 667, keyboardInset: 0, safeAreaTop: 20, safeAreaBottom: 0 }).footerPaddingBottom).toBe(FORM_SHEET_FOOTER_MIN_PADDING);
  });

  it('keyboard open: the sheet is lifted above the keyboard and shrinks so the footer stays visible', () => {
    const keyboard = 336; // iPhone 15 Pro Hebrew keyboard incl. suggestion bar
    const layout = computeFormSheetLayout({ viewportHeight: 852, keyboardInset: keyboard, safeAreaTop: 59, safeAreaBottom: 34 });
    expect(layout.backdropPaddingBottom).toBe(keyboard);
    const sheet = layout.sheetHeight as number;
    // Top of the sheet stays below the notch; bottom sits exactly on the keyboard.
    expect(sheet + keyboard).toBeLessThanOrEqual(852 - 59 - FORM_SHEET_TOP_GAP);
    // The keyboard already covers the home indicator, so no extra safe-area gap.
    expect(layout.footerPaddingBottom).toBe(FORM_SHEET_FOOTER_MIN_PADDING);
    expect(sheet).toBeGreaterThan(FOOTER_CONTENT_HEIGHT + HEADER_HEIGHT);
  });

  it('small iPhone with the keyboard open still shows the footer (body may be short but scrolls)', () => {
    const layout = computeFormSheetLayout({ viewportHeight: 667, keyboardInset: 260, safeAreaTop: 20, safeAreaBottom: 0 });
    const sheet = layout.sheetHeight as number;
    expect(sheet + layout.backdropPaddingBottom).toBeLessThanOrEqual(667 - 20 - FORM_SHEET_TOP_GAP);
    expect(sheet).toBeGreaterThanOrEqual(HEADER_HEIGHT + FOOTER_CONTENT_HEIGHT);
  });

  it('unknown viewport (first render) falls back to the stylesheet height instead of 0px', () => {
    const layout = computeFormSheetLayout({ viewportHeight: 0, keyboardInset: 0, safeAreaTop: 0, safeAreaBottom: 34 });
    expect(layout.sheetHeight).toBeUndefined();
    expect(layout.footerPaddingBottom).toBe(34);
  });

  it('ignores negative / non-finite inputs', () => {
    const layout = computeFormSheetLayout({ viewportHeight: 700, keyboardInset: -50, safeAreaTop: Number.NaN, safeAreaBottom: -1 });
    expect(layout.backdropPaddingBottom).toBe(0);
    expect(layout.footerPaddingBottom).toBe(FORM_SHEET_FOOTER_MIN_PADDING);
    expect(layout.sheetHeight).toBe(Math.floor(700 * FORM_SHEET_MAX_FRACTION));
  });
});
