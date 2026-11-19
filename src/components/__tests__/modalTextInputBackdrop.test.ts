import fs from 'fs';
import path from 'path';

/**
 * Production report 2026-11-02: typing a space in "עזרה ותמיכה" search closed
 * the sheet. On web the tap-outside backdrop is a role="button" Pressable;
 * when it WRAPS the sheet, key presses from a text field inside bubble up to
 * it and activate it. Sheets with text fields therefore keep the dismiss
 * Pressable as an absolute-fill SIBLING of the sheet, never its ancestor
 * (the pattern AddUnplannedWalkModal already used).
 */
const files = [
  'HelpCenterModal.tsx',
  'CompleteWalkModal.tsx',
  'DogDetailsModal.tsx',
  'EditDoneDetailsModal.tsx',
  'EditWalkModal.tsx',
  'HealthGroomingModal.tsx',
  'UserFormModal.tsx',
  'chat/ChatImageComposer.tsx',
  'AddUnplannedWalkModal.tsx',
];

describe('sheets with text fields: the dismiss backdrop never wraps the sheet', () => {
  it.each(files)('%s', (file) => {
    const source = fs.readFileSync(path.resolve(__dirname, '..', file), 'utf8');
    expect(source).not.toMatch(/<Pressable[^>]*style=\{styles\.backdrop\}/);
    expect(source).not.toMatch(/<Pressable\s+style=\{styles\.backdrop\}/);
    expect(source).toContain('<View style={styles.backdrop}>');
    expect(source).toMatch(/<Pressable\s+style=\{StyleSheet\.absoluteFill\}[^]*?accessibilityRole="button"[^]*?\/>/);
  });
});
