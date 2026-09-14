import {
  canDeleteScheduledWalk,
  canRequestChangeForWalk,
  computeNextWalkCardActions,
  editWalkDetails,
  formatCompletedAtBadge,
  isCurrentlySwapped,
  markWalkDone,
  markWalkSkipped,
  summarizeWalksByUser,
  swapWalk,
  swapWalksMutual,
  undoMarkDone,
  walkCompletionLine,
  walkHistoryTimingLine,
  walkMetadataLine,
  WalkActionError,
} from '../walkActions';
import type { Walk } from '../../types';

function makeWalk(overrides: Partial<Walk> = {}): Walk {
  return {
    id: 'w1',
    familyId: 'family-1',
    scheduleEntryId: 'e1',
    dogId: 'dog-1',
    date: '2026-08-26',
    scheduledTime: '20:00',
    responsibleUserId: 'noam',
    status: 'pending',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

describe('markWalkDone', () => {
  it('marks a pending walk as done and records who/when', () => {
    const now = new Date('2026-08-26T20:17:00');
    const walk = makeWalk();
    const done = markWalkDone(walk, 'yael', { hadPee: true, hadPoop: false, note: 'הכל טוב' }, now);
    expect(done.status).toBe('done');
    expect(done.completedByUserId).toBe('yael');
    expect(done.completedAt).toBe(now.toISOString());
    expect(done.hadPee).toBe(true);
    expect(done.hadPoop).toBe(false);
    expect(done.note).toBe('הכל טוב');
  });

  it('allows completedByUserId to differ from the originally responsible user', () => {
    const walk = makeWalk({ responsibleUserId: 'noam' });
    const done = markWalkDone(walk, 'yael');
    expect(done.responsibleUserId).toBe('noam');
    expect(done.completedByUserId).toBe('yael');
  });
});

describe('editWalkDetails', () => {
  it('updates pee/poop/note on an already-done walk', () => {
    const walk = makeWalk({ status: 'done', completedByUserId: 'noam' });
    const edited = editWalkDetails(walk, { hadPee: true, hadPoop: true, note: 'טיול ארוך' });
    expect(edited.hadPee).toBe(true);
    expect(edited.hadPoop).toBe(true);
    expect(edited.note).toBe('טיול ארוך');
  });

  it('refuses to edit details of a walk that is not done yet', () => {
    const walk = makeWalk({ status: 'pending' });
    expect(() => editWalkDetails(walk, { hadPee: true })).toThrow(WalkActionError);
  });

  // Final QA round v2 bug fix: a SKIPPED walk's note/pee/poop must also be
  // editable (Home's "✏️ עריכה" link is available for both done and
  // skipped) — this used to throw for 'skipped', which the DB trigger
  // never actually required.
  it('updates note on an already-skipped walk (bug fix)', () => {
    const walk = makeWalk({ status: 'skipped' });
    const edited = editWalkDetails(walk, { note: 'לא הספקנו היום' });
    expect(edited.note).toBe('לא הספקנו היום');
    expect(edited.status).toBe('skipped');
  });

  it('corrects completedByUserId (who actually walked the dog) without touching responsibleUserId', () => {
    const walk = makeWalk({ status: 'done', responsibleUserId: 'noam', completedByUserId: 'noam' });
    const edited = editWalkDetails(walk, { completedByUserId: 'yael' });
    expect(edited.completedByUserId).toBe('yael');
    expect(edited.responsibleUserId).toBe('noam');
  });

  it('rejects marking an already-done walk done again (two people tapping at once)', () => {
    const walk = makeWalk({ status: 'done', completedByUserId: 'noam', completedAt: new Date().toISOString() });
    expect(() => markWalkDone(walk, 'yael')).toThrow(WalkActionError);
  });
});

describe('canDeleteScheduledWalk (mirrors migration 0015 server-side rule)', () => {
  it('admin may delete any scheduled walk regardless of status or responsible user', () => {
    expect(canDeleteScheduledWalk(makeWalk({ status: 'pending' }), 'someone-else', true)).toBe(true);
    expect(canDeleteScheduledWalk(makeWalk({ status: 'done', responsibleUserId: 'noam' }), 'yael', true)).toBe(true);
  });

  it('the responsible member may delete their OWN resolved (done/skipped) walk', () => {
    expect(canDeleteScheduledWalk(makeWalk({ status: 'done', responsibleUserId: 'noam' }), 'noam', false)).toBe(true);
    expect(canDeleteScheduledWalk(makeWalk({ status: 'skipped', responsibleUserId: 'noam' }), 'noam', false)).toBe(
      true
    );
  });

  it('rejects a still-PENDING walk even for its own responsible member (not a status correction)', () => {
    expect(canDeleteScheduledWalk(makeWalk({ status: 'pending', responsibleUserId: 'noam' }), 'noam', false)).toBe(
      false
    );
  });

  it('rejects a different member, even on a resolved walk', () => {
    expect(canDeleteScheduledWalk(makeWalk({ status: 'done', responsibleUserId: 'noam' }), 'yael', false)).toBe(
      false
    );
  });

  it('rejects an unplanned walk — that has its own separate deleteUnplannedWalk path/rule', () => {
    expect(
      canDeleteScheduledWalk(makeWalk({ status: 'done', isUnplanned: true, responsibleUserId: 'noam' }), 'noam', false)
    ).toBe(false);
  });

  it('rejects when there is no signed-in actor', () => {
    expect(canDeleteScheduledWalk(makeWalk({ status: 'done', responsibleUserId: 'noam' }), null, false)).toBe(false);
  });
});

describe('markWalkSkipped', () => {
  it('marks a pending walk as skipped', () => {
    const walk = makeWalk();
    expect(markWalkSkipped(walk).status).toBe('skipped');
  });

  it('refuses to skip a walk that is not pending', () => {
    const walk = makeWalk({ status: 'done' });
    expect(() => markWalkSkipped(walk)).toThrow(WalkActionError);
  });
});

describe('undoMarkDone', () => {
  it('reverts a done walk back to pending, clearing completion info', () => {
    const walk = makeWalk({ status: 'done', completedByUserId: 'noam', completedAt: new Date().toISOString() });
    const reverted = undoMarkDone(walk);
    expect(reverted.status).toBe('pending');
    expect(reverted.completedByUserId).toBeUndefined();
  });

  it('refuses to undo a walk that is not marked done', () => {
    const walk = makeWalk({ status: 'pending' });
    expect(() => undoMarkDone(walk)).toThrow(WalkActionError);
  });
});

describe('swapWalksMutual (החלפה הדדית)', () => {
  it('exchanges responsibility both ways and records an audit trail for each side', () => {
    const now = new Date('2026-08-26T09:00:00');
    const walkA = makeWalk({ id: 'wa', responsibleUserId: 'danny' });
    const walkB = makeWalk({ id: 'wb', responsibleUserId: 'yael' });
    const [swappedA, swappedB] = swapWalksMutual(walkA, walkB, 'danny', now);

    expect(swappedA.responsibleUserId).toBe('yael');
    expect(swappedA.swap).toEqual({
      originalUserId: 'danny',
      newUserId: 'yael',
      swappedAt: now.toISOString(),
      swappedByUserId: 'danny',
    });
    expect(swappedB.responsibleUserId).toBe('danny');
    expect(swappedB.swap).toEqual({
      originalUserId: 'yael',
      newUserId: 'danny',
      swappedAt: now.toISOString(),
      swappedByUserId: 'danny',
    });
  });

  it('preserves each walk\'s original responsible user across a repeat mutual swap', () => {
    const walkA = makeWalk({ id: 'wa', responsibleUserId: 'danny' });
    const walkB = makeWalk({ id: 'wb', responsibleUserId: 'yael' });
    const [firstA, firstB] = swapWalksMutual(walkA, walkB, 'danny');
    const [secondA, secondB] = swapWalksMutual(firstA, firstB, 'yael');

    expect(secondA.swap?.originalUserId).toBe('danny');
    expect(secondA.responsibleUserId).toBe('danny');
    expect(secondB.swap?.originalUserId).toBe('yael');
    expect(secondB.responsibleUserId).toBe('yael');
  });

  it('refuses to swap when either walk is not pending', () => {
    const walkA = makeWalk({ id: 'wa', status: 'done' });
    const walkB = makeWalk({ id: 'wb' });
    expect(() => swapWalksMutual(walkA, walkB, 'danny')).toThrow(WalkActionError);
    expect(() => swapWalksMutual(walkB, walkA, 'danny')).toThrow(WalkActionError);
  });

  it('refuses to swap a walk with itself', () => {
    const walk = makeWalk({ id: 'wa' });
    expect(() => swapWalksMutual(walk, walk, 'danny')).toThrow(WalkActionError);
  });
});

describe('swapWalk (החלף תור)', () => {
  it('reassigns responsibility and records the audit trail', () => {
    const now = new Date('2026-08-26T09:00:00');
    const walk = makeWalk({ responsibleUserId: 'danny' });
    const swapped = swapWalk(walk, 'yael', 'danny', now);
    expect(swapped.responsibleUserId).toBe('yael');
    expect(swapped.swap).toEqual({
      originalUserId: 'danny',
      newUserId: 'yael',
      swappedAt: now.toISOString(),
      swappedByUserId: 'danny',
    });
  });

  it('preserves the original responsible user across multiple swaps', () => {
    const walk = makeWalk({ responsibleUserId: 'danny' });
    const first = swapWalk(walk, 'yael', 'danny');
    const second = swapWalk(first, 'noam', 'yael');
    expect(second.swap?.originalUserId).toBe('danny');
    expect(second.swap?.newUserId).toBe('noam');
  });

  it('refuses to swap a walk that already happened', () => {
    const walk = makeWalk({ status: 'done' });
    expect(() => swapWalk(walk, 'yael', 'danny')).toThrow(WalkActionError);
  });

  it('refuses swapping to the same person already responsible', () => {
    const walk = makeWalk({ responsibleUserId: 'danny' });
    expect(() => swapWalk(walk, 'danny', 'yael')).toThrow(WalkActionError);
  });
});

describe('isCurrentlySwapped ("הוחלף" must reflect current vs. original assignment)', () => {
  it('is false for a walk that was never swapped', () => {
    const walk = makeWalk({ responsibleUserId: 'danny' });
    expect(isCurrentlySwapped(walk)).toBe(false);
  });

  it('A -> B is swapped', () => {
    const walk = makeWalk({ responsibleUserId: 'danny' });
    const swapped = swapWalk(walk, 'yael', 'danny');
    expect(isCurrentlySwapped(swapped)).toBe(true);
  });

  it('A -> B -> A is NOT swapped (back to the original assignee)', () => {
    const walk = makeWalk({ responsibleUserId: 'danny' });
    const toYael = swapWalk(walk, 'yael', 'danny');
    const backToDanny = swapWalk(toYael, 'danny', 'yael');
    expect(isCurrentlySwapped(backToDanny)).toBe(false);
  });

  it('A -> B -> C is still swapped', () => {
    const walk = makeWalk({ responsibleUserId: 'danny' });
    const toYael = swapWalk(walk, 'yael', 'danny');
    const toNoam = swapWalk(toYael, 'noam', 'yael');
    expect(isCurrentlySwapped(toNoam)).toBe(true);
    expect(toNoam.swap?.originalUserId).toBe('danny');
  });
});

describe('summarizeWalksByUser (weekly summary)', () => {
  it('counts only completed walks, grouped by who actually did them', () => {
    const walks = [
      makeWalk({ id: 'w1', status: 'done', completedByUserId: 'danny' }),
      makeWalk({ id: 'w2', status: 'done', completedByUserId: 'danny' }),
      makeWalk({ id: 'w3', status: 'done', completedByUserId: 'yael' }),
      makeWalk({ id: 'w4', status: 'skipped' }),
      makeWalk({ id: 'w5', status: 'pending' }),
    ];
    expect(summarizeWalksByUser(walks)).toEqual({ danny: 2, yael: 1 });
  });
});

/**
 * QA/UX round, Part A/I: the single shared eligibility predicate for
 * "בקש החלפה"/"בקש שינוי שעה" — previously duplicated (correctly) in
 * ScheduleScreen and (missing entirely) in HomeScreen. These tests cover
 * every gate independently.
 */
describe('canRequestChangeForWalk', () => {
  const future = new Date('2026-09-10T12:00:00');
  const futureWalk = makeWalk({
    date: '2026-09-11',
    scheduledTime: '09:00',
    status: 'pending',
    responsibleUserId: 'noam',
  });

  it('true for the walk\'s own responsible member, a future pending walk, in Supabase mode', () => {
    expect(canRequestChangeForWalk(futureWalk, 'noam', 'member', true, future)).toBe(true);
  });

  it('false when Supabase is not configured (local/demo mode has no request system)', () => {
    expect(canRequestChangeForWalk(futureWalk, 'noam', 'member', false, future)).toBe(false);
  });

  it('false for an admin — admins act directly, never through the request flow', () => {
    expect(canRequestChangeForWalk(futureWalk, 'noam', 'admin', true, future)).toBe(false);
  });

  it('false for a DIFFERENT member than the one responsible for the walk', () => {
    expect(canRequestChangeForWalk(futureWalk, 'someone-else', 'member', true, future)).toBe(false);
  });

  it('false for a walk that is not pending (already done/skipped)', () => {
    expect(canRequestChangeForWalk({ ...futureWalk, status: 'done' }, 'noam', 'member', true, future)).toBe(false);
  });

  it('false for a past/overdue walk relative to `now`', () => {
    const pastWalk = makeWalk({ date: '2026-09-01', scheduledTime: '09:00', status: 'pending', responsibleUserId: 'noam' });
    expect(canRequestChangeForWalk(pastWalk, 'noam', 'member', true, future)).toBe(false);
  });
});

/**
 * BATCH 3 (Task 5 — walk card action authority / Task 11's test list).
 * computeNextWalkCardActions() is what HomeScreen's top Action Card now
 * uses to decide onSwap/onEdit/onRequestSwap/onRequestTimeChange — this
 * directly guards against the regression that motivated Task 5: the top
 * card previously showed "בקש שינוי שעה"/"בקש החלפה" to ANY non-admin
 * member (`effectiveRole !== 'admin'`), not only the walk's own
 * responsible member.
 */
describe('computeNextWalkCardActions', () => {
  const future = new Date('2026-09-10T12:00:00');
  const futureWalk = makeWalk({
    date: '2026-09-11',
    scheduledTime: '09:00',
    status: 'pending',
    responsibleUserId: 'noam',
  });

  it('responsible member sees the request-time-change action', () => {
    const actions = computeNextWalkCardActions(futureWalk, 'noam', 'member', true, future);
    expect(actions.canRequestTimeChange).toBe(true);
  });

  it('responsible member sees the request-swap action', () => {
    const actions = computeNextWalkCardActions(futureWalk, 'noam', 'member', true, future);
    expect(actions.canRequestSwap).toBe(true);
  });

  it('responsible member does NOT get the direct-edit actions (those are Admin-only)', () => {
    const actions = computeNextWalkCardActions(futureWalk, 'noam', 'member', true, future);
    expect(actions.canSwapDirect).toBe(false);
    expect(actions.canEditDirect).toBe(false);
  });

  it('a DIFFERENT (non-responsible) member sees none of the four actions', () => {
    const actions = computeNextWalkCardActions(futureWalk, 'someone-else', 'member', true, future);
    expect(actions).toEqual({
      canSwapDirect: false,
      canEditDirect: false,
      canRequestSwap: false,
      canRequestTimeChange: false,
    });
  });

  it('a non-responsible Family Admin does NOT get the responsible-member request actions merely for being admin', () => {
    const actions = computeNextWalkCardActions(futureWalk, 'admin-user', 'admin', true, future);
    expect(actions.canRequestSwap).toBe(false);
    expect(actions.canRequestTimeChange).toBe(false);
  });

  it('a non-responsible Family Admin DOES get the direct edit/swap authority instead', () => {
    const actions = computeNextWalkCardActions(futureWalk, 'admin-user', 'admin', true, future);
    expect(actions.canSwapDirect).toBe(true);
    expect(actions.canEditDirect).toBe(true);
  });

  it('even the walk\'s OWN responsible user gets only the direct-edit path once they are admin (never the request path)', () => {
    const actions = computeNextWalkCardActions(futureWalk, 'noam', 'admin', true, future);
    expect(actions.canRequestSwap).toBe(false);
    expect(actions.canRequestTimeChange).toBe(false);
    expect(actions.canSwapDirect).toBe(true);
    expect(actions.canEditDirect).toBe(true);
  });
});

describe('walkMetadataLine', () => {
  it('null for a plain scheduled walk with no swap/unplanned flag', () => {
    expect(walkMetadataLine(makeWalk())).toBeNull();
  });

  it('"טיול ספונטני" for an unplanned walk', () => {
    expect(walkMetadataLine(makeWalk({ isUnplanned: true }))).toBe('טיול ספונטני');
  });

  it('"הוחלף" for a currently-swapped walk (current responsible differs from original)', () => {
    const swapped = makeWalk({
      responsibleUserId: 'b',
      swap: { originalUserId: 'a', swappedAt: new Date().toISOString(), newUserId: 'b', swappedByUserId: 'a' } as never,
    });
    expect(walkMetadataLine(swapped)).toBeNull();
  });

  it('joins both when a walk is both unplanned and swapped', () => {
    const both = makeWalk({
      isUnplanned: true,
      responsibleUserId: 'b',
      swap: { originalUserId: 'a', swappedAt: new Date().toISOString(), newUserId: 'b', swappedByUserId: 'a' } as never,
    });
    expect(walkMetadataLine(both)).toBe('טיול ספונטני');
  });

  it('null once a swap returns to its original assignee (A -> B -> A)', () => {
    const backToOriginal = makeWalk({
      responsibleUserId: 'a',
      swap: { originalUserId: 'a', swappedAt: new Date().toISOString(), newUserId: 'b', swappedByUserId: 'a' } as never,
    });
    expect(walkMetadataLine(backToOriginal)).toBeNull();
  });
});

describe('walkCompletionLine', () => {
  const completedBy = { name: 'אמא' };

  it('null for a pending (not-yet-done) walk', () => {
    expect(walkCompletionLine(makeWalk({ status: 'pending' }), completedBy, false)).toBeNull();
  });

  it('null when completedBy is unknown', () => {
    expect(walkCompletionLine(makeWalk({ status: 'done' }), undefined, false)).toBeNull();
  });

  it('null when the caller is rendering interactive toggles instead (hasToggles=true)', () => {
    expect(walkCompletionLine(makeWalk({ status: 'done' }), completedBy, true)).toBeNull();
  });

  it('includes name, time, and pee/poop emoji when present', () => {
    const walk = makeWalk({
      status: 'done',
      completedAt: '2026-08-26T18:30:00.000Z',
      hadPee: true,
      hadPoop: true,
    });
    const line = walkCompletionLine(walk, completedBy, false);
    expect(line).toContain('בוצע ע״י אמא');
    expect(line).toContain('💧');
    expect(line).toContain('💩');
  });

  it('omits pee/poop segments when neither happened', () => {
    const walk = makeWalk({ status: 'done', hadPee: false, hadPoop: false });
    const line = walkCompletionLine(walk, completedBy, false);
    expect(line).not.toContain('💧');
    expect(line).not.toContain('💩');
  });

  it('marks the completer\'s name "(הוסר)" when they have since been removed from the family', () => {
    const walk = makeWalk({ status: 'done' });
    const line = walkCompletionLine(walk, { name: 'אמא', removedAt: '2026-08-27T00:00:00.000Z' }, false);
    expect(line).toContain('בוצע ע״י אמא (הוסר)');
  });
});

/**
 * BATCH 4 (item F — completedAt UX). Direct tests of the two new pure
 * formatting helpers. Time values are computed via the SAME
 * toLocaleTimeString('he-IL', ...) call used by the implementation rather
 * than hardcoded, so these tests stay correct under any test-runner
 * timezone.
 */
describe('formatCompletedAtBadge', () => {
  it('empty string for a pending walk', () => {
    expect(formatCompletedAtBadge(makeWalk({ status: 'pending' }))).toBe('');
  });

  it('empty string for a skipped walk', () => {
    expect(formatCompletedAtBadge(makeWalk({ status: 'skipped' }))).toBe('');
  });

  it('"✓ בוצע" with no time when done but completedAt is missing (legacy data)', () => {
    expect(formatCompletedAtBadge(makeWalk({ status: 'done', completedAt: undefined }))).toBe('✓ בוצע');
  });

  it('"✓ בוצע · HH:MM" per the Master Specification\'s exact display example', () => {
    const completedAt = '2026-08-26T18:30:00.000Z';
    const expectedTime = new Date(completedAt).toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' });
    expect(formatCompletedAtBadge(makeWalk({ status: 'done', completedAt }))).toBe(`✓ בוצע · ${expectedTime}`);
  });
});

describe('walkHistoryTimingLine', () => {
  it('null for a pending walk', () => {
    expect(walkHistoryTimingLine(makeWalk({ status: 'pending' }))).toBeNull();
  });

  it('null for a skipped walk', () => {
    expect(walkHistoryTimingLine(makeWalk({ status: 'skipped' }))).toBeNull();
  });

  it('null for a done walk with no completedAt on record (legacy data) — no broken/partial line', () => {
    expect(walkHistoryTimingLine(makeWalk({ status: 'done', completedAt: undefined }))).toBeNull();
  });

  it('"תוכנן HH:MM · בוצע HH:MM" — planned scheduledTime vs. actual completedAt, per the Master Specification\'s exact example', () => {
    const completedAt = '2026-08-26T18:18:00.000Z';
    const expectedActual = new Date(completedAt).toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' });
    const walk = makeWalk({ status: 'done', scheduledTime: '20:00', completedAt });
    expect(walkHistoryTimingLine(walk)).toBe(`תוכנן 20:00 · בוצע ${expectedActual}`);
  });
});
