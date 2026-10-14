import fs from 'fs';
import path from 'path';

// P0 real-iPhone QA (PR #150): four "טיול ספונטני פעיל · אבי" cards, each with
// "התחל GPS מרחוק", pushed the 16:00 scheduled walk down under the bottom nav.
describe('Home active spontaneous walks (P0 duplicate cards)', () => {
  const home = fs.readFileSync(path.join(__dirname, '..', 'HomeScreen.tsx'), 'utf8');

  it('groups through the shared deterministic selector over the FULL visible pool', () => {
    expect(home).toContain("import { activeSpontaneousHomeBlocks, groupActiveSpontaneousWalks } from '../logic/activeSpontaneousWalks';");
    expect(home).toContain('groupActiveSpontaneousWalks(visibleWalks, {');
    expect(home).toContain("viewerIsAdmin: actualFamilyRole === 'admin',");
    expect(home).toContain('knownDogIds,');
    // The main-card walk is handled AFTER grouping so its duplicates are caught.
    expect(home).toContain('nextWalk?.id,\n    ),');
    expect(home).not.toMatch(/walk\.isUnplanned && isActiveWalk\(walk\) && walk\.id !== nextWalk\?\.id/);
    // No ad-hoc per-dogId Map in the screen any more.
    expect(home).not.toContain('groups.set(walk.dogId');
  });

  it('renders one block per group: a short duplicate notice, never one remote-GPS card per record', () => {
    expect(home).toContain('activeSpontaneousWalkGroups.map((group) => group.duplicate ? (() => {');
    expect(home).toContain('key={`spontaneous-duplicate-${group.key}`}');
    expect(home).toContain('const notice = duplicateActiveWalkNotice(group, {');
    expect(home).toContain('{notice.title}');
    expect(home).toContain('{notice.body}');
    expect(home).toContain('const spontaneous = group.walks[0];');
    // Remote GPS start remains for a genuinely unique active walk only.
    const section = home.slice(home.indexOf('testID="home-active-spontaneous-walks"'), home.indexOf('<PendingRequestsCard'));
    expect(section.match(/<RemoteGpsPanel/g)).toHaveLength(1);
    const duplicateBranch = section.slice(0, section.indexOf('const spontaneous = group.walks[0];'));
    expect(duplicateBranch).not.toContain('<RemoteGpsPanel');
    expect(duplicateBranch).not.toContain('setCompleteWalkId');
  });

  it('never exposes raw walk UUIDs, user ids or ISO timestamps on the Dashboard duplicate notice', () => {
    const section = home.slice(home.indexOf('testID="home-active-spontaneous-walks"'), home.indexOf('<PendingRequestsCard'));
    const duplicateBranch = section.slice(0, section.indexOf('const spontaneous = group.walks[0];'));
    expect(duplicateBranch).not.toContain('group.walks.map(');
    expect(duplicateBranch).not.toContain('{walk.id}');
    expect(duplicateBranch).not.toContain('walk.startedAt');
    expect(duplicateBranch).not.toContain('walk.createdAt');
    expect(duplicateBranch).not.toContain('responsibleUserId');
    expect(home).not.toContain('activeSpontaneousAuditRow');
  });

  it('offers the Family Admin review action only through the same gate as the History review panel', () => {
    expect(home).toContain("import { canOpenDuplicateResolution } from '../logic/duplicateWalkResolution';");
    expect(home).toContain('const canReviewDuplicateWalks = canOpenDuplicateResolution({');
    expect(home).toContain('staging: isWalkResolutionStaging,');
    expect(home).toContain('impersonating: impersonatingForReview,');
    expect(home).toContain('systemObserver: systemObserverForReview,');
    expect(home).toContain('testMode: testModeForReview,');
    expect(home).toContain('&& canAccessHistoryScreen(currentUserId, permissionOverridesForReview, permissionOverridesStatusForReview);');
    expect(home).toContain("viewerIsAdmin: actualFamilyRole === 'admin',\n                canReview: canReviewDuplicateWalks,");
    expect(home).toContain('{notice.reviewActionLabel ? (');
    expect(home).toContain("onPress={() => navigation.navigate('History')}");
  });

  it('keeps the scheduled next-walk card first, so active cards can never bury it', () => {
    const nextWalkCard = home.indexOf('<View ref={nextWalkCardRef}');
    const activeSection = home.indexOf('testID="home-active-spontaneous-walks"');
    const pendingRequests = home.indexOf('<PendingRequestsCard');
    expect(nextWalkCard).toBeGreaterThan(-1);
    expect(activeSection).toBeGreaterThan(nextWalkCard);
    expect(pendingRequests).toBeGreaterThan(activeSection);
    // The next-walk card keeps its hero lift and the scroll content keeps
    // clearance above the fixed bottom tab bar on iPhone Safari/PWA.
    expect(home).toContain('nextWalkLift: { marginTop: -34');
    expect(home).toContain('scrollEnabled');
    expect(home).toContain('paddingBottom: 96');
  });

  it('keeps RTL alignment for the active-walk and audit text', () => {
    expect(home).toContain("activeSpontaneousTitle: { fontWeight: '700', marginBottom: 6, textAlign: 'right' }");
    expect(home).toMatch(/activeSpontaneousAuditNote: \{[^}]*textAlign: 'right'/);
  });
});
