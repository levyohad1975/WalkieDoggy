import fs from 'fs';
import path from 'path';

describe('SettingsScreen — web dog-photo removal', () => {
  const source = fs.readFileSync(path.resolve(__dirname, '../SettingsScreen.tsx'), 'utf8');

  it('requires an explicit browser confirmation before removing the photo', () => {
    expect(source).toMatch(/if \(confirm\?\.\('להסיר את תמונת הכלב\?'\)\) void remove\(\);/);
    expect(source).not.toMatch(/if \(!confirm \|\| confirm\('להסיר את תמונת הכלב/);
  });

  it('requires explicit browser confirmation before signing out', () => {
    expect(source).toMatch(/if \(confirm\?\.\('להתנתק מהמכשיר הזה\? תצטרכו להזין קוד PIN כדי להתחבר שוב\.'\)\) performSignOut\(\);/);
    expect(source).not.toMatch(/if \(!confirm \|\| confirm\('להתנתק מהמכשיר הזה/);
  });
});
