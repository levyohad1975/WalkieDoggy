import fs from 'fs';
import path from 'path';

describe('Home integrated walk lifecycle', () => {
  const home = fs.readFileSync(path.join(__dirname, '..', 'HomeScreen.tsx'), 'utf8');
  const card = fs.readFileSync(path.join(__dirname, '..', '..', 'components', 'NextWalkCard.tsx'), 'utf8');

  it('keeps the approved lavender dashboard hero while using the persisted family-dog image safely', () => {
    expect(home).toContain('showDogPhoto');
    expect(home).toContain('style={styles.dashboardHero}');
    expect(home).toContain('style={styles.dashboardHeroShade}');
    expect(home).toContain('style={styles.dashboardHeroShell}');
    expect(home).toContain('style={styles.dashboardHeroBloomOne}');
    expect(home).toContain('style={styles.dashboardHeroBloomTwo}');
    expect(home).toContain('style={styles.dashboardHeroGlow}');
    expect(home).toContain('getDogBackground(dog?.heroBackgroundId)');
    expect(home).not.toContain('getDogBackgroundId');
    expect(home).toContain('source={{ uri: dog!.photoCutoutUrl! }}');
    expect(home).toContain('source={{ uri: dog!.photoUrl! }}');
    expect(home).toContain('tone="dashboard"');
    expect(home).toContain('setDogProfileVisible(true)');
    expect(home).toContain("style={styles.mascotHeaderButton}");
  });

  it('keeps the approved two dashboard shortcuts (שינוי שעה / טיול ספונטני) wired to the existing flows', () => {
    expect(home).toContain("navigation.navigate('Schedule')");
    expect(home).toContain('setAddUnplannedVisible(true)');
    expect(home).toContain('setRequestTimeChangeWalkId(nextWalk?.id ?? null)');
    expect(home).toContain('numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.72}>טיול ספונטני</RtlText>');
    expect(home).toContain('numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.72}>שינוי שעה</RtlText>');
  });

  it('uses manager-only Edit/Swap dashboard shortcuts and removes the mistaken standalone swap row', () => {
    expect(home).toContain("effectiveRole === 'admin' ?");
    expect(home).toContain('accessibilityLabel="עריכת הטיול הבא"');
    expect(home).toContain('accessibilityLabel="החלפת הטיול הבא"');
    expect(home).toContain('setEditWalkId(nextWalk.id)');
    expect(home).toContain('setSwapWalkId(nextWalk.id)');
    expect(home).not.toContain('style={styles.dashboardSwapRequestRow}');
    expect(home).toContain('onSwap={undefined}');
    expect(home).toContain('onEdit={undefined}');
  });

  it('keeps a compact, always-present Dashboard timeline instead of a long list', () => {
    expect(home).toContain('const dashboardTimelineWalks = useMemo');
    expect(home).toContain('dashboardTimelineWalks.length > 0 ?');
    expect(home).toContain('dashboardTimelineWalks.map');
    expect(home).toContain('אין טיולים נוספים היום');
    expect(home).toContain('פתיחת לוח הזמנים להמשך היום');
    expect(home).toContain('scrollEnabled');
    expect(home).toContain('paddingBottom: 120');
    expect(home).not.toContain('style={styles.dashboardMoreButton}');
  });

  it('shows the orange approval prompt only for a real actionable request', () => {
    expect(home).toContain('pendingForMe > 0 ?');
    expect(home).toContain('style={styles.dashboardRequestAlert}');
    expect(home.indexOf('style={styles.dashboardTimeline}')).toBeLessThan(home.indexOf('style={styles.dashboardRequestAlert}'));
    expect(home).toContain('בקשה ממתינה לאישור');
    expect(home).toContain('onPress={openRequestsInbox}');
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
