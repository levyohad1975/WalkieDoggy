import type { Walk } from '../types';
import { walkDateTime } from './nextWalk';

export class WalkActionError extends Error {}

/**
 * QA/UX round, Part A fix: the single eligibility rule for showing
 * "בקש החלפה"/"בקש שינוי שעה" on a future walk. Previously ScheduleScreen
 * had this exact predicate inline and HomeScreen had NO equivalent at all
 * (its upcoming-walks list only ever wired the admin-only `onPress`, so a
 * Member had no way to request a swap/time-change for their own future
 * walk from Home) — two screens, one only partially implementing the rule.
 * Extracted here so both screens call the same function; changing the
 * rule in one place changes it everywhere.
 *
 *   - `isSupabaseConfigured`: the request system is a Supabase RPC
 *     (createSwap/createTimeChange) — nothing to request against in
 *     local/demo mode.
 *   - `role !== 'admin'`: an admin acts directly (EditWalkModal), never
 *     through the request/approval flow.
 *   - `walk.status === 'pending'`: not already done/skipped.
 *   - `walkDateTime(walk).getTime() > now`: strictly in the future —
 *     excludes overdue/past walks (those get the ✓/✕ resolve action
 *     instead, a different flow entirely).
 *   - `walk.responsibleUserId === userId`: only the walk's own current
 *     assignee may request a change to it, never another member's walk.
 *
 * `userId`/`role` are meant to be the caller's EFFECTIVE identity
 * (`effectiveUserId`/`effectiveRole` from authStore) so this behaves
 * correctly under real-impersonation/Test Mode exactly as it did before
 * extraction — this function itself has no opinion on where those values
 * come from, it just takes them as plain arguments.
 */
export function canRequestChangeForWalk(
  walk: Walk,
  userId: string | null | undefined,
  role: 'admin' | 'member' | null | undefined,
  isSupabaseConfigured: boolean,
  now: Date = new Date()
): boolean {
  return (
    isSupabaseConfigured &&
    role !== 'admin' &&
    walk.status === 'pending' &&
    walkDateTime(walk).getTime() > now.getTime() &&
    walk.responsibleUserId === userId
  );
}

/**
 * BATCH 3 (Task 5 — walk card action authority) bundles the four action
 * flags for the top/current Action Card (HomeScreen's NextWalkCard — see
 * that component's own doc comment on the onSwap/onEdit vs
 * onRequestSwap/onRequestTimeChange distinction) into one small,
 * independently-testable pure function.
 *
 * Extracted specifically because HomeScreen previously computed
 * onRequestSwap/onRequestTimeChange visibility inline as
 * `effectiveRole !== 'admin'` — which is wrong (it showed the request
 * actions to ANY non-admin member, not only the walk's own responsible,
 * non-admin member) and, being inline JSX, was never covered by a unit
 * test. ScheduleScreen's lower list already called canRequestChangeForWalk
 * directly and was already correct; this gives the top card the exact same
 * rule via the exact same underlying predicate, with its own named test
 * cases (see logic/__tests__/walkActions.test.ts) tied directly to that
 * regression.
 *
 * Master Spec rules (§ WALK CARD ACTION AUTHORITY):
 *   - RESPONSIBLE MEMBER (non-admin, own future pending walk): request
 *     actions only — canSwapDirect/canEditDirect stay false for a member,
 *     admin status is required for those.
 *   - NON-RESPONSIBLE MEMBER: none of the four.
 *   - FAMILY ADMIN who is NOT responsible: admin status alone must not
 *     grant the responsible-member REQUEST actions — canRequestSwap/
 *     canRequestTimeChange are always false for role === 'admin'
 *     (canRequestChangeForWalk's own rule), regardless of responsibility.
 *     An admin gets the direct edit path instead (canSwapDirect/
 *     canEditDirect), unconditional on responsibility, since a Family
 *     Admin's direct-edit authority does not depend on being the walk's
 *     own responsible member.
 */
export interface NextWalkCardActionFlags {
  /** Direct reassignment — Family Admin only, never a request. */
  canSwapDirect: boolean;
  /** Direct time edit — Family Admin only, never a request. */
  canEditDirect: boolean;
  /** "בקש החלפה" — the walk's own responsible, non-admin member only. */
  canRequestSwap: boolean;
  /** "בקש שינוי שעה" — the walk's own responsible, non-admin member only. */
  canRequestTimeChange: boolean;
}

export function computeNextWalkCardActions(
  walk: Walk,
  userId: string | null | undefined,
  role: 'admin' | 'member' | null | undefined,
  isSupabaseConfigured: boolean,
  now: Date = new Date()
): NextWalkCardActionFlags {
  const isAdmin = role === 'admin';
  const canRequest = canRequestChangeForWalk(walk, userId, role, isSupabaseConfigured, now);
  return {
    canSwapDirect: isAdmin,
    canEditDirect: isAdmin,
    canRequestSwap: canRequest,
    canRequestTimeChange: canRequest,
  };
}

export interface WalkCompletionDetails {
  hadPee?: boolean;
  hadPoop?: boolean;
  note?: string;
  durationMinutes?: number;
  /** Actual completion time when a late report corrects the default now timestamp. */
  completedAt?: string;
  /**
   * Final QA round v2: corrects WHO actually walked the dog, distinct from
   * `responsibleUserId` (the rotation-assigned person) — already a
   * separate field on Walk, already legitimately different from
   * responsibleUserId ("whoever actually walked the dog isn't always who
   * was scheduled" — see markWalkDone below). Deliberately NOT
   * `responsibleUserId`: reassigning a SCHEDULED walk's responsible member
   * is, and remains, request-only (swap flow) — even for an already-
   * resolved walk — per the existing, repeatedly-reinforced DB rule (see
   * migrations 0005/0012). completedByUserId correction does not touch
   * that rule at all; the server (0012's existing, unchanged trigger)
   * already permits updating completed_by_user_id on your own resolved
   * walk to any active family member.
   */
  completedByUserId?: string;
}

/**
 * Marks a walk as done. Idempotent-safe against a race between two family
 * members tapping "done" at once: if the walk is already done, we don't
 * overwrite who/when — we surface that it was already handled instead of
 * silently double-recording it. This is the "two people mark it done at the
 * same time" edge case; the data layer additionally enforces this atomically
 * (see data/repository.ts) using an optimistic status check.
 *
 * `completedByUserId` may differ from `walk.responsibleUserId` — whoever
 * actually walked the dog isn't always who was scheduled.
 */
export function markWalkDone(
  walk: Walk,
  completedByUserId: string,
  details: WalkCompletionDetails = {},
  now: Date = new Date()
): Walk {
  if (walk.status === 'done') {
    throw new WalkActionError('הטיול כבר סומן כבוצע');
  }
  return {
    ...walk,
    status: 'done',
    completedAt: details.completedAt ?? now.toISOString(),
    completedByUserId,
    hadPee: details.hadPee,
    hadPoop: details.hadPoop,
    note: details.note,
    durationMinutes: details.durationMinutes,
    updatedAt: now.toISOString(),
  };
}

/**
 * Edits the pee/poop/note/duration/completedByUserId details of a walk
 * that has already been resolved.
 *
 * BUG FIX (final QA round v2): this used to reject any walk whose status
 * wasn't exactly 'done', throwing for a 'skipped' walk. Home's "✏️ עריכה"
 * link (added last pass) is available for a resolved last walk regardless
 * of done/skipped, so a skipped walk's note genuinely needs to be
 * editable too — the DB trigger (migration 0012) already permits this
 * (its non-status-change branch only checks
 * `old.responsible_user_id = actor`, never `old.status`), so this was a
 * client-only over-restriction, not a real server-enforced rule.
 */
export function editWalkDetails(walk: Walk, details: WalkCompletionDetails, now: Date = new Date()): Walk {
  if (walk.status !== 'done' && walk.status !== 'skipped') {
    throw new WalkActionError('אפשר לערוך פרטים רק לטיול שהסתיים');
  }
  return { ...walk, ...details, updatedAt: now.toISOString() };
}

/**
 * Final QA round v2 (item D completion): whether `actorUserId` may delete
 * a SCHEDULED (non-unplanned) walk OCCURRENCE — mirrors migration 0015's
 * server-side rule exactly (admin OR the walk's own responsible member,
 * and only once resolved). Deliberately excludes an unplanned walk — that
 * has its own, already-existing, separately-gated deleteUnplannedWalk
 * path (migration 0011) with its own eligibility rule
 * (responsibleUserId OR completedByUserId = actor, no status restriction).
 * A still-pending scheduled walk is never eligible here — deleting a walk
 * that hasn't happened yet is a scheduling change (cancel/reassign), not a
 * correction of a mis-recorded occurrence, and stays out of this rule.
 */
export function canDeleteScheduledWalk(walk: Walk, actorUserId: string | null | undefined, isAdmin: boolean): boolean {
  if (walk.isUnplanned) return false;
  if (isAdmin) return true;
  if (!actorUserId) return false;
  return (walk.status === 'done' || walk.status === 'skipped') && walk.responsibleUserId === actorUserId;
}

export function markWalkSkipped(walk: Walk, now: Date = new Date()): Walk {
  if (walk.status !== 'pending') {
    throw new WalkActionError('אפשר לדלג רק על טיול שממתין');
  }
  return { ...walk, status: 'skipped', updatedAt: now.toISOString() };
}

export function undoMarkDone(walk: Walk, now: Date = new Date()): Walk {
  if (walk.status !== 'done') {
    throw new WalkActionError('הטיול אינו מסומן כבוצע');
  }
  return {
    ...walk,
    status: 'pending',
    completedAt: undefined,
    completedByUserId: undefined,
    updatedAt: now.toISOString(),
  };
}

/**
 * Swaps responsibility for a pending walk to another family member,
 * preserving the audit trail of who was originally responsible.
 */
export function swapWalk(
  walk: Walk,
  newUserId: string,
  swappedByUserId: string,
  now: Date = new Date()
): Walk {
  if (walk.status !== 'pending') {
    throw new WalkActionError('אפשר להחליף רק תור שממתין');
  }
  if (walk.responsibleUserId === newUserId) {
    throw new WalkActionError('בחר בן משפחה אחר להחלפה');
  }
  return {
    ...walk,
    responsibleUserId: newUserId,
    swap: {
      originalUserId: walk.swap?.originalUserId ?? walk.responsibleUserId,
      newUserId,
      swappedAt: now.toISOString(),
      swappedByUserId,
    },
    updatedAt: now.toISOString(),
  };
}

/**
 * Full two-way exchange: A takes B's walk and B takes A's, in one action —
 * "עידן מעביר טיול לעומר" implemented as a real swap when both sides are
 * given a walk (as opposed to `swapWalk`, which just hands one walk to
 * someone without expecting anything back).
 */
export function swapWalksMutual(
  walkA: Walk,
  walkB: Walk,
  swappedByUserId: string,
  now: Date = new Date()
): [Walk, Walk] {
  if (walkA.status !== 'pending' || walkB.status !== 'pending') {
    throw new WalkActionError('אפשר להחליף רק תורות שממתינים');
  }
  if (walkA.id === walkB.id) {
    throw new WalkActionError('בחר שני טיולים שונים להחלפה');
  }
  const userA = walkA.responsibleUserId;
  const userB = walkB.responsibleUserId;
  return [
    {
      ...walkA,
      responsibleUserId: userB,
      swap: { originalUserId: walkA.swap?.originalUserId ?? userA, newUserId: userB, swappedAt: now.toISOString(), swappedByUserId },
      updatedAt: now.toISOString(),
    },
    {
      ...walkB,
      responsibleUserId: userA,
      swap: { originalUserId: walkB.swap?.originalUserId ?? userB, newUserId: userA, swappedAt: now.toISOString(), swappedByUserId },
      updatedAt: now.toISOString(),
    },
  ];
}

/**
 * Whether a walk's CURRENT assignment differs from its ORIGINAL expected
 * assignment — i.e. whether "הוחלף" should still show. `walk.swap` records
 * the very first original responsible user across any number of swaps (see
 * swapWalk/swapWalksMutual: `originalUserId: walk.swap?.originalUserId ??
 * ...`, which preserves it rather than overwriting on a later swap), so a
 * walk swapped back to its original assignee (A -> B -> A) must stop
 * showing "הוחלף" — merely having a `swap` record is not enough to decide
 * that; only a MISMATCH between the recorded original and the current
 * responsible user means it's still swapped relative to where it started.
 */
export function isCurrentlySwapped(walk: Walk): boolean {
  return Boolean(walk.swap) && walk.swap!.originalUserId !== walk.responsibleUserId;
}

/**
 * QA/UX round, Part B/I: WalkRow's one-line metadata text
 * ("טיול ספונטני" / "הוחלף" / both) extracted as pure logic so it's
 * testable independent of rendering. Returns null when there's nothing to
 * show (WalkRow renders nothing for that case, rather than an empty line).
 */
export function walkMetadataLine(walk: Walk): string | null {
  const parts: string[] = [];
  if (walk.isUnplanned) parts.push('טיול ספונטני');
  if (isCurrentlySwapped(walk)) parts.push('הוחלף');
  return parts.length > 0 ? parts.join(' · ') : null;
}

/**
 * QA/UX round, Part B/I: WalkRow's compact completion line ("בוצע ע״י X ·
 * HH:MM · 💧💩"), extracted as pure logic. Only meaningful for a `done`
 * walk with a known `completedBy`; `hasToggles` mirrors WalkRow's own rule
 * that this line is suppressed when the caller instead renders the
 * interactive pee/poop toggle buttons (so the same information isn't shown
 * twice, once as text and once as controls).
 */
export function walkCompletionLine(
  walk: Walk,
  completedBy: { name: string; removedAt?: string } | undefined,
  hasToggles: boolean
): string | null {
  if (walk.status !== 'done' || !completedBy || hasToggles) return null;
  return [
    // BATCH 4 (item F — completedAt UX): leading "✓" per the Master
    // Specification's exact display example ("✓ בוצע · 07:18") — the rest
    // of this line (who + pee/poop emoji) is existing, already-correct
    // richer detail this app already shows and the spec doesn't ask to
    // remove, so it's kept rather than replaced.
    `✓ בוצע ע״י ${completedBy.name}${completedBy.removedAt ? ' (הוסר)' : ''}`,
    walk.completedAt
      ? new Date(walk.completedAt).toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' })
      : null,
    walk.hadPee ? '💧' : null,
    walk.hadPoop ? '💩' : null,
  ]
    .filter(Boolean)
    .join(' · ');
}

/**
 * BATCH 4 (item F): "✓ בוצע · HH:MM" — the simple completedAt badge used
 * where there's room for only a short status label (HomeScreen's "last
 * walk" card), separately from the richer walkCompletionLine above.
 * `completedAt` is the actual click-time of the completion action (see
 * scheduleStore.markDone), never the scheduled time — this function does
 * not fall back to `scheduledTime` when completedAt is missing (legacy/
 * skipped data): it simply omits the time rather than showing the wrong
 * timestamp under a "✓ בוצע" label.
 */
export function formatCompletedAtBadge(walk: Walk): string {
  if (walk.status !== 'done') return '';
  if (!walk.completedAt) return '✓ בוצע';
  const time = new Date(walk.completedAt).toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' });
  return `✓ בוצע · ${time}`;
}

/**
 * BATCH 4 (item F): History's planned-vs-actual line — "תוכנן HH:MM · בוצע
 * HH:MM", exactly the Master Specification's example. Only meaningful for a
 * resolved (`done`) walk with a known completedAt; returns null otherwise
 * (a pending/skipped walk, or a done walk with no completedAt on record —
 * legacy data — falls back to WalkRow's ordinary scheduled-time headline
 * with nothing extra, rather than showing a broken/partial line).
 */
export function walkHistoryTimingLine(walk: Walk): string | null {
  if (walk.status !== 'done' || !walk.completedAt) return null;
  const actual = new Date(walk.completedAt).toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' });
  return `תוכנן ${walk.scheduledTime} · בוצע ${actual}`;
}

/** Weekly per-user completed-walk counts for the History summary. */
export function summarizeWalksByUser(
  walks: Walk[]
): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const w of walks) {
    if (w.status !== 'done' || !w.completedByUserId) continue;
    counts[w.completedByUserId] = (counts[w.completedByUserId] ?? 0) + 1;
  }
  return counts;
}
