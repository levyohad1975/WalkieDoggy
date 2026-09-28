import fs from 'fs';
import path from 'path';

describe('Home integrated walk lifecycle', () => {
  const home = fs.readFileSync(path.join(__dirname, '..', 'HomeScreen.tsx'), 'utf8');
  const card = fs.readFileSync(path.join(__dirname, '..', '..', 'components', 'NextWalkCard.tsx'), 'utf8');

  it('keeps the approved calm Dashboard hero while using the persisted family-dog image safely', () => {
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

  it('gives the family greeting enough RTL-safe room to wrap on a narrow iPhone without changing the Dashboard Option D hero', () => {
    expect(home).toContain('style={styles.dashboardHeroGreeting}');
    expect(home).toContain('numberOfLines={2} adjustsFontSizeToFit minimumFontScale={0.78}>שלום משפחת');
    expect(home).toContain("right: '42%'");
    expect(home).toContain('dashboardHeroGreetingTitle: { width: \'100%\', flexShrink: 1');
  });

  it('keeps one compact add-walk action wired to the existing completed/spontaneous flow', () => {
    expect(home).toContain('setAddUnplannedVisible(true)');
    expect(home).toContain('accessibilityLabel="הוסף טיול"');
    expect(home).toContain('>הוסף טיול</RtlText>');
    expect(home).not.toContain('dashboardMemberShortcuts');
  });

  it('renders manager-only Edit/Swap directly under Next Walk and no standalone swap row', () => {
    expect(home).toContain("effectiveRole === 'admin' ?");
    expect(home).toContain('>הוסף טיול</RtlText>');
    expect(home).toContain('setEditWalkId(nextWalk.id)');
    expect(home).toContain('setSwapWalkId(nextWalk.id)');
    expect(home).not.toContain('style={styles.dashboardSwapRequestRow}');
    expect(home).toContain("onSwap={effectiveRole === 'admin' && nextWalk.status === 'pending'");
    expect(home).toContain("onEdit={effectiveRole === 'admin' && nextWalk.status === 'pending'");
    expect(card).toContain('{onEdit || onSwap ? (');
    expect(card).toContain('עריכה');
    expect(card).toContain('החלפה');
    expect(card).toContain('בקשה לשינוי');
    expect(card).toContain('בקשת החלפה');
  });

  it('uses the actual completion date in the last-walk dashboard card', () => {
    expect(home).toContain('resolvedWalkDateContextLabel(lastWalk)');
    expect(home).not.toContain('walkDateContextLabel(lastWalk.date)');
  });

  it('keeps a compact, always-present full daily Dashboard timeline instead of a future-only list', () => {
    expect(home).toContain('const dashboardTimelineWalks = useMemo');
    expect(home).toContain('dailyWalkTimeline(visibleWalks, new Date())');
    expect(home).toContain('dashboardTimelineWalks.length > 0 ?');
    expect(home).toContain('dashboardTimelineWalks.map');
    expect(home).toContain('בהמשך היום');
    expect(home).toContain('אין טיולים מתוכננים היום');
    expect(home).toContain("walk.status === 'done'");
    expect(home).toContain("walk.status === 'skipped'");
    expect(home).toContain("walk.status === 'in_progress'");
    expect(home).toContain('scrollEnabled');
    expect(home).toContain('paddingBottom: 24');
    expect(home).not.toContain('style={styles.dashboardMoreButton}');
  });

  it('shows the orange approval prompt only for a real actionable request', () => {
    expect(home).toContain('pendingForMe > 0 ?');
    expect(home).toContain('style={styles.dashboardRequestAlert}');
    expect(home.indexOf('style={styles.dashboardRequestAlert}')).toBeLessThan(home.indexOf('style={styles.dashboardTimeline}'));
    expect(home).toContain('בקשה ממתינה לאישור');
    expect(home).toContain('onPress={openRequestsInbox}');
  });

  it('keeps the approved Home content order with white supporting cards and teal actions', () => {
    const lastWalkIndex = home.indexOf('style={styles.dashboardLastWalk}');
    const addWalkIndex = home.indexOf('style={styles.dashboardAddWalk}');
    const timelineIndex = home.indexOf('style={styles.dashboardTimeline}');
    expect(lastWalkIndex).toBeGreaterThan(-1);
    expect(lastWalkIndex).toBeLessThan(addWalkIndex);
    expect(addWalkIndex).toBeLessThan(timelineIndex);
    expect(home).toContain("dashboardLastWalk: { minHeight: 92, borderRadius: 24, backgroundColor: '#FFFFFF'");
    expect(home).toContain("dashboardAddWalk: { minHeight: 58, borderRadius: 22, backgroundColor: '#FFFFFF'");
    expect(home).toContain("backgroundColor: '#12A5AB'");
    expect(home).not.toContain('#4A43B6');
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
