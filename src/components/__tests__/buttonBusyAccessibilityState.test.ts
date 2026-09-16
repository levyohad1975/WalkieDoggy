import fs from 'fs';
import path from 'path';

/**
 * QA sweep: `Button`'s `loading` prop already disables the underlying
 * Pressable (which React Native auto-merges into accessibilityState.disabled),
 * but never communicated the in-progress state itself to screen readers —
 * there was no `accessibilityState.busy` (nor `aria-busy`), so a screen-reader
 * user pressing an async action only heard "disabled", not "busy", while it
 * was loading. Verifies the Pressable now derives `accessibilityState.busy`
 * from the `loading` prop, via this repo's established source-scan
 * convention for RN components with no render-test harness.
 */
describe('Button loading -> accessibilityState.busy', () => {
  it('the underlying Pressable derives accessibilityState.busy from the loading prop', () => {
    const source = fs.readFileSync(path.resolve(__dirname, '../Button.tsx'), 'utf8');
    const pressableStart = source.indexOf('<Pressable');
    const disabledPropIndex = source.indexOf('disabled={disabled || loading}', pressableStart);
    expect(disabledPropIndex).toBeGreaterThan(pressableStart);
    const around = source.slice(pressableStart, disabledPropIndex);
    expect(around).toMatch(/accessibilityState=\{\{\s*busy:\s*!!loading\s*\}\}/);
  });
});
