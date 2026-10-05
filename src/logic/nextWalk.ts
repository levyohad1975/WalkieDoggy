import type { Walk } from '../types';
import { localDateOnly } from './dateFormat';

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
 * the most recently scheduled unresolved overdue walk first, otherwise the
 * earliest future pending walk. When several walks were missed, the latest
 * missed occurrence is the current actionable context; older missed walks
 * must not make the red card count lateness indefinitely.
 */
export function computeNextWalk(walks: Walk[], now: Date = new Date()): Walk | undefined {
  const active = walks.find((w) => w.status === 'in_progress');
  if (active) return active;

  const pending = walks.filter((w) => w.status === 'pending');
  const overdue = pending.filter((w) => walkDateTime(w).getTime() < now.getTime());
  const candidates = overdue.length ? overdue : pending.filter((w) => walkDateTime(w).getTime() >= now.getTime());
  if (candidates.length === 0) return undefined;
  return [...candidates].sort((a, b) => {
    const delta = walkDateTime(a).getTime() - walkDateTime(b).getTime();
    return overdue.length ? -delta : delta;
  })[0];
}

/**
 * Finalizes stale planned walks once a later planned occurrence for the same
 * dog has become due. The newest due occurrence stays actionable; any older
 * pending occurrence is no longer an open question and becomes "skipped".
 *
 * In-progress walks are never touched. Unplanned walks neither trigger nor
 * receive automatic skipping.
 */
export function finalizeSupersededPendingWalks(walks: Walk[], now: Date = new Date()): Walk[] {
  const latestDueByDog = new Map<string, number>();

  for (const walk of walks) {
    if (walk.isUnplanned) continue;
    const scheduledAt = walkDateTime(walk).getTime();
    if (scheduledAt > now.getTime()) continue;
    const latest = latestDueByDog.get(walk.dogId);
    if (latest == null || scheduledAt > latest) latestDueByDog.set(walk.dogId, scheduledAt);
  }

  let changed = false;
  const finalized = walks.map((walk) => {
    if (walk.isUnplanned || walk.status !== 'pending') return walk;
    const latestDue = latestDueByDog.get(walk.dogId);
    if (latestDue == null || walkDateTime(walk).getTime() >= latestDue) return walk;
    changed = true;
    return { ...walk, status: 'skipped' as const, updatedAt: now.toISOString() };
  });

  return changed ? finalized : walks;
}

/**
 * P0 real-device fix — after a scheduled occurrence's Walk was legitimately
 * finished (status 'done'), the SAME occurrence reappeared as a second,
 * separately startable pending Walk. Root cause: `walks.schedule_entry_id`
 * is UNIQUE server-side (supabase/schema.sql), so there can only ever be
 * ONE canonical server row per occurrence — but the OFFLINE-FIRST local
 * cache can still end up holding a stale PENDING duplicate for the same
 * schedule_entry_id left over from the exact local-id race
 * resolveCanonicalWalkId (offlineFirstRepository.ts) resolves for Start.
 * That duplicate is normally excluded once a remote row for the same
 * schedule_entry_id is known, but a reload that happens to read the raw
 * local cache (e.g. a transient `isOnline()` false right after
 * foregrounding, before connectivity is confirmed) returns it with no
 * such filtering at all, and nothing before this point otherwise prevents
 * more than one Walk per schedule_entry_id from ever reaching display.
 *
 * Collapses every group of walks that share a `scheduleEntryId` down to
 * exactly one: whichever is furthest along the pending -> in_progress ->
 * done/skipped lifecycle (a `pending` leftover can never outrank an
 * already-`done` or already-`in_progress` canonical row for the same
 * occurrence). Walks with no `scheduleEntryId` (unplanned/spontaneous)
 * are never deduplicated against each other — each is independently real,
 * and this bug class cannot apply to them (no shared unique constraint).
 * Pure and order-preserving otherwise, so it is safe to call on every
 * schedule load, not just when a duplicate is suspected.
 */
export function dedupeCanonicalWalks(walks: Walk[]): Walk[] {
  const statusRank: Record<Walk['status'], number> = { pending: 0, in_progress: 1, skipped: 2, done: 3 };
  const canonicalByEntry = new Map<string, Walk>();
  for (const walk of walks) {
    if (!walk.scheduleEntryId) continue;
    const current = canonicalByEntry.get(walk.scheduleEntryId);
    if (!current || statusRank[walk.status] > statusRank[current.status]) {
      canonicalByEntry.set(walk.scheduleEntryId, walk);
    }
  }
  const kept = new Set(canonicalByEntry.values());
  return walks.filter((walk) => !walk.scheduleEntryId || kept.has(walk));
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
      (w.status === 'done' || w.status === 'skipped') &&
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


/**
 * Returns every walk scheduled for the viewer's local calendar day in
 * chronological order. Unlike `upcomingWalks`, this deliberately retains
 * completed, skipped and in-progress walks so a Home dashboard can show the
 * day's actual timeline rather than only future pending work.
 */
export function dailyWalkTimeline(walks: Walk[], now: Date = new Date()): Walk[] {
  const today = localDateOnly(now);
  return walks
    .filter((walk) => walk.date === today)
    .sort((a, b) => a.scheduledTime.localeCompare(b.scheduledTime));
}
