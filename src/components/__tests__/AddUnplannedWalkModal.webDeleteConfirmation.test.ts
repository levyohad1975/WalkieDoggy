import fs from 'fs';
import path from 'path';

describe('AddUnplannedWalkModal — web deletion confirmation', () => {
  const source = fs.readFileSync(path.resolve(__dirname, '../AddUnplannedWalkModal.tsx'), 'utf8');

  it('does not delete a spontaneous walk unless the browser confirmation is explicitly accepted', () => {
    expect(source).toMatch(/if \(confirm\?\.\('למחוק את הטיול הזה\?\\\\n\\\\nהפעולה תמחק לצמיתות את הטיול הספונטני הזה ואת כל הפרטים שלו\.'\)\) \{/);
    expect(source).not.toMatch(/if \(!confirm \|\| confirm\('למחוק את הטיול הזה/);
  });
});
