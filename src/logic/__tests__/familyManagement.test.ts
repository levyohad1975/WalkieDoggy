import {
  handleLastAdminGuardedPress,
  isLastActiveAdminMember,
  shouldReloadActivityAfterRoleChange,
  type AdminActivityRoleRow,
} from '../familyManagement';

/**
 * Round 7, Part 3 — regression tests for the "stale activity survives losing
 * admin status" / "role-change ordering" bug fix (see the final report).
 *
 * shouldReloadActivityAfterRoleChange() is the extracted, directly-testable
 * decision FamilyScreen.tsx's handleRoleChanged makes AFTER awaiting
 * authStore.refreshOwnRoleAfterChange(changedUserId) and re-reading
 * familyRole fresh — see both doc comments for the full design. This mirrors
 * how isRealFamilyAdmin() was extracted in round 7 Part 1 for the same
 * reason: no React Native component-rendering test infrastructure exists in
 * this repo (@testing-library/react-native is an unused devDependency), so
 * the pure decision function is what's actually unit-tested here; the
 * surrounding wiring in FamilyScreen.tsx (calling setActivity([]) vs.
 * loadActivity() based on this function's result, and the isRealAdmin-keyed
 * useEffect that clears activity as a backstop) is verified by careful code
 * reading only — see the final report's "boundary between tested and
 * verified" note.
 */
describe('shouldReloadActivityAfterRoleChange', () => {
  // Maps to final-report TESTS item 2: self-demotion succeeded (viewer's
  // freshly-refreshed familyRole is now 'member') -> must NOT reload, i.e.
  // must not fire admin_list_family_activity() again since the server would
  // now correctly reject it (or worse, race non-deterministically).
  it('2. refreshed role is "member" (self-demotion succeeded) -> false (do not reload activity)', () => {
    expect(shouldReloadActivityAfterRoleChange('member')).toBe(false);
  });

  // Maps to final-report TESTS item 3: another member's role changed while
  // the viewer remains admin. refreshOwnRoleAfterChange() no-ops for a
  // non-self change, so the value passed in here is simply the viewer's
  // pre-existing, unaffected 'admin' role -> must reload.
  it('3. refreshed role is "admin" (viewer unaffected by an other-member role change) -> true (reload activity)', () => {
    expect(shouldReloadActivityAfterRoleChange('admin')).toBe(true);
  });

  // Maps to final-report TESTS item 4: the role change succeeded
  // server-side, but the follow-up refreshFamilyRole() read itself failed,
  // which authStore.refreshOwnRoleAfterChange fails closed into
  // familyRole === null (never leaves the stale old role looking
  // authoritative). Activity must be cleared, not reloaded, in this case
  // too — same as the plain self-demotion case above.
  it('4. refreshed role is null (post-success role refresh failed closed) -> false (do not reload activity)', () => {
    expect(shouldReloadActivityAfterRoleChange(null)).toBe(false);
  });

  // Maps to final-report TESTS item 5: self-promotion — the freshly
  // refreshed role is now 'admin' -> a fresh, authorized reload is
  // permitted (and desired, so the modal/list show live data rather than
  // whatever was cached, possibly empty, from before the promotion).
  it('5. refreshed role is "admin" (self-promotion) -> true (reload activity)', () => {
    expect(shouldReloadActivityAfterRoleChange('admin')).toBe(true);
  });

});

/**
 * Round 8, Fix 1: isLastActiveAdminMember() is the extracted rule
 * FamilyScreen.tsx now uses BOTH for MemberDetailsModal's isLastAdmin prop
 * (previously computed inline there) and for gating the Family screen's
 * delete/trash icon — see the final report. Purely a client-side UX guard;
 * admin_delete_family_member() (0007) remains the actual last-admin
 * boundary regardless of what this returns.
 */
describe('isLastActiveAdminMember', () => {
  const admin1: AdminActivityRoleRow = { user_id: 'u1', role: 'admin', removed_at: null };
  const admin2: AdminActivityRoleRow = { user_id: 'u2', role: 'admin', removed_at: null };
  const member1: AdminActivityRoleRow = { user_id: 'u3', role: 'member', removed_at: null };
  const removedAdmin: AdminActivityRoleRow = { user_id: 'u4', role: 'admin', removed_at: '2026-08-01T00:00:00Z' };

  it('sole active admin -> true', () => {
    expect(isLastActiveAdminMember('u1', [admin1, member1])).toBe(true);
  });

  it('one of two active admins -> false', () => {
    expect(isLastActiveAdminMember('u1', [admin1, admin2, member1])).toBe(false);
  });

  it('a plain (non-admin) member -> always false, even as the only active admin exists elsewhere', () => {
    expect(isLastActiveAdminMember('u3', [admin1, member1])).toBe(false);
  });

  it('a removed admin is not counted toward the active-admin total, and is itself never "the last admin"', () => {
    // Only admin1 is active; removedAdmin does not count, and asking about
    // removedAdmin itself must also be false (they're not an active admin).
    expect(isLastActiveAdminMember('u1', [admin1, removedAdmin])).toBe(true);
    expect(isLastActiveAdminMember('u4', [admin1, removedAdmin])).toBe(false);
  });

  it('no matching row for userId (activity not loaded/failed) -> fails open, false', () => {
    expect(isLastActiveAdminMember('unknown', [admin1, member1])).toBe(false);
  });

  it('empty activity array -> fails open, false', () => {
    expect(isLastActiveAdminMember('u1', [])).toBe(false);
  });
});

/**
 * Round 8, Fix 1 — regression tests for the extracted "should this delete
 * tap be a no-op" decision behind FamilyScreen.tsx's trash-icon onPress. The
 * actual real-device bug this round (a `disabled` inner Pressable letting
 * the tap bubble up to the row's own onPress and open MemberDetailsModal)
 * was a touch-responder/propagation issue, not a decision-logic bug — that
 * part is not independently unit-testable without React Native
 * component-rendering/touch-simulation infrastructure, which this repo does
 * not have (see this file's top doc comment); it is verified by careful
 * code reading only (see FamilyScreen.tsx's inline comment on the delete
 * icon Pressable, and the final report). This test covers only the pure
 * decision: does the guarded action get called or not.
 */
describe('handleLastAdminGuardedPress', () => {
  it('isLastAdmin true -> does not call the action', () => {
    const action = jest.fn();
    handleLastAdminGuardedPress(true, action);
    expect(action).not.toHaveBeenCalled();
  });

  it('isLastAdmin false -> calls the action exactly once', () => {
    const action = jest.fn();
    handleLastAdminGuardedPress(false, action);
    expect(action).toHaveBeenCalledTimes(1);
  });
});

// Item 1's "cached activity is cleared" half (shouldReloadActivityAfterRoleChange)
// is covered directly by authStore's own refreshOwnRoleAfterChange tests
// (familyRole -> 'member' on self-demotion) combined with case "2" above (the
// same 'member' input this function receives once that resolves) — together
// they prove the exact decision FamilyScreen.tsx's handleRoleChanged makes
// for a self-demoting admin with previously-populated activity: refresh
// completes, familyRole becomes 'member', and this function says "do not
// reload", so handleRoleChanged calls setActivity([]) directly instead
// (verified by reading FamilyScreen.tsx's handleRoleChanged — not
// independently unit-testable without rendering infrastructure, since it
// closes over component state).
