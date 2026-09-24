import fs from 'fs';
import path from 'path';

describe('SettingsScreen — web dog-photo removal', () => {
  const source = fs.readFileSync(path.resolve(__dirname, '../SettingsScreen.tsx'), 'utf8');

  it('requires an explicit browser confirmation before removing the photo', () => {
    expect(source).toMatch(/if \(confirm\?\.\('להסיר את תמונת הכלב\?'\)\) void remove\(\);/);
    expect(source).not.toMatch(/if \(!confirm \|\| confirm\('להסיר את תמונת הכלב/);
  });
});
