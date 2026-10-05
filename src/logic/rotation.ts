import type { ScheduleEntry, ScheduleRule, Walk } from '../types';

/**
 * Pure scheduling logic — no I/O, no framework deps. Fully unit-testable.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

export function toDateOnly(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function parseDateOnly(dateStr: string): Date {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

export function dayOfWeekUTC(dateStr: string): number {
  return parseDateOnly(dateStr).getUTCDay();
}

/**
 * Given a rotation list and an anchor date, figures out whose turn it is on
 * `targetDate`, counting only days that match the rule's daysOfWeek.
 *
 * Example: rotation [danny, yael, noam], daysOfWeek = every day (0-6),
 * anchor = 2026-08-26 (danny's turn) -> 2026-08-27 is yael, 2026-08-28 noam,
 * 2026-08-29 danny again.
 */
export function resolveResponsibleForDate(
  rule: Pick<ScheduleRule, 'rotationUserIds' | 'rotationAnchorDate' | 'daysOfWeek'>,
  targetDate: string
): string {
  if (rule.rotationUserIds.length === 0) {
    throw new Error('Rotation must include at least one user');
  }
  if (rule.rotationUserIds.length === 1) {
    return rule.rotationUserIds[0];
  }

  const anchor = parseDateOnly(rule.rotationAnchorDate);
  const target = parseDateOnly(targetDate);
  if (target < anchor) {
    throw new Error('targetDate must be on or after rotationAnchorDate');
  }

  // Count how many *active* days (matching daysOfWeek) occur between anchor and target, inclusive of anchor, exclusive of target.
  let activeDaysBetween = 0;
  const days = rule.daysOfWeek.length > 0 ? rule.daysOfWeek : [0, 1, 2, 3, 4, 5, 6];
  for (let t = anchor.getTime(); t < target.getTime(); t += DAY_MS) {
    const dow = new Date(t).getUTCDay();
    if (days.includes(dow)) activeDaysBetween++;
  }

  const index = activeDaysBetween % rule.rotationUserIds.length;
  return rule.rotationUserIds[index];
}

/**
 * Generates schedule entries for a rule between startDate and endDate (inclusive),
 * skipping days that don't match daysOfWeek.
 */
export function generateRotationSchedule(
  rule: ScheduleRule,
  startDate: string,
  endDate: string,
  idFactory: () => string = () => `${rule.id}-${Math.random().toString(36).slice(2, 10)}`
): ScheduleEntry[] {
  const start = parseDateOnly(startDate);
  const end = parseDateOnly(endDate);
  if (end < start) return [];

  const days = rule.daysOfWeek.length > 0 ? rule.daysOfWeek : [0, 1, 2, 3, 4, 5, 6];
  const entries: ScheduleEntry[] = [];

  for (let t = start.getTime(); t <= end.getTime(); t += DAY_MS) {
    const dateStr = toDateOnly(new Date(t));
    const dow = dayOfWeekUTC(dateStr);
    if (!days.includes(dow)) continue;

    const responsibleUserId = resolveResponsibleForDate(rule, dateStr);
    entries.push({
      id: idFactory(),
      familyId: rule.familyId,
      dogId: rule.dogId,
      ruleId: rule.id,
      date: dateStr,
      time: rule.time,
      responsibleUserId,
      createdAt: new Date().toISOString(),
    });
  }

  return entries;
}

/**
 * Whether a rule's schedule entries need backfilling before `today` — i.e.
 * generation never ran, was interrupted, or entries were wiped some other
 * way. Extracted out of scheduleStore.ts's load() (final QA round v2) so
 * this specific condition — the ONLY thing that ever triggers regenerating
 * a walk from a rule — is directly unit-testable as plain TypeScript.
 *
 * DELIBERATELY entry-existence-only, never walk-existence: this is exactly
 * why deleting a resolved SCHEDULED walk's row (while leaving its
 * schedule_entry row untouched) is safe from silent regeneration — this
 * predicate has no way to observe that a walk was deleted, only whether
 * the RULE has at least one entry dated `>= today`. See
 * scheduleStore.ts's `deleteScheduledWalkOccurrence` doc comment for the
 * full audit trail this was extracted to prove.
 */
export function ruleNeedsEntryBackfill(
  rule: Pick<ScheduleRule, 'id' | 'active'>,
  entries: Pick<ScheduleEntry, 'ruleId' | 'date'>[],
  today: string
): boolean {
  return rule.active && !entries.some((e) => e.ruleId === rule.id && e.date >= today);
}

export interface RuleDaysReconciliationPlan {
  /** Future entries for this rule whose date no longer matches the rule's (possibly patched) daysOfWeek. */
  toRemove: ScheduleEntry[];
  /** Future entries that still match AND are still freely mutable (no walk, or a 'pending' one); time/responsibleUserId recomputed against the updated rule. */
  toUpdate: ScheduleEntry[];
  /** New entries for days that just became active (in the new daysOfWeek but not the old one) and have no entry yet. */
  toAdd: ScheduleEntry[];
  /**
   * P0 real-device fix — a fresh entry (new id) for a date that ALREADY has
   * an entry for this rule, because every existing entry for that date has
   * a walk that is no longer 'pending' (done/in_progress/skipped — i.e.
   * historical fact or an active session). That existing entry+walk are
   * left completely out of `toUpdate`/untouched by design: mutating a
   * resolved occurrence's scheduled time would rewrite history (a walk
   * marked done at 09:00 must always show as done at 09:00, even after the
   * rule's time later changes to 14:00). This is the new, separate,
   * actionable occurrence for that date under the rule's current time —
   * same shape as `toAdd`, just reached for a different reason (a locked
   * existing entry, not a newly-active day).
   */
  toRegenerate: ScheduleEntry[];
}

/**
 * Plans how to reconcile a rule's future (`>= today`) entries when it is
 * edited — originally just daysOfWeek, now also a time change whose
 * target entry's walk has already been resolved. Pure — no I/O — so
 * updateRule() in scheduleStore.ts can layer persistence around it and
 * this reconciliation is directly unit-testable.
 *
 * `toAdd` is deliberately scoped to days newly added compared to
 * `previousRule.daysOfWeek`, not every day matching the new pattern: a day
 * that was already active both before and after must NOT resurrect an
 * entry the admin explicitly deleted for that one occurrence (see
 * scheduleStore.ts's `deleteEntry`) — mirrors `ruleNeedsEntryBackfill`'s own
 * entry-existence-only philosophy, just scoped to the one rule edit that
 * changed which days are active.
 *
 * P0 real-device fix — real-iPhone QA: editing a rule's time (e.g.
 * 09:00 -> 14:00) after today's occurrence under the OLD time had already
 * been completed left TODAY's (and every future day's) entry silently
 * un-reconciled — diagnosed as two independent bugs. This function fixes
 * the second one: even once entries actually persist (see
 * OfflineFirstRepository.updateScheduleEntry's own fix), blindly mutating
 * `{ ...entry, time: updatedRule.time }` for EVERY future entry — the
 * original behavior — would silently rewrite an already-'done' walk's
 * historical scheduled time, and since that walk is not 'pending' the
 * caller's own walk-side update is (correctly) skipped, leaving the entry
 * and its walk disagreeing on time with no new actionable occurrence ever
 * created. `currentWalks` (optional — every existing caller that omits it
 * keeps today's exact prior behavior, since nothing can ever look
 * "locked" with no walks to check) lets this function tell a freely
 * mutable entry (no walk yet, or a 'pending' one) apart from a locked one,
 * per calendar date: if ANY entry for a given date is still mutable, that
 * one is updated in place as before; only when EVERY entry for a date is
 * locked does this reach for `toRegenerate` instead — so re-editing the
 * rule again after a regenerated entry exists updates that new pending
 * entry in place rather than regenerating a second one.
 */
export function planRuleDaysReconciliation(
  previousRule: Pick<ScheduleRule, 'daysOfWeek'>,
  updatedRule: ScheduleRule,
  currentEntries: ScheduleEntry[],
  today: string,
  endDate: string,
  idFactory: () => string = () => `${updatedRule.id}-${Math.random().toString(36).slice(2, 10)}`,
  currentWalks: Pick<Walk, 'scheduleEntryId' | 'status'>[] = []
): RuleDaysReconciliationPlan {
  const oldDays = previousRule.daysOfWeek.length > 0 ? previousRule.daysOfWeek : [0, 1, 2, 3, 4, 5, 6];
  const newDays = updatedRule.daysOfWeek.length > 0 ? updatedRule.daysOfWeek : [0, 1, 2, 3, 4, 5, 6];
  const newlyActiveDays = newDays.filter((d) => !oldDays.includes(d));

  const futureEntries = currentEntries.filter((e) => e.ruleId === updatedRule.id && e.date >= today);
  const toRemove: ScheduleEntry[] = [];
  const byDate = new Map<string, ScheduleEntry[]>();
  for (const entry of futureEntries) {
    if (!newDays.includes(dayOfWeekUTC(entry.date))) {
      toRemove.push(entry);
      continue;
    }
    const forDate = byDate.get(entry.date) ?? [];
    forDate.push(entry);
    byDate.set(entry.date, forDate);
  }

  const isLocked = (entry: ScheduleEntry): boolean => {
    const status = currentWalks.find((w) => w.scheduleEntryId === entry.id)?.status;
    return Boolean(status) && status !== 'pending';
  };

  const toUpdate: ScheduleEntry[] = [];
  const toRegenerate: ScheduleEntry[] = [];
  for (const [date, entriesForDate] of byDate) {
    const mutable = entriesForDate.find((e) => !isLocked(e));
    if (mutable) {
      toUpdate.push({ ...mutable, time: updatedRule.time, responsibleUserId: resolveResponsibleForDate(updatedRule, date) });
      continue;
    }
    toRegenerate.push({
      id: idFactory(),
      familyId: updatedRule.familyId,
      dogId: updatedRule.dogId,
      ruleId: updatedRule.id,
      date,
      time: updatedRule.time,
      responsibleUserId: resolveResponsibleForDate(updatedRule, date),
      createdAt: new Date().toISOString(),
    });
  }

  const existingDatesForRule = new Set(futureEntries.map((e) => e.date));
  const toAdd =
    newlyActiveDays.length > 0
      ? generateRotationSchedule(updatedRule, today, endDate, idFactory).filter(
          (e) => newlyActiveDays.includes(dayOfWeekUTC(e.date)) && !existingDatesForRule.has(e.date)
        )
      : [];

  return { toRemove, toUpdate, toAdd, toRegenerate };
}

export interface StaleRuleEntryReconciliationPlan {
  /** A stale entry (time !== its rule's current time) whose walk is still mutable — updated in place to the rule's current time. */
  toUpdate: ScheduleEntry[];
  /** A fresh entry (new id) for a (rule, date) where every existing entry is both stale AND locked, and the rule's time for that date has not yet passed — the active rule still needs a representation for it. */
  toRegenerate: ScheduleEntry[];
}

/**
 * P0 real-device fix, self-heal round — 807e4db's planRuleDaysReconciliation
 * only prevents a FUTURE rule-time edit from corrupting its own entries; it
 * does nothing for entries that were ALREADY left stale by edits made
 * before that fix shipped (or by any other path that changed
 * schedule_rules.time without reconciling schedule_entries — the fire-
 * and-forget updateScheduleEntry bug this same round also fixed). This is
 * the general self-heal: run on every schedule load so existing stale data
 * converges to the correct state on its own, no new rule edit required.
 *
 * For every schedule_entry whose ruleId names a CURRENTLY ACTIVE rule and
 * whose date falls in `[today, endDate]`, grouped by (ruleId, date):
 *   - If any entry for that (rule, date) ALREADY has `time === rule.time`,
 *     that date is correctly represented — nothing to do, regardless of
 *     what other stale entries/history also exist for it.
 *   - Otherwise every entry for that (rule, date) is stale. If any of them
 *     is still mutable (a 'pending' walk, or no walk at all), that one is
 *     corrected in place (`toUpdate`) — exactly as an ordinary rule-time
 *     edit already does, whether or not the new time has already passed
 *     today: this is fixing an already-OPEN item's displayed time, not
 *     creating anything new.
 *   - If every entry for that (rule, date) is LOCKED (done/in_progress/
 *     skipped — already resolved, preserved as history, never rewritten),
 *     a new occurrence is needed only when the rule's time for that date
 *     has not yet passed: a future date's time obviously hasn't, so this
 *     always regenerates for `date > today`; for `date === today`
 *     specifically, only if `rule.time` is still later than `now`. A
 *     rule's occurrence for TODAY that both resolved under a stale time
 *     AND whose current time has already gone by gets no new occurrence —
 *     "do not create an artificial walk for a time slot that's already
 *     gone by." This is what makes an active rule later today (e.g. 21:00
 *     at 14:17, already resolved this morning under a stale time) still
 *     get a fresh actionable occurrence, while one earlier today (e.g.
 *     14:00 at 14:17) does not.
 *
 * Idempotent: once a (rule, date) has an entry whose time matches the
 * rule, every later call is a no-op for it — re-running this on every
 * load converges and then stays converged, never spawning a second
 * regenerated entry for the same (rule, date).
 */
export function planStaleRuleEntryReconciliation(
  activeRules: ScheduleRule[],
  currentEntries: ScheduleEntry[],
  currentWalks: Pick<Walk, 'scheduleEntryId' | 'status'>[],
  today: string,
  endDate: string,
  now: Date,
  idFactory: () => string = () => `stale-reconcile-${Math.random().toString(36).slice(2, 10)}`
): StaleRuleEntryReconciliationPlan {
  const toUpdate: ScheduleEntry[] = [];
  const toRegenerate: ScheduleEntry[] = [];
  const rulesById = new Map(activeRules.map((r) => [r.id, r]));

  const byRuleDate = new Map<string, ScheduleEntry[]>();
  for (const entry of currentEntries) {
    if (!entry.ruleId || entry.date < today || entry.date > endDate) continue;
    if (!rulesById.has(entry.ruleId)) continue;
    const key = `${entry.ruleId}|${entry.date}`;
    const list = byRuleDate.get(key) ?? [];
    list.push(entry);
    byRuleDate.set(key, list);
  }

  const isLocked = (entry: ScheduleEntry): boolean => {
    const status = currentWalks.find((w) => w.scheduleEntryId === entry.id)?.status;
    return Boolean(status) && status !== 'pending';
  };

  const ruleTimeAlreadyPassedToday = (rule: ScheduleRule): boolean => {
    const [h, m] = rule.time.split(':').map(Number);
    const [y, mo, d] = today.split('-').map(Number);
    return new Date(y, mo - 1, d, h, m, 0, 0).getTime() < now.getTime();
  };

  for (const [key, entriesForRuleDate] of byRuleDate) {
    const [ruleId, date] = key.split('|');
    const rule = rulesById.get(ruleId)!;
    if (entriesForRuleDate.some((e) => e.time === rule.time)) continue; // already correctly represented

    const mutable = entriesForRuleDate.find((e) => !isLocked(e));
    if (mutable) {
      toUpdate.push({ ...mutable, time: rule.time, responsibleUserId: resolveResponsibleForDate(rule, date) });
      continue;
    }

    if (date === today && ruleTimeAlreadyPassedToday(rule)) continue;

    toRegenerate.push({
      id: idFactory(),
      familyId: rule.familyId,
      dogId: rule.dogId,
      ruleId: rule.id,
      date,
      time: rule.time,
      responsibleUserId: resolveResponsibleForDate(rule, date),
      createdAt: new Date().toISOString(),
    });
  }

  return { toUpdate, toRegenerate };
}

/** Builds a preview string like "דני → יעל → נועם → דני" for a given number of upcoming turns. */
export function previewRotation(rotationUserNames: string[], turns: number): string {
  if (rotationUserNames.length === 0) return '';
  const out: string[] = [];
  for (let i = 0; i < turns; i++) {
    out.push(rotationUserNames[i % rotationUserNames.length]);
  }
  return out.join(' → ');
}
