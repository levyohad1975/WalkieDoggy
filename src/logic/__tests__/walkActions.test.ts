import {
  canDeleteScheduledWalk,
  canRequestChangeForWalk,
  editWalkDetails,
  isCurrentlySwapped,
  markWalkDone,
  markWalkSkipped,
  summarizeWalksByUser,
  swapWalk,
  undoMarkDone,
  walkCompletionLine,
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
    expect(walkMetadataLine(swapped)).toBe('הוחלף');
  });

  it('joins both when a walk is both unplanned and swapped', () => {
    const both = makeWalk({
      isUnplanned: true,
      responsibleUserId: 'b',
      swap: { originalUserId: 'a', swappedAt: new Date().toISOString(), newUserId: 'b', swappedByUserId: 'a' } as never,
    });
    expect(walkMetadataLine(both)).toBe('טיול ספונטני · הוחלף');
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
});
