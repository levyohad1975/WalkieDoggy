import { computeKeyboardInset } from '../useWebKeyboardInset';

describe('computeKeyboardInset — iOS Safari / Home Screen PWA keyboard overlap', () => {
  it('is zero when the visual viewport fills the layout viewport', () => {
    expect(computeKeyboardInset(844, { height: 844, offsetTop: 0, scale: 1 })).toBe(0);
  });

  it('reports the keyboard height when the visual viewport shrinks', () => {
    expect(computeKeyboardInset(844, { height: 508, offsetTop: 0, scale: 1 })).toBe(336);
  });

  it('accounts for Safari having scrolled the visual viewport', () => {
    expect(computeKeyboardInset(844, { height: 508, offsetTop: 100, scale: 1 })).toBe(236);
  });

  it('ignores small changes (browser toolbars), pinch-zoom and a missing API', () => {
    expect(computeKeyboardInset(844, { height: 790, offsetTop: 0, scale: 1 })).toBe(0);
    expect(computeKeyboardInset(844, { height: 422, offsetTop: 0, scale: 2 })).toBe(0);
    expect(computeKeyboardInset(844, null)).toBe(0);
    expect(computeKeyboardInset(Number.NaN, { height: 400, offsetTop: 0, scale: 1 })).toBe(0);
  });
});
