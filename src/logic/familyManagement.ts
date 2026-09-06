import type { ScheduleEntry, ScheduleRule, UserDeletionImpact, Walk } from '../types';

/**
 * Pure logic for the "delete a family member without breaking the rotation
 * or existing walks" requirement. No I/O — the caller (familyStore) reads
 * current rules/entries/walks, calls these, then persists the results.
 */

/**
 * Round 7, Part 3 (bug A/B fix): decides whether FamilyScreen should reload
 * the Admin-only `admin_list_family_activity()` list after a role change,
 * given the CURRENT VIEWER's own familyRole as freshly re-read from
 * authStore AFTER awaiting refreshOwnRoleAfterChange(changedUserId) (see
 * FamilyScreen.tsx's handleRoleChanged and authStore.ts's
 * refreshOwnRoleAfterChange doc comments).
 *
 * Deliberately a single, unified rule for both "changed my own role" and
 * "changed someone else's role" call sites: refreshOwnRoleAfterChange() is
 * already a no-op (never touches familyRole) unless the changed user IS this
 * device's own real currentUserId, so for an OTHER member's role change the
 * value passed in here is simply the viewer's pre-existing, unaffected
 * familyRole — which was already 'admin' in every reachable case (role
 * management is only ever shown to a real admin in the first place, see
 * isRealFamilyAdmin()) — so this correctly returns true and the activity
 * list is refreshed exactly as before.
 *
 * For a SELF role change: 'admin' means either a self-promotion or a
 * refresh that (for whatever reason) still resolved admin — reload is safe
 * and desired, since admin_list_family_activity() will succeed. 'member' or
 * null (self-demotion succeeded, OR the post-success refresh itself failed
 * closed per refreshOwnRoleAfterChange's roleRefreshNotice fallback) means
 * the caller is no longer known to be an admin — reloading would just be
 * calling an RPC that either gets correctly rejected server-side, or worse,
 * is not deterministic under whatever timing the request happens to land
 * with — so this returns false and the caller must clear its cached
 * activity directly instead.
 */
export function shouldReloadActivityAfterRoleChange(refreshedFamilyRole: 'admin' | 'member' | null): boolean {
  return refreshedFamilyRole === 'admin';
}

/**
 * Round 8, Fix 1: minimal shape this needs from
 * admin_list_family_activity() rows (see lib/requests.ts's FamilyActivityRow
 * — not imported directly to keep this logic layer decoupled from the data
 * layer, matching this file's existing style).
 */
export interface AdminActivityRoleRow {
  user_id: string;
  role: 'admin' | 'member';
  removed_at: string | null;
}

/**
 * True when `userId` is currently the family's one and only active admin,
 * per the same admin-count-from-activity-data rule FamilyScreen.tsx already
 * used inline to disable demotion in MemberDetailsModal (isLastAdmin prop).
 * Extracted here (round 8, Fix 1) so FamilyScreen's delete-icon gating can
 * reuse the EXACT same decision rather than reimplementing it a second time.
 *
 * Pure UX guard only — never the security boundary. The server's
 * admin_delete_family_member() (migrations/0007_multi_admin_roles.sql)
 * remains the authoritative last-admin check regardless of what this
 * returns; this only prevents the client from walking the user into a
 * delete/reassignment flow that would end in a doomed server rejection.
 * `activity` empty or missing the row (e.g. the admin-only activity fetch
 * hasn't loaded/failed) deliberately fails OPEN — returns false, i.e. does
 * NOT block — leaving the existing server-side rejection as the backstop,
 * exactly as before this round's UX fix existed.
 */
export function isLastActiveAdminMember(userId: string, activity: AdminActivityRoleRow[]): boolean {
  const row = activity.find((r) => r.user_id === userId);
  if (!row || row.role !== 'admin' || row.removed_at) return false;
  const activeAdminCount = activity.filter((r) => r.role === 'admin' && !r.removed_at).length;
  return activeAdminCount <= 1;
}

/**
 * Round 8, Fix 1: the extracted, directly-testable decision behind the
 * Family screen's delete-icon `onPress`. Purely "should this tap be a
 * no-op" — `isLastAdmin` is computed exactly as before, by
 * isLastActiveAdminMember(); this wrapper just makes the "do nothing at
 * all when true" behaviour independently unit-testable without touching
 * React Native's touch/responder system, which is not something this
 * repo's test infrastructure can exercise (see final report / this file's
 * own test file for the "tested vs. verified by reading" boundary).
 *
 * The actual real-device bug this round (a disabled inner Pressable
 * nested in an outer row Pressable still letting the tap reach the row's
 * own onPress and open MemberDetailsModal) was a touch-responder/propagation
 * issue, not a decision-logic issue — isLastActiveAdminMember already
 * returned the right boolean before this fix too. The propagation fix
 * itself (FamilyScreen.tsx: no longer using Pressable's `disabled` prop for
 * the delete icon) is verified by code reading, not by this function.
 */
export function handleLastAdminGuardedPress(isLastAdmin: boolean, action: () => void): void {
  if (isLastAdmin) return;
  action();
}

export class FamilyManagementError extends Error {}

/** What would break if `userId` were deleted right now. */
export function computeUserDeletionImpact(
  userId: string,
  rules: ScheduleRule[],
  entries: ScheduleEntry[],
  today: string
): UserDeletionImpact {
  return {
    futureScheduleEntryCount: entries.filter((e) => e.responsibleUserId === userId && e.date >= today).length,
    // Matches planUserRemoval below, which processes every rule containing this
    // user regardless of `active` — keep both in sync if `active` toggling is ever added.
    rulesAffected: rules.filter((r) => r.rotationUserIds.includes(userId)).map((r) => r.id),
  };
}

/**
 * Builds the updated rules/entries/walks needed to remove `userId` safely,
 * either by handing their spot to `replacementUserId` or — if none is given
 * — by dropping them from each rotation (only allowed when at least one
 * other person remains in it).
 */
export function planUserRemoval(
  userId: string,
  replacementUserId: string | null,
  rules: ScheduleRule[],
  entries: ScheduleEntry[],
  walks: Walk[],
  today: string,
  resolveResponsibleForDate: (
    rule: Pick<ScheduleRule, 'rotationUserIds' | 'rotationAnchorDate' | 'daysOfWeek'>,
    targetDate: string
  ) => string
): { updatedRules: ScheduleRule[]; updatedEntries: ScheduleEntry[]; updatedWalks: Walk[] } {
  const updatedRules: ScheduleRule[] = [];
  const rulesById = new Map<string, ScheduleRule>();

  for (const rule of rules) {
    if (!rule.rotationUserIds.includes(userId)) continue;
    const rotationUserIds = replacementUserId
      ? rule.rotationUserIds.map((id) => (id === userId ? replacementUserId : id))
      : rule.rotationUserIds.filter((id) => id !== userId);

    if (rotationUserIds.length === 0) {
      throw new FamilyManagementError('אי אפשר למחוק — זה בן המשפחה היחיד בסבב הזה. בחר מי יחליף אותו.');
    }
    const updated: ScheduleRule = { ...rule, rotationUserIds };
    updatedRules.push(updated);
    rulesById.set(rule.id, updated);
  }

  const updatedEntries: ScheduleEntry[] = [];
  for (const entry of entries) {
    if (entry.responsibleUserId !== userId || entry.date < today) continue;
    const newResponsible = replacementUserId
      ? replacementUserId
      : entry.ruleId && rulesById.has(entry.ruleId)
        ? resolveResponsibleForDate(rulesById.get(entry.ruleId)!, entry.date)
        : null;
    if (!newResponsible) continue; // no rule to fall back on — leave as-is, caller already blocked this case above
    updatedEntries.push({ ...entry, responsibleUserId: newResponsible });
  }

  const updatedWalks: Walk[] = [];
  for (const walk of walks) {
    if (walk.responsibleUserId !== userId || walk.status !== 'pending' || walk.date < today) continue;
    const linkedEntry = walk.scheduleEntryId ? updatedEntries.find((e) => e.id === walk.scheduleEntryId) : undefined;
    const newResponsible = linkedEntry?.responsibleUserId ?? replacementUserId;
    if (!newResponsible) continue;
    updatedWalks.push({ ...walk, responsibleUserId: newResponsible, updatedAt: new Date().toISOString() });
  }

  return { updatedRules, updatedEntries, updatedWalks };
}
