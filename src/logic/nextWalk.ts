import type { Walk } from '../types';

/**
 * Combines a walk's date + "HH:mm" scheduled time into a Date object (local time).
 */
export function walkDateTime(walk: Pick<Walk, 'date' | 'scheduledTime'>): Date {
  const [h, m] = walk.scheduledTime.split(':').map(Number);
  const [y, mo, d] = walk.date.split('-').map(Number);
  return new Date(y, mo - 1, d, h, m, 0, 0);
}

/**
 * Finds the "next walk" to surface on the Home screen:
 * the earliest pending walk whose time is in the future, or — if none is
 * strictly in the future — the earliest still-pending walk overall (i.e. an
 * overdue walk that hasn't been marked done/skipped yet), so nothing pending
 * silently disappears from the home screen.
 */
export const NEXT_WALK_GRACE_MINUTES = 30;

export function computeNextWalk(walks: Walk[], now: Date = new Date()): Walk | undefined {
  const graceStartTime = now.getTime() - NEXT_WALK_GRACE_MINUTES * 60 * 1000;

  const eligiblePending = walks.filter(
    (w) =>
      w.status === 'pending' &&
      walkDateTime(w).getTime() >= graceStartTime
  );

  if (eligiblePending.length === 0) return undefined;

  return [...eligiblePending].sort(
    (a, b) => walkDateTime(a).getTime() - walkDateTime(b).getTime()
  )[0];
}

/** Finds the most recently completed (or skipped) walk, for the "last walk" home card. */
export function computeLastWalk(walks: Walk[], now: Date = new Date()): Walk | undefined {
  const finishedTime = (walk: Walk): number => {
    if (walk.status === 'done' && walk.completedAt) {
      return new Date(walk.completedAt).getTime();
    }

    return walkDateTime(walk).getTime();
  };

  const finished = walks.filter(
    (w) =>
      w.status !== 'pending' &&
      finishedTime(w) <= now.getTime()
  );

  if (finished.length === 0) return undefined;

  return [...finished].sort(
    (a, b) => finishedTime(b) - finishedTime(a)
  )[0];
}

export function isOverdue(walk: Walk, now: Date = new Date()): boolean {
  return walk.status === 'pending' && walkDateTime(walk).getTime() < now.getTime();
}

export function minutesUntil(walk: Pick<Walk, 'date' | 'scheduledTime'>, now: Date = new Date()): number {
  return Math.round((walkDateTime(walk).getTime() - now.getTime()) / 60000);
}

function pluralHours(hours: number): string {
  return hours === 1 ? 'שעה' : `${hours} שעות`;
}

function pluralMinutes(minutes: number): string {
  return minutes === 1 ? 'דקה' : `${minutes} דקות`;
}

/**
 * "2 שעות ו-51 דקות" / "שעה ו-15 דקות" / "5 דקות" for a duration given in
 * whole minutes. Never floors away the minutes remainder — that was the bug
 * (a walk 2h51m away showing "עוד 2 שעות", which reads as "in ~2 hours" but
 * was actually almost 3). `totalMinutes` must be >= 0; sign/zero handling
 * ("עכשיו") is relativeTimeLabel's job, not this helper's.
 */
export function formatDuration(totalMinutes: number): string {
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours === 0) return pluralMinutes(minutes);
  if (minutes === 0) return pluralHours(hours);
  return `${pluralHours(hours)} ו-${pluralMinutes(minutes)}`;
}

/**
 * Human-friendly "עוד 2 שעות ו-51 דקות" / "לפני 10 דקות" style label, precise
 * to the minute (never a floored/misleading hour count). "עכשיו" exactly at
 * the scheduled time. For an overdue-but-still-pending walk this still
 * returns a "לפני ..." (time-ago) label rather than a raw negative number —
 * the visual "overdue" treatment itself (color, badge) is applied by the
 * caller via isOverdue(), not by this label.
 */
export function relativeTimeLabel(walk: Walk, now: Date = new Date()): string {
  const diff = minutesUntil(walk, now);
  if (diff > 0) return `עוד ${formatDuration(diff)}`;
  if (diff < 0) return `לפני ${formatDuration(Math.abs(diff))}`;
  return 'עכשיו';
}

export function upcomingWalks(walks: Walk[], now: Date = new Date(), limit = 10): Walk[] {
  return walks
    .filter(
      (w) =>
        w.status === 'pending' &&
        walkDateTime(w).getTime() >= now.getTime()
    )
    .sort((a, b) => walkDateTime(a).getTime() - walkDateTime(b).getTime())
    .slice(0, limit);
}

