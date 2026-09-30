import fs from 'fs';
import path from 'path';

describe('UserFormModal — member names', () => {
  const source = fs.readFileSync(path.resolve(__dirname, '../UserFormModal.tsx'), 'utf8');

  it('keeps the standard text input path so internal Hebrew spaces remain typeable', () => {
    expect(source).toContain('keyboardType="default"');
    expect(source).not.toMatch(/onChangeText=\{.*replace\(/);
    expect(source).toContain('onSave({ name: name.trim(), avatar, color, photoUrl })');
  });
});
