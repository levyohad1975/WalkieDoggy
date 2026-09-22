import fs from 'fs';
import path from 'path';

describe('NextWalkCard state colors', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'NextWalkCard.tsx'), 'utf8');

  it('uses the colored current-walk background instead of the white surface', () => {
    expect(source).toContain('backgroundColor: colors.statusCurrentBg');
  });

  it('uses green for an active walk and gives it priority over overdue red', () => {
    expect(source).toContain('isActive && styles.cardActive');
    expect(source).toContain('cardActive: { backgroundColor: colors.successSoft');
    expect(source).toContain("isActive ? `בזמן טיול · ${dogName}`");
  });

  it('switches a pending overdue walk to the red-tinted state', () => {
    expect(source).toContain('const overdue = isOverdue(walk)');
    expect(source).toContain('overdue && !isActive && styles.cardOverdue');
    expect(source).toContain('cardOverdue: { backgroundColor: colors.statusOverdueBg');
  });
});
