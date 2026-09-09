import fs from 'fs';
import path from 'path';

describe('shared schedule time picker integration', () => {
  const read = (name: string) => fs.readFileSync(path.join(__dirname, '..', name), 'utf8');

  it('gives the add-rule flow a shared editable time field and saves its selected value', () => {
    const source = read('RuleFormModal.tsx');
    expect(source).toContain('<TimePickerField value={time} onChange={setTime}');
    expect(source).toContain('onSave({ time, label: label.trim()');
  });

  it('gives the future-walk edit flow the same field and applies a selected valid time', () => {
    const source = read('EditWalkModal.tsx');
    expect(source).toContain('<TimePickerField value={time} onChange={handleTimeChange}');
    expect(source).toContain('onChangeTime(newTime)');
  });
});
