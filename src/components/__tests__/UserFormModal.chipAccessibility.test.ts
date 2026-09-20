import fs from 'fs';
import path from 'path';

/**
 * QA Guardian sweep (accessibility labels on non-Button Pressable elements):
 * the emoji avatar chip had no accessible label at all (emoji-only content),
 * and the color swatch chip had no visible content or label whatsoever —
 * the worst case found in the sweep, since there isn't even an emoji for a
 * screen reader to (mis-)interpret. Both are single-select chip groups, the
 * same shape already handled correctly elsewhere (DeleteUserModal.tsx,
 * EditDoneDetailsModal.tsx) with accessibilityRole="radio" +
 * accessibilityState={{ selected }}. Verifies both chip groups now match.
 */
describe('UserFormModal — avatar/color chip accessibility', () => {
  const source = fs.readFileSync(path.resolve(__dirname, '../UserFormModal.tsx'), 'utf8');

  it('the emoji avatar chip has accessibilityRole="radio", accessibilityState bound to the selection, and a label', () => {
    const index = source.indexOf('setAvatar(e)');
    expect(index).toBeGreaterThan(-1);
    const around = source.slice(index, index + 300);
    expect(around).toMatch(/accessibilityRole="radio"/);
    expect(around).toMatch(/accessibilityState=\{\{\s*selected:\s*avatar === e\s*\}\}/);
    expect(around).toMatch(/accessibilityLabel=\{`סמל \$\{e\}`\}/);
  });

  it('the color swatch chip has accessibilityRole="radio", accessibilityState bound to the selection, and a label', () => {
    const index = source.indexOf('setColor(c)');
    expect(index).toBeGreaterThan(-1);
    const around = source.slice(index, index + 300);
    expect(around).toMatch(/accessibilityRole="radio"/);
    expect(around).toMatch(/accessibilityState=\{\{\s*selected:\s*color === c\s*\}\}/);
    expect(around).toMatch(/accessibilityLabel=\{`צבע \$\{c\}`\}/);
  });
});
