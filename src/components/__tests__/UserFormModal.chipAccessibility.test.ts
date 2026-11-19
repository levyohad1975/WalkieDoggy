import fs from 'fs';
import path from 'path';
import { getUserColorLabel } from '../UserFormModal';

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
    const around = source.slice(index, index + 500);
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
    expect(around).toMatch(/accessibilityLabel=\{`צבע \$\{getUserColorLabel\(c\)\}`\}/);
  });

  it('uses non-color selected marks and minimum 44px color targets', () => {
    expect(source).toMatch(/emojiSelectedMark/);
    expect(source).toMatch(/colorSelectedMark/);
    expect(source).toMatch(/colorChip:\s*\{\s*width:\s*44,\s*height:\s*44/);
  });

  it('announces color names instead of raw hex values', () => {
    expect(getUserColorLabel('#5b8def')).toBe('כחול');
    expect(getUserColorLabel('#F2994A')).toBe('כתום');
    expect(getUserColorLabel('#27AE60')).toBe('ירוק');
    expect(getUserColorLabel('#BB6BD9')).toBe('סגול');
    expect(getUserColorLabel('#EB5757')).toBe('אדום');
    expect(getUserColorLabel('#2D9CDB')).toBe('תכלת');
    expect(getUserColorLabel('#123456')).toBe('מותאם אישית');
  });

  it('explains that the chosen emoji is the fallback when a photo is unavailable', () => {
    expect(source).toContain('דמות חלופית (תוצג כשאין תמונה)');
  });
});
