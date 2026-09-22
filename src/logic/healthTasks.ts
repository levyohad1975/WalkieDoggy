import type { HealthTask, HealthTaskCategory } from '../types';
import { localDateOnly } from './dateFormat';

/** The PRD §10 core category list, in display order — single source of truth shared by the add/edit form (HealthGroomingModal) and reminder body text (healthReminderService), so the two can never drift apart. */
export const HEALTH_TASK_CATEGORIES: HealthTaskCategory[] = [
  'vaccination',
  'parasite_prevention',
  'medication',
  'vet_visit',
  'weight',
  'allergy',
  'food',
  'grooming',
  'bath',
  'nails',
  'teeth',
  'ears',
  'other',
];

export const HEALTH_TASK_CATEGORY_LABELS: Record<HealthTaskCategory, string> = {
  vaccination: 'חיסון',
  parasite_prevention: 'תילוע/פרעושים/קרציות',
  medication: 'תרופה',
  vet_visit: 'ביקור וטרינר',
  weight: 'משקל',
  allergy: 'אלרגיה/רגישות',
  food: 'מזון והנחיות',
  grooming: 'טיפוח/ספר',
  bath: 'מקלחת',
  nails: 'ציפורניים',
  teeth: 'שיניים',
  ears: 'אוזניים',
  other: 'אחר',
};

const DAY_MS = 24 * 60 * 60 * 1000;

function parseDateOnly(dateStr: string): Date {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

/** "YYYY-MM-DD" + N days -> "YYYY-MM-DD", UTC-anchored pure date arithmetic — same convention as logic/rotation.ts's toDateOnly/dayOfWeekUTC (this is calendar-date math, not a viewer-local "now" question). */
export function addDaysToDateOnly(dateStr: string, days: number): string {
  return new Date(parseDateOnly(dateStr).getTime() + days * DAY_MS).toISOString().slice(0, 10);
}

/**
 * The lifecycle requested for Health & Grooming: upcoming -> due -> overdue
 * -> completed. Deliberately a pure, derived function rather than a stored
 * status column — exactly the same pattern as isWalkRequiringAttention()
 * (logic/walkAttention.ts) and isOverdue() (logic/nextWalk.ts): the DB
 * already constrains a non-completed task to always have a dueDate (0049's
 * health_tasks_due_or_completed check), so this never needs a write path of
 * its own, and nothing here can silently "forget" to update a status when
 * the calendar day rolls over — it's recomputed at render time from
 * dueDate/completedAt + "now" every time.
 *
 * Device-local date, matching every other "is this due/overdue" computation
 * in this codebase's UI (localDateOnly) — not the family-timezone-aware
 * server calculation walks' scheduler (0025) uses for actually SENDING;
 * this is the client-side "what to show right now" read, same scope
 * distinction isWalkRequiringAttention's own doc comment draws.
 */
export type HealthTaskLifecycle = 'upcoming' | 'due' | 'overdue' | 'completed';

export function getHealthTaskLifecycle(
  task: Pick<HealthTask, 'dueDate' | 'completedAt'>,
  now: Date = new Date()
): HealthTaskLifecycle {
  if (task.completedAt) return 'completed';
  if (!task.dueDate) return 'upcoming'; // defensive: the DB constraint guarantees this never actually happens for a non-completed row
  const today = localDateOnly(now);
  if (task.dueDate > today) return 'upcoming';
  if (task.dueDate === today) return 'due';
  return 'overdue';
}

/** How many days ahead of today still counts as "due soon" for the Home summary badge below — independent of the 'due'/'overdue' lifecycle states themselves, which are exact-day. */
export const HEALTH_DUE_SOON_DAYS = 3;

/**
 * Counts for the Home-screen summary badge (never the full list — see
 * HealthGroomingModal for that). Only ever counts a DOG'S OWN tasks — the
 * caller is responsible for passing tasks already scoped to one dog (see
 * healthStore's per-dog `tasks` + `loadedDogId` guard), so switching the
 * active dog can never leak another dog's counts into this badge.
 */
export function summarizeHealthTasksForHome(
  tasks: HealthTask[],
  now: Date = new Date()
): { overdueCount: number; dueSoonCount: number } {
  const today = localDateOnly(now);
  const soonCutoff = addDaysToDateOnly(today, HEALTH_DUE_SOON_DAYS);
  let overdueCount = 0;
  let dueSoonCount = 0;
  for (const t of tasks) {
    if (t.completedAt || !t.dueDate) continue;
    if (t.dueDate < today) overdueCount++;
    else if (t.dueDate <= soonCutoff) dueSoonCount++;
  }
  return { overdueCount, dueSoonCount };
}

/**
 * Builds the NEXT occurrence for a recurring task once `sourceTask` has just
 * been completed — a fresh, independent row (own id), never a mutation of
 * the completed one, so the completed record's own history is preserved
 * exactly as-is. Returns null when the source task has no recurrence
 * interval set (the common, one-off case). `completedAt` is the ISO
 * timestamp the completion was recorded with (so the next due date is
 * anchored to the SAME moment the record shows as completed, not a
 * separately-read "now").
 */
export function buildNextRecurringTask(
  sourceTask: HealthTask,
  completedAt: string,
  newId: string
): HealthTask | null {
  if (!sourceTask.recurrenceIntervalDays || sourceTask.recurrenceIntervalDays <= 0) return null;
  return {
    id: newId,
    familyId: sourceTask.familyId,
    dogId: sourceTask.dogId,
    category: sourceTask.category,
    title: sourceTask.title,
    notes: sourceTask.notes,
    recurrenceIntervalDays: sourceTask.recurrenceIntervalDays,
    responsibleUserId: sourceTask.responsibleUserId,
    dueDate: addDaysToDateOnly(completedAt.slice(0, 10), sourceTask.recurrenceIntervalDays),
    createdByUserId: sourceTask.createdByUserId,
    createdAt: completedAt,
    updatedAt: completedAt,
    // Deliberately omitted: weightKg (a per-instance reading, not a
    // recurring value — see HealthTask.weightKg's own doc comment),
    // completedAt/completedByUserId (the whole point: this is the NEXT,
    // not-yet-done occurrence).
  };
}

/** One planned local reminder for a health task — see notifications/healthReminderService.ts. */
export interface HealthTaskNotificationPlanItem {
  kind: 'health_task_due' | 'health_task_overdue';
  fireAt: string; // ISO timestamp
}

/** How long after the due date, if still not completed, the single overdue nudge fires — one nudge, not a recurring daily one, matching this codebase's existing "no endless reminders" decision for walks (0025 Decision 5). */
export const HEALTH_OVERDUE_NUDGE_DAYS_AFTER = 1;

/** Local device hour the due-date reminder fires at — this is a date-only field (no time-of-day on health_tasks), so a fixed, reasonable hour is used rather than requiring one at entry time. */
const DUE_REMINDER_HOUR = 9;

/**
 * Computes which local reminders should exist for one task, mirroring
 * logic/reminders.ts's planWalkNotifications() shape/spirit: a pure
 * function of the task's own current data, so the notification service just
 * diffs this against what's already scheduled (deterministic per-kind
 * identifiers there make that diff/dedup exact-once by construction — see
 * that file). No plan at all for a completed task, or one with no dueDate
 * (defensive; the DB constraint guarantees a non-completed row always has
 * one).
 */
export function planHealthTaskNotifications(task: Pick<HealthTask, 'dueDate' | 'completedAt'>): HealthTaskNotificationPlanItem[] {
  if (task.completedAt || !task.dueDate) return [];
  const dueFireAt = new Date(`${task.dueDate}T${String(DUE_REMINDER_HOUR).padStart(2, '0')}:00:00`);
  const overdueFireAt = new Date(dueFireAt.getTime() + HEALTH_OVERDUE_NUDGE_DAYS_AFTER * DAY_MS);
  return [
    { kind: 'health_task_due', fireAt: dueFireAt.toISOString() },
    { kind: 'health_task_overdue', fireAt: overdueFireAt.toISOString() },
  ];
}
