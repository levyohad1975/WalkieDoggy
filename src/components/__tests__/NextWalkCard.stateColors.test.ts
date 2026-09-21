import fs from 'fs';
import path from 'path';

describe('NextWalkCard state colors', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'NextWalkCard.tsx'), 'utf8');

  it('uses the colored current-walk background instead of the white surface', () => {
    expect(source).toContain('backgroundColor: colors.statusCurrentBg');
  });

  it('switches the card to the overdue red-tinted state after the scheduled time', () => {
    expect(source).toContain('const overdue = isOverdue(walk)');
    expect(source).toContain('overdue && styles.cardOverdue');
    expect(source).toContain('cardOverdue: { backgroundColor: colors.statusOverdueBg');
  });
});
