import fs from 'fs';
import path from 'path';

describe('CompleteWalkModal — alternate completion time picker', () => {
  const source = fs.readFileSync(path.resolve(__dirname, '../CompleteWalkModal.tsx'), 'utf8');

  it('does not use a manual HH:mm TextInput and provides native/web picker controls', () => {
    expect(source).not.toContain('keyboardType="numbers-and-punctuation"');
    expect(source).toContain("type: 'time'");
    expect(source).toContain('<DateTimePicker');
    expect(source).toContain('setActualTime(`${String(selected.getHours()).padStart(2, \'0\')}:${String(selected.getMinutes()).padStart(2, \'0\')}`)');
  });
});
