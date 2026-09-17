import {
  computeUserDeletionImpact,
  FamilyManagementError,
  handleLastAdminGuardedPress,
  isLastActiveAdminMember,
  planUserRemoval,
  shouldReloadActivityAfterRoleChange,
  type AdminActivityRoleRow,
} from '../familyManagement';
import type { ScheduleEntry, ScheduleRule, Walk } from '../../types';

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

/**
 * computeUserDeletionImpact() / planUserRemoval() power familyStore.ts's
 * deleteUser() (see familyStore.test.ts's "deleteUser (soft delete,
 * preserving history)" describe block, which exercises both indirectly
 * through the demo dataset). These tests cover the two directly, including
 * the no-replacement-leaves-an-empty-rotation throw and the walk
 * reassignment branches that the demo-data scenarios don't happen to hit
 * (a walk whose linked entry was itself reassigned vs. one that falls back
 * to the replacement directly vs. one with neither).
 */
function rule(overrides: Partial<ScheduleRule> = {}): ScheduleRule {
  return {
    id: 'rule-1',
    familyId: 'family-1',
    dogId: 'dog-1',
    time: '08:00',
    daysOfWeek: [0, 1, 2, 3, 4, 5, 6],
    rotationUserIds: ['u1', 'u2'],
    rotationAnchorDate: '2026-01-01',
    sortOrder: 0,
    active: true,
    createdAt: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

function entry(overrides: Partial<ScheduleEntry> = {}): ScheduleEntry {
  return {
    id: 'entry-1',
    familyId: 'family-1',
    dogId: 'dog-1',
    date: '2026-09-15',
    time: '08:00',
    responsibleUserId: 'u1',
    createdAt: '2026-09-01T00:00:00Z',
    ...overrides,
  };
}

function walk(overrides: Partial<Walk> = {}): Walk {
  return {
    id: 'walk-1',
    familyId: 'family-1',
    dogId: 'dog-1',
    date: '2026-09-15',
    scheduledTime: '08:00',
    responsibleUserId: 'u1',
    status: 'pending',
    createdAt: '2026-09-01T00:00:00Z',
    updatedAt: '2026-09-01T00:00:00Z',
    ...overrides,
  };
}

const noResolve = () => {
  throw new Error('resolveResponsibleForDate should not be called in this test');
};

describe('computeUserDeletionImpact', () => {
  const today = '2026-09-15';

  it('counts only future (not past) schedule entries where the user is responsible', () => {
    const entries = [
      entry({ id: 'future', date: '2026-09-16', responsibleUserId: 'u1' }),
      entry({ id: 'today', date: today, responsibleUserId: 'u1' }),
      entry({ id: 'past', date: '2026-09-14', responsibleUserId: 'u1' }),
      entry({ id: 'other-user', date: '2026-09-16', responsibleUserId: 'u2' }),
    ];
    const impact = computeUserDeletionImpact('u1', [], entries, [], today);
    expect(impact.futureScheduleEntryCount).toBe(2); // "future" and "today", not "past" or "other-user"
  });

  it('lists the ids of every rule whose rotation includes the user, regardless of `active`', () => {
    const rules = [
      rule({ id: 'r1', rotationUserIds: ['u1', 'u2'], active: true }),
      rule({ id: 'r2', rotationUserIds: ['u1'], active: false }),
      rule({ id: 'r3', rotationUserIds: ['u2'], active: true }),
    ];
    const impact = computeUserDeletionImpact('u1', rules, [], [], today);
    expect(impact.rulesAffected).toEqual(['r1', 'r2']);
  });

  it('counts a swapped-to walk (responsibleUserId=user, but its linked entry belongs to someone else) as directly-assigned impact', () => {
    // Mirrors a real swap: the rotation's own entry never changed owner, only
    // the one-off walk did — see swapWalk()/swapWalksMutual() in walkActions.ts.
    const entries = [entry({ id: 'e1', date: '2026-09-20', responsibleUserId: 'other-owner' })];
    const walks = [walk({ id: 'w1', scheduleEntryId: 'e1', date: '2026-09-20', responsibleUserId: 'u1', status: 'pending' })];
    const impact = computeUserDeletionImpact('u1', [], entries, walks, today);
    expect(impact.directlyAssignedWalkCount).toBe(1);
    expect(impact.futureScheduleEntryCount).toBe(0); // the entry itself is not owned by u1
  });

  it('does NOT double count a walk whose linked entry is also owned by the user — planUserRemoval reassigns it via the entry, no replacement required', () => {
    const entries = [entry({ id: 'e1', date: '2026-09-20', responsibleUserId: 'u1' })];
    const walks = [walk({ id: 'w1', scheduleEntryId: 'e1', date: '2026-09-20', responsibleUserId: 'u1', status: 'pending' })];
    const impact = computeUserDeletionImpact('u1', [], entries, walks, today);
    expect(impact.futureScheduleEntryCount).toBe(1);
    expect(impact.directlyAssignedWalkCount).toBe(0);
  });

  it('counts an unplanned walk (no linked entry at all) directly assigned to the user', () => {
    const walks = [walk({ id: 'w1', scheduleEntryId: undefined, responsibleUserId: 'u1', status: 'pending', date: '2026-09-20', isUnplanned: true })];
    const impact = computeUserDeletionImpact('u1', [], [], walks, today);
    expect(impact.directlyAssignedWalkCount).toBe(1);
  });

  it('ignores directly-assigned walks that are not pending, not for this user, or already in the past', () => {
    const walks = [
      walk({ id: 'done', status: 'done', responsibleUserId: 'u1', date: '2026-09-20' }),
      walk({ id: 'other-user', status: 'pending', responsibleUserId: 'u2', date: '2026-09-20' }),
      walk({ id: 'past', status: 'pending', responsibleUserId: 'u1', date: '2026-09-01' }),
    ];
    const impact = computeUserDeletionImpact('u1', [], [], walks, today);
    expect(impact.directlyAssignedWalkCount).toBe(0);
  });
});

describe('planUserRemoval', () => {
  const today = '2026-09-15';

  it('throws the Hebrew "sole rotation member" error, as a FamilyManagementError, when no replacement is given and removal would empty a rotation', () => {
    const rules = [rule({ id: 'r1', rotationUserIds: ['u1'] })];
    expect(() => planUserRemoval('u1', null, rules, [], [], today, noResolve)).toThrow(FamilyManagementError);
    expect(() => planUserRemoval('u1', null, rules, [], [], today, noResolve)).toThrow(
      'אי אפשר למחוק — זה בן המשפחה היחיד בסבב הזה. בחר מי יחליף אותו.'
    );
  });

  it('with no replacement, drops the user from a multi-person rotation instead of throwing', () => {
    const rules = [rule({ id: 'r1', rotationUserIds: ['u1', 'u2'] })];
    const result = planUserRemoval('u1', null, rules, [], [], today, noResolve);
    expect(result.updatedRules).toEqual([expect.objectContaining({ id: 'r1', rotationUserIds: ['u2'] })]);
  });

  it('with a replacement, substitutes them in place within the rotation rather than dropping the slot', () => {
    const rules = [rule({ id: 'r1', rotationUserIds: ['u1', 'u2'] })];
    const result = planUserRemoval('u1', 'u3', rules, [], [], today, noResolve);
    expect(result.updatedRules).toEqual([expect.objectContaining({ id: 'r1', rotationUserIds: ['u3', 'u2'] })]);
  });

  it('with no replacement, a pending future walk linked to a reassigned entry picks up the entry\'s newly resolved responsible user', () => {
    const rules = [rule({ id: 'r1', rotationUserIds: ['u1', 'u2'] })];
    const entries = [entry({ id: 'e1', ruleId: 'r1', date: '2026-09-20', responsibleUserId: 'u1' })];
    const walks = [walk({ id: 'w1', scheduleEntryId: 'e1', date: '2026-09-20', responsibleUserId: 'u1' })];
    const result = planUserRemoval('u1', null, rules, entries, walks, today, () => 'u2');
    expect(result.updatedEntries[0].responsibleUserId).toBe('u2');
    expect(result.updatedWalks[0].responsibleUserId).toBe('u2'); // followed the reassigned entry, not left on the removed user
  });

  it('a walk pointing at an entry that was NOT reassigned (e.g. already in the past) falls back to the replacement user instead', () => {
    const walks = [walk({ id: 'w1', scheduleEntryId: 'past-entry', date: '2026-09-20', responsibleUserId: 'u1' })];
    // entries is empty, so the walk's scheduleEntryId can never resolve to an
    // updated entry — exercises the `linkedEntry` lookup finding nothing.
    const result = planUserRemoval('u1', 'u3', [], [], walks, today, noResolve);
    expect(result.updatedWalks[0].responsibleUserId).toBe('u3');
  });

  it('a pending walk with no linked entry (unplanned) falls back directly to the replacement user', () => {
    const walks = [walk({ id: 'w1', scheduleEntryId: undefined, responsibleUserId: 'u1', isUnplanned: true })];
    const result = planUserRemoval('u1', 'u3', [], [], walks, today, noResolve);
    expect(result.updatedWalks).toEqual([expect.objectContaining({ id: 'w1', responsibleUserId: 'u3' })]);
  });

  it('a pending walk with neither a linked entry nor a replacement user is left out of updatedWalks entirely', () => {
    const walks = [walk({ id: 'w1', scheduleEntryId: undefined, responsibleUserId: 'u1' })];
    const result = planUserRemoval('u1', null, [], [], walks, today, noResolve);
    expect(result.updatedWalks).toHaveLength(0);
  });

  it('only reassigns entries that both belong to the removed user AND are not already in the past', () => {
    const entries = [
      entry({ id: 'mine-future', date: '2026-09-20', responsibleUserId: 'u1' }),
      entry({ id: 'other-user-future', date: '2026-09-20', responsibleUserId: 'u2' }),
      entry({ id: 'mine-past', date: '2026-09-01', responsibleUserId: 'u1' }),
    ];
    const result = planUserRemoval('u1', 'u3', [], entries, [], today, noResolve);
    expect(result.updatedEntries.map((e) => e.id)).toEqual(['mine-future']);
  });

  it('leaves rules that do not include the removed user untouched (not even returned in updatedRules)', () => {
    const rules = [rule({ id: 'r1', rotationUserIds: ['u2', 'u3'] })];
    const result = planUserRemoval('u1', 'u4', rules, [], [], today, noResolve);
    expect(result.updatedRules).toHaveLength(0);
  });

  it('with no replacement, a future entry whose rule has no fallback resolver match is left out of updatedEntries rather than nulled out', () => {
    // ruleId points at a rule that was never in `rules` at all, so
    // rulesById has no entry for it — the same "no rule to fall back on"
    // situation as an entry with no ruleId.
    const entries = [entry({ id: 'e1', ruleId: 'missing-rule', date: '2026-09-20', responsibleUserId: 'u1' })];
    const result = planUserRemoval('u1', null, [], entries, [], today, noResolve);
    expect(result.updatedEntries).toHaveLength(0);
  });

  it('ignores walks that are not pending, not for this user, or in the past', () => {
    const walks = [
      walk({ id: 'done', status: 'done', responsibleUserId: 'u1', date: '2026-09-20' }),
      walk({ id: 'other-user', status: 'pending', responsibleUserId: 'u2', date: '2026-09-20' }),
      walk({ id: 'past', status: 'pending', responsibleUserId: 'u1', date: '2026-09-01' }),
    ];
    const result = planUserRemoval('u1', 'u3', [], [], walks, today, noResolve);
    expect(result.updatedWalks).toHaveLength(0);
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
