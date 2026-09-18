import type { ScheduleEntry, ScheduleRule } from '../types';

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
  /** Future entries that still match; time/responsibleUserId recomputed against the updated rule. */
  toUpdate: ScheduleEntry[];
  /** New entries for days that just became active (in the new daysOfWeek but not the old one) and have no entry yet. */
  toAdd: ScheduleEntry[];
}

/**
 * Plans how to reconcile a rule's future (`>= today`) entries when its
 * daysOfWeek is edited. Pure — no I/O — so updateRule() in scheduleStore.ts
 * can layer persistence around it and this reconciliation is directly
 * unit-testable.
 *
 * `toAdd` is deliberately scoped to days newly added compared to
 * `previousRule.daysOfWeek`, not every day matching the new pattern: a day
 * that was already active both before and after must NOT resurrect an
 * entry the admin explicitly deleted for that one occurrence (see
 * scheduleStore.ts's `deleteEntry`) — mirrors `ruleNeedsEntryBackfill`'s own
 * entry-existence-only philosophy, just scoped to the one rule edit that
 * changed which days are active.
 */
export function planRuleDaysReconciliation(
  previousRule: Pick<ScheduleRule, 'daysOfWeek'>,
  updatedRule: ScheduleRule,
  currentEntries: ScheduleEntry[],
  today: string,
  endDate: string,
  idFactory: () => string = () => `${updatedRule.id}-${Math.random().toString(36).slice(2, 10)}`
): RuleDaysReconciliationPlan {
  const oldDays = previousRule.daysOfWeek.length > 0 ? previousRule.daysOfWeek : [0, 1, 2, 3, 4, 5, 6];
  const newDays = updatedRule.daysOfWeek.length > 0 ? updatedRule.daysOfWeek : [0, 1, 2, 3, 4, 5, 6];
  const newlyActiveDays = newDays.filter((d) => !oldDays.includes(d));

  const futureEntries = currentEntries.filter((e) => e.ruleId === updatedRule.id && e.date >= today);
  const toRemove: ScheduleEntry[] = [];
  const toUpdate: ScheduleEntry[] = [];
  for (const entry of futureEntries) {
    if (!newDays.includes(dayOfWeekUTC(entry.date))) {
      toRemove.push(entry);
      continue;
    }
    toUpdate.push({ ...entry, time: updatedRule.time, responsibleUserId: resolveResponsibleForDate(updatedRule, entry.date) });
  }

  const existingDatesForRule = new Set(futureEntries.map((e) => e.date));
  const toAdd =
    newlyActiveDays.length > 0
      ? generateRotationSchedule(updatedRule, today, endDate, idFactory).filter(
          (e) => newlyActiveDays.includes(dayOfWeekUTC(e.date)) && !existingDatesForRule.has(e.date)
        )
      : [];

  return { toRemove, toUpdate, toAdd };
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
