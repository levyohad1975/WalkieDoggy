import fs from 'fs';
import path from 'path';

// P0 real-iPhone QA (PR #150): four "טיול ספונטני פעיל · אבי" cards, each with
// "התחל GPS מרחוק", pushed the 16:00 scheduled walk down under the bottom nav.
describe('Home active spontaneous walks (P0 duplicate cards)', () => {
  const home = fs.readFileSync(path.join(__dirname, '..', 'HomeScreen.tsx'), 'utf8');

  it('groups through the shared deterministic selector over the FULL visible pool', () => {
    expect(home).toContain("import { activeSpontaneousHomeBlocks, duplicateActiveWalkNotice, groupActiveSpontaneousWalks } from '../logic/activeSpontaneousWalks';");
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
    expect(home).toContain('nextWalkLift: { marginTop: -64');
    expect(home).toContain('scrollEnabled');
    expect(home).toContain('paddingBottom: 96');
  });

  it('keeps RTL alignment for the active-walk and audit text', () => {
    expect(home).toContain("activeSpontaneousTitle: { fontWeight: '700', marginBottom: 6, textAlign: 'right' }");
    expect(home).toMatch(/activeSpontaneousAuditNote: \{[^}]*textAlign: 'right'/);
  });

  /**
   * P0 real-iPhone report (2026-10-15, 17:32): a genuinely unique active
   * spontaneous walk showed only "טיול ספונטני פעיל · אבי" + the Remote GPS
   * panel + "סיים טיול" — no elapsed timer, no local GPS activation, no
   * map, no distance, unlike the scheduled NextWalkCard above it. Requirement:
   * scheduled and spontaneous active walks share the SAME unified card
   * (NextWalkCard), not a second reduced implementation.
   */
  describe('the single active spontaneous walk reuses the unified NextWalkCard (not a reduced card)', () => {
    const nonDuplicateBranch = home.slice(
      home.indexOf('const spontaneous = group.walks[0];'),
      home.indexOf('})())}'),
    );

    it('renders NextWalkCard, not a bespoke block', () => {
      expect(nonDuplicateBranch).toContain('<NextWalkCard');
      expect(nonDuplicateBranch).not.toContain("styles.activeSpontaneousCard");
    });

    it("derives the elapsed timer from the walk's persisted started_at, same as a scheduled active walk", () => {
      expect(nonDuplicateBranch).toContain('activeStartedAt={isActiveWalk(spontaneous) ? spontaneous.startedAt ?? null : null}');
    });

    it('wires local GPS activation, live route/map and distance keyed to this exact walk', () => {
      expect(nonDuplicateBranch).toContain('liveDistanceMeters={gpsTrackingWalkId === spontaneous.id ? gpsDistanceMeters : null}');
      expect(nonDuplicateBranch).toContain('gpsPointCount={gpsTrackingWalkId === spontaneous.id ? gpsPointCount : null}');
      expect(nonDuplicateBranch).toContain('liveRoutePoints={gpsTrackingWalkId === spontaneous.id ? gpsRoutePoints : undefined}');
      expect(nonDuplicateBranch).toContain('gpsTrackingStatus={gpsTrackingWalkId === spontaneous.id ? gpsTrackingStatus : null}');
      expect(nonDuplicateBranch).toContain('onRetryGps={() => {');
      expect(nonDuplicateBranch).toContain('useGpsStore.getState().startTracking(spontaneous)');
    });

    it("uses the authoritative actual-walker field (never a display-name match) for identity, local-GPS gating and finish authorization", () => {
      expect(nonDuplicateBranch).toContain('const spontaneousWalkerId = spontaneous.actualWalkerUserId ?? spontaneous.responsibleUserId;');
      expect(nonDuplicateBranch).toContain('responsible={usersById[spontaneousWalkerId]}');
      expect(nonDuplicateBranch).toMatch(/gpsNotTrackedHere=\{\s*\n\s*isActiveWalk\(spontaneous\) && gpsTrackingWalkId !== spontaneous\.id\s*\n\s*\? \(spontaneousWalkerId === currentUserId \? 'walker_here' : 'elsewhere'\)/);
      expect(nonDuplicateBranch).toContain("canResolve={effectiveRole === 'admin' || spontaneousWalkerId === effectiveUserId}");
    });

    it('still finishes the walk, for the actual walker or any family admin', () => {
      expect(nonDuplicateBranch).toMatch(/onEndWalk=\{\s*\n\s*actualFamilyRole === 'admin' \|\| spontaneous\.actualWalkerUserId === currentUserId \|\| \(!spontaneous\.actualWalkerUserId && spontaneous\.responsibleUserId === currentUserId\)\s*\n\s*\? \(\) => setCompleteWalkId\(spontaneous\.id\)/);
    });
  });
});
