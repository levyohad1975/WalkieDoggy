import fs from 'fs';
import path from 'path';

describe('Home integrated walk lifecycle', () => {
  const home = fs.readFileSync(path.join(__dirname, '..', 'HomeScreen.tsx'), 'utf8');
  const card = fs.readFileSync(path.join(__dirname, '..', '..', 'components', 'NextWalkCard.tsx'), 'utf8');

  it('keeps the branded Walkie Park default hero while using persisted family-dog imagery safely', () => {
    expect(home).toContain('showDogPhoto');
    expect(home).toContain('style={styles.dashboardHero}');
    expect(home).toContain('style={styles.dashboardHeroShell}');
    expect(home).toContain("{heroBackground ? (");
    expect(home).toContain("source={{ uri: heroBackground.uri }}");
    expect(home).not.toContain("require('../../assets/walkie-park-default.jpg')");
    expect(home).not.toContain('<WalkieParkBackground />');
    expect(home).toContain('getDogBackground(dog?.heroBackgroundId)');
    expect(home).not.toContain('getDogBackgroundId');
    expect(home).toContain('source={{ uri: dog!.photoCutoutUrl! }}');
    expect(home).toContain('source={{ uri: dog!.photoUrl! }}');
    expect(home).toContain('tone="dashboard"');
    expect(home).toContain('setDogProfileVisible(true)');
    expect(home).toContain("style={styles.mascotHeaderButton}");
  });

  it('keeps the Dashboard hero unobstructed by the removed family greeting overlay', () => {
    expect(home).not.toContain('style={styles.dashboardHeroGreeting}');
    expect(home).not.toContain('>שלום משפחת');
    expect(home).not.toContain('מחכה לטיול הבא 🐾');
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
    expect(home).toContain('dailyWalkTimeline(visibleWalks, now)');
    expect(home).toContain('dashboardTimelineWalks.map');
    expect(home).toContain('dashboardTimelineWalks.map');
    expect(home).toContain('בהמשך היום');
    expect(home).toContain('אין טיולים מתוכננים היום');
    expect(home).toContain("walk.status === 'done'");
    expect(home).toContain("walk.status === 'skipped'");
    expect(home).toContain("walk.status === 'in_progress'");
    expect(home).toContain('scrollEnabled');
    expect(home).toContain('paddingBottom: 96');
    expect(home).not.toContain('style={styles.dashboardMoreButton}');
  });

  // Real-device QA fix — the approved Dashboard Option D spec is
  // "בהמשך היום · X טיולים", but the header never actually included the
  // walk count. This asserts the header text includes it whenever there
  // is at least one timeline walk, and degrades gracefully (plain title,
  // no "0 טיולים") when there are none — the empty-state card below
  // already conveys that.
  // Real-device QA ask: "verify the pending-request card disappears/
  // updates immediately after approve/reject". Guaranteed structurally by
  // NOT memoizing this computation — it re-derives from the live
  // swapRequests/timeChangeRequests store state on every render, the same
  // pattern pendingForMe (the pre-existing bell-badge count) already
  // relies on. A useMemo with a stale/incomplete dependency array here
  // would be exactly the kind of bug that could leave an approved/
  // rejected request lingering on Home after its status already changed.
  it('actionablePendingRequests is recomputed directly from live store state every render — never a stale useMemo', () => {
    expect(home).toContain(
      'const actionablePendingRequests = selectActionablePendingRequestsForViewer(\n    swapRequests,\n    timeChangeRequests,\n    walksById,\n    effectiveUserId,\n    effectiveRole === \'admin\'\n  );'
    );
    expect(home).not.toMatch(/const actionablePendingRequests = useMemo/);
  });

  it('"בהמשך היום" header includes the live walk count, matching the approved Dashboard Option D spec', () => {
    expect(home).toMatch(
      /\{dashboardTimelineWalks\.length > 0\s*\n\s*\? `בהמשך היום · \$\{dashboardTimelineWalks\.length === 1 \? 'טיול אחד' : `\$\{dashboardTimelineWalks\.length\} טיולים`\}`\s*\n\s*: 'בהמשך היום'\}/
    );
  });

  // Request-notifications repair, item B — the generic "N requests
  // waiting" banner was replaced with PendingRequestsCard, which renders
  // the actual actionable items (who requested what from whom) with
  // inline approve/decline, reusing the same requestsStore actions
  // RequestsInboxModal already uses — see PendingRequestsCard.tsx and
  // logic/requestLifecycle.ts's selectActionablePendingRequestsForViewer().
  it('renders the actionable pending-request card (not a bare count banner) wired to the real approve/decline actions', () => {
    expect(home).toContain('selectActionablePendingRequestsForViewer(');
    expect(home).toContain('<PendingRequestsCard');
    expect(home).toContain('items={actionablePendingRequests}');
    expect(home).toContain('onApproveSwap={approveSwap}');
    expect(home).toContain('onRejectSwap={rejectSwap}');
    expect(home).toContain('onApproveTimeChange={approveTimeChange}');
    expect(home).toContain('onRejectTimeChange={rejectTimeChange}');
    expect(home).toContain('onOpenInbox={openRequestsInbox}');
    // Deliberately rendered after the timeline so it remains the lowest
    // Dashboard row on mobile, same positioning as the banner it replaced.
    expect(home.indexOf('<PendingRequestsCard')).toBeGreaterThan(home.indexOf('style={styles.dashboardTimeline}'));
  });

  it('keeps the approved Home content order with white supporting cards and teal actions', () => {
    const lastWalkIndex = home.indexOf('style={styles.dashboardLastWalk}');
    const addWalkIndex = home.indexOf('style={styles.dashboardAddWalk}');
    const timelineIndex = home.indexOf('style={styles.dashboardTimeline}');
    expect(lastWalkIndex).toBeGreaterThan(-1);
    expect(lastWalkIndex).toBeLessThan(addWalkIndex);
    expect(addWalkIndex).toBeLessThan(timelineIndex);
    expect(home).toContain("dashboardLastWalk: { minHeight: 82, borderRadius: 24, backgroundColor: '#F4FAFD'");
    expect(home).toContain("dashboardAddWalk: { minHeight: 52, borderRadius: 22, backgroundColor: '#F0FAF8'");
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
