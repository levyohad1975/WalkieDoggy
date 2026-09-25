import fs from 'fs';
import path from 'path';

describe('NextWalkCard state colors', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'NextWalkCard.tsx'), 'utf8');

  it('uses the approved clean white surface for the ordinary next-walk card', () => {
    expect(source).toContain('backgroundColor: colors.surface');
    expect(source).toContain('borderColor: colors.border');
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
