import fs from 'fs';
import path from 'path';

describe('Home integrated walk lifecycle', () => {
  const home = fs.readFileSync(path.join(__dirname, '..', 'HomeScreen.tsx'), 'utf8');
  const card = fs.readFileSync(path.join(__dirname, '..', '..', 'components', 'NextWalkCard.tsx'), 'utf8');

  it('keeps the approved lavender dashboard hero independent of family-photo persistence', () => {
    expect(home).toContain('showDogPhoto');
    expect(home).toContain('style={styles.dashboardHero}');
    expect(home).toContain('style={styles.dashboardHeroShade}');
    expect(home).toContain('height: 210');
    expect(home).toContain('style={styles.dashboardHeroBloomOne}');
    expect(home).toContain('style={styles.dashboardHeroBloomTwo}');
    expect(home).toContain('style={styles.dashboardHeroGlow}');
    expect(home).toContain('heroBackground ? (');
    expect(home).not.toContain('source={{ uri: dog!.photoUrl! }}');
    expect(home).toContain('tone="dashboard"');
    expect(home).toContain('setDogProfileVisible(true)');
    expect(home).toContain("style={styles.mascotHeaderButton}");
  });

  it('keeps the approved three dashboard shortcuts wired to the existing flows', () => {
    expect(home).toContain("navigation.navigate('Schedule')");
    expect(home).toContain('setAddUnplannedVisible(true)');
    expect(home).toContain('setRequestSwapWalkId(nextWalk?.id ?? null)');
    expect(home).toContain('setRequestTimeChangeWalkId(nextWalk?.id ?? null)');
  });

  it('keeps Home compact with one tappable three-stop timeline instead of a long list', () => {
    expect(home).toContain('upcoming.slice(0, 3).map');
    expect(home).toContain('פתיחת לוח הזמנים להמשך היום');
    expect(home).toContain('scrollEnabled={false}');
    expect(home).not.toContain('style={styles.dashboardMoreButton}');
  });

  it('exposes start and end walk as the primary lifecycle action', () => {
    expect(card).toContain("tone === 'dashboard' ? 'התחל טיול' : 'התחל טיול עכשיו'");
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
