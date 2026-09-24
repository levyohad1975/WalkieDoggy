/**
 * Structural regression guard for FamilyOnboardingScreen.tsx's create/join
 * flows. This repo has no React Native component-rendering test
 * infrastructure (see FamilyOnboardingScreen.tokenSafety.test.ts's own doc
 * comment), so — like that file — this is a plain source-text scan.
 *
 * What this guards against (both were real bugs found in a repo audit):
 *
 * 1. Creating a family now requires a verified, non-anonymous admin
 *    identity, revalidated immediately before createVerifiedFamily(). Joining an
 *    existing family keeps the anonymous-session retry guard because that
 *    flow intentionally remains device/membership based.
 *
 * 2. Both catch blocks reimplemented raw error-message extraction inline
 *    instead of calling the shared friendlyErrorMessage() helper (used by
 *    this same screen's inspectInvite()/confirmRedeem()) — showing raw
 *    English/Postgres error text (e.g. "must be authenticated to join a
 *    family") directly in the Hebrew UI instead of the mapped friendly
 *    string. See errorMessages.ts's own doc comment: this is exactly the
 *    class of bug that file exists to prevent ("A5 repro bug").
 */
describe('FamilyOnboardingScreen — create/join auth guard and error mapping (structural)', () => {
  const source = require('fs').readFileSync(require.resolve('../FamilyOnboardingScreen'), 'utf8');

  function bodyOf(fnName: string): string {
    const start = source.indexOf(`const ${fnName} = async () => {`);
    expect(start).toBeGreaterThan(-1);
    const end = source.indexOf('\n  };', start);
    expect(end).toBeGreaterThan(start);
    return source.slice(start, end);
  }

  it('submitCreate() revalidates a verified admin identity before calling createVerifiedFamily()', () => {
    const body = bodyOf('submitCreate');
    const identityIdx = body.indexOf('getVerifiedAdminIdentity()');
    const createIdx = body.indexOf('createVerifiedFamily(');
    expect(identityIdx).toBeGreaterThan(-1);
    expect(createIdx).toBeGreaterThan(-1);
    expect(identityIdx).toBeLessThan(createIdx);
    expect(body).not.toContain('ensureAnonymousSession()');
  });

  it('submitCreate() never calls setFamilyId() for a pending (unapproved) family', () => {
    // AUTO_APPROVE_NEW_FAMILIES=false makes create-verified-family return
    // approvalStatus: 'pending'. The client must show the pending screen
    // instead of treating the caller as an admitted family member -- so the
    // 'pending' branch's own return must come strictly before setFamilyId(),
    // not merely appear earlier in the function by coincidence.
    const body = bodyOf('submitCreate');
    const pendingCheckIdx = body.indexOf("family.approvalStatus === 'pending'");
    const pendingSetIdx = body.indexOf('setPendingApprovalFamilyName(family.name)');
    expect(pendingCheckIdx).toBeGreaterThan(-1);
    expect(pendingSetIdx).toBeGreaterThan(pendingCheckIdx);
    const returnIdx = body.indexOf('return;', pendingSetIdx);
    const setFamilyIdIdx = body.indexOf('setFamilyId(family.id)');
    expect(returnIdx).toBeGreaterThan(pendingSetIdx);
    expect(setFamilyIdIdx).toBeGreaterThan(returnIdx);
  });

  it('confirmJoin() ensures an anonymous session before calling joinFamily()', () => {
    const body = bodyOf('confirmJoin');
    const sessionIdx = body.indexOf('ensureAnonymousSession()');
    const joinIdx = body.indexOf('joinFamily(');
    expect(sessionIdx).toBeGreaterThan(-1);
    expect(joinIdx).toBeGreaterThan(-1);
    expect(sessionIdx).toBeLessThan(joinIdx);
  });

  it('submitCreate() and confirmJoin() map errors through friendlyErrorMessage(), not raw extraction', () => {
    const createBody = bodyOf('submitCreate');
    const joinBody = bodyOf('confirmJoin');

    expect(createBody).toMatch(/setCreateError\(friendlyErrorMessage\(e\)\)/);
    expect(joinBody).toMatch(/setJoinError\(friendlyErrorMessage\(e\)\)/);

    // Guards against reintroducing the old ad-hoc "e instanceof Error ?
    // e.message : ..." style extraction in either catch block.
    expect(createBody).not.toMatch(/e instanceof Error \? e\.message/);
    expect(joinBody).not.toMatch(/e instanceof Error \? e\.message/);
  });

  it('lookup() maps backend errors through friendlyErrorMessage(), never raw e.message', () => {
    const lookupStart = source.indexOf('const lookup = async () =>');
    const lookupEnd = source.indexOf('const confirmJoin = async () =>', lookupStart);
    const lookupBody = source.slice(lookupStart, lookupEnd);
    expect(lookupBody).toMatch(/setJoinError\(friendlyErrorMessage\(e\)\)/);
    expect(lookupBody).not.toMatch(/e instanceof Error \? e\.message/);
  });
});
