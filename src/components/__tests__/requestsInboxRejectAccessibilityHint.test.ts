import fs from 'fs';
import path from 'path';

/**
 * QA Guardian follow-up (accessibilityHint-on-destructive-actions, category
 * (b)): RequestsInboxModal.tsx's two "דחה" (reject swap / reject time-change)
 * buttons fire immediately on tap with no confirmation step and previously
 * had no accessibilityHint, unlike the category-(a) actions elsewhere that
 * are gated by a native Alert/ConfirmModal. Button.tsx also didn't expose an
 * accessibilityHint/accessibilityLabel prop at all. Verifies Button.tsx now
 * threads both through to its underlying Pressable, and that both reject
 * call sites in RequestsInboxModal.tsx pass a non-empty accessibilityHint.
 */
describe('Button accessibilityHint/accessibilityLabel prop threading', () => {
  const buttonSource = fs.readFileSync(path.resolve(__dirname, '../Button.tsx'), 'utf8');

  it('Pressable receives accessibilityHint and accessibilityLabel from props', () => {
    const index = buttonSource.indexOf('<Pressable');
    expect(index).toBeGreaterThan(-1);
    const around = buttonSource.slice(index, index + 300);
    expect(around).toMatch(/accessibilityHint=\{accessibilityHint\}/);
    expect(around).toMatch(/accessibilityLabel=\{accessibilityLabel\}/);
  });
});

describe('RequestsInboxModal reject buttons — accessibilityHint', () => {
  const source = fs.readFileSync(path.resolve(__dirname, '../RequestsInboxModal.tsx'), 'utf8');

  it.each([
    ['onRejectSwap'],
    ['onRejectTimeChange'],
  ])('the reject button calling %s has a non-empty accessibilityHint', (onRejectCall) => {
    const index = source.indexOf(`() => ${onRejectCall}(r.id)`);
    expect(index).toBeGreaterThan(-1);
    const around = source.slice(index, index + 200);
    expect(around).toMatch(/accessibilityHint="[^"]+"/);
  });
});
