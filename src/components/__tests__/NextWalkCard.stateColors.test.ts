import fs from 'fs';
import path from 'path';

describe('NextWalkCard state colors', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'NextWalkCard.tsx'), 'utf8');

  it('uses the approved clean white surface for the ordinary next-walk card', () => {
    expect(source).toContain('backgroundColor: colors.surface');
    expect(source).toContain('borderColor: colors.border');
  });

  it('allows Home to opt into the approved Expo dashboard surface without changing ordinary cards', () => {
    expect(source).toContain("tone?: 'default' | 'dashboard'");
    expect(source).toContain("tone === 'dashboard' && styles.cardDashboard");
    expect(source).toContain("cardDashboard: { backgroundColor: '#E9EFFD'");
    expect(source).toContain("backgroundColor: '#0EA8B2'");
  });

  it('keeps the approved role-aware actions inside the dashboard card', () => {
    expect(source).toContain('עריכה');
    expect(source).toContain('החלפה');
    expect(source).toContain('בקשה לשינוי');
    expect(source).toContain('בקשת החלפה');
  });

  it('uses green for an active walk and gives it priority over overdue red', () => {
    expect(source).toContain('isActive && styles.cardActive');
    expect(source).toContain('cardActive: { backgroundColor: colors.successSoft');
  });

  /**
   * P0 real-iPhone report (2026-10-15): this card is now reused by
   * HomeScreen for both scheduled AND spontaneous active walks (see
   * HomeScreen.activeSpontaneousWalks.test.ts) — it must still say WHICH
   * kind of walk is active rather than the same label for both.
   */
  it('labels an active walk\'s eyebrow as spontaneous or scheduled, driven by walk.isUnplanned', () => {
    expect(source).toContain('walk.isUnplanned ? `טיול ספונטני פעיל · ${dogName}` : `בזמן טיול · ${dogName}`');
  });

  it('switches a pending overdue walk to the red-tinted state', () => {
    expect(source).toContain('const overdue = isOverdue(walk, new Date(), scheduleTimezone)');
    expect(source).toContain('overdue && !isActive && styles.cardOverdue');
    expect(source).toContain('cardOverdue: { backgroundColor: colors.statusOverdueBg');
  });
});
