import fs from 'fs';
import path from 'path';

describe('Home integrated walk lifecycle', () => {
  const home = fs.readFileSync(path.join(__dirname, '..', 'HomeScreen.tsx'), 'utf8');
  const card = fs.readFileSync(path.join(__dirname, '..', '..', 'components', 'NextWalkCard.tsx'), 'utf8');

  it('moves the family dog identity into the next-walk card and removes the standalone profile card', () => {
    expect(home).toContain('showDogPhoto');
    expect(home).not.toContain('style={styles.dogSummaryCard}');
    expect(home).toContain('style={styles.mascotHeaderButton}');
  });

  it('exposes start and end walk as the primary lifecycle action', () => {
    expect(card).toContain('label={overdue ? \'התחל טיול עכשיו\' : \'התחל טיול\'}');
    expect(card).toContain('label="סיים טיול"');
    expect(card).toContain('label="✓ סמן טיול כבוצע"');
    expect(home).toContain('void startWalk(nextWalk.id)');
    expect(home).toContain("nextWalk.status === 'in_progress'");
    expect(home).not.toContain('setActiveWalkSession({ walkId: nextWalk.id');
    expect(home).toContain('setCompleteWalkId(nextWalk.id)');
  });

  it('keeps overdue red for pending walks without overriding an active green walk', () => {
    expect(card).toContain('overdue && !isActive && styles.cardOverdue');
    expect(card).toContain('backgroundColor: colors.statusOverdueBg');
    expect(card).toContain('isActive && styles.cardActive');
  });
});
