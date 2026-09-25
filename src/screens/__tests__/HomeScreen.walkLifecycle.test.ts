import fs from 'fs';
import path from 'path';

describe('Home integrated walk lifecycle', () => {
  const home = fs.readFileSync(path.join(__dirname, '..', 'HomeScreen.tsx'), 'utf8');
  const card = fs.readFileSync(path.join(__dirname, '..', '..', 'components', 'NextWalkCard.tsx'), 'utf8');

  it('keeps the family dog in the approved photo-led dashboard hero without changing its profile flow', () => {
    expect(home).toContain('showDogPhoto');
    expect(home).toContain('style={styles.dashboardHero}');
    expect(home).toContain('style={styles.dashboardHeroShade}');
    expect(home).toContain('height: 224');
    expect(home).toContain('tone="dashboard"');
    expect(home).toContain('setDogProfileVisible(true)');
    expect(home).toContain("style={styles.mascotHeaderButton}");
  });

  it('keeps the approved four dashboard shortcuts wired to the existing flows', () => {
    expect(home).toContain("navigation.navigate('Schedule')");
    expect(home).toContain("navigation.navigate('History')");
    expect(home).toContain("navigation.navigate('Family')");
    expect(home).toContain('setAddUnplannedVisible(true)');
  });

  it('keeps Home compact by showing two upcoming walks and linking to the full schedule', () => {
    expect(home).toContain('upcoming.slice(0, 2).map');
    expect(home).toContain('עוד ‹');
    expect(home).toContain('הצגת כל הטיולים בלוח הזמנים');
    expect(home).toContain('scrollEnabled={false}');
    expect(home).toContain('style={styles.dashboardMoreButton}');
    expect(home).toContain('>עוד  ‹</RtlText>');
  });

  it('exposes start and end walk as the primary lifecycle action', () => {
    expect(card).toContain('label="התחל טיול עכשיו"');
    expect(card).toContain('label="סיים טיול"');
    expect(card).toContain('label="בוצע"');
    expect(card).toContain('label="לא בוצע"');
    expect(card).toContain('overdue && onMarkNotDone');
    expect(home).toContain('void startWalk(nextWalk.id)');
    expect(home).toContain("nextWalk.status === 'in_progress'");
    expect(home).not.toContain('setActiveWalkSession({ walkId: nextWalk.id');
    expect(home).toContain('setCompleteWalkId(nextWalk.id)');
  });

  it('keeps only the approved completed-walk entry instead of a redundant spontaneous-start CTA', () => {
    expect(home).toContain('הוסף טיול');
    expect(home).toContain('setAddUnplannedVisible(true)');
    expect(home).not.toContain('התחל טיול ספונטני');
  });

  it('keeps overdue red for pending walks without overriding an active green walk', () => {
    expect(card).toContain('overdue && !isActive && styles.cardOverdue');
    expect(card).toContain('backgroundColor: colors.statusOverdueBg');
    expect(card).toContain('isActive && styles.cardActive');
  });
});
