import type { Walk } from '../types';
import { localDateOnly } from './dateFormat';
import { isActiveWalk } from './walkLifecycle';

type FamilyClock = { date: string; time: string };

function clockParts(date: Date, timeZone?: string): FamilyClock {
  if (timeZone) {
    try {
      const parts = new Intl.DateTimeFormat('en-GB', {
        timeZone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hourCycle: 'h23',
      }).formatToParts(date);
      const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
      return {
        date: `${values.year}-${values.month}-${values.day}`,
        time: `${values.hour}:${values.minute}`,
      };
    } catch {
      // Older local/demo family records may not have a valid IANA timezone.
      // Their fallback is the device's local calendar, matching legacy behavior.
    }
  }
  return {
    date: localDateOnly(date),
    time: `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`,
  };
}

/** Calendar date in the family's timezone; safe across midnight and DST. */
export function familyDateOnly(now: Date = new Date(), timeZone?: string): string {
  return clockParts(now, timeZone).date;
}

function wallClockDate(date: string, time: string, timeZone?: string): Date {
  const [year, month, day] = date.split('-').map(Number);
  const [hour, minute] = time.split(':').map(Number);
  if (![year, month, day, hour, minute].every(Number.isFinite)) return new Date(Number.NaN);
  if (!timeZone) return new Date(year, month - 1, day, hour, minute, 0, 0);

  const targetAsUtc = Date.UTC(year, month - 1, day, hour, minute);
  let candidate = targetAsUtc;
  try {
    const formatter = new Intl.DateTimeFormat('en-GB', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    });
    const seen = new Set<number>();
    let closestAfter: { timestamp: number; difference: number } | undefined;
    for (let attempt = 0; attempt < 6 && !seen.has(candidate); attempt += 1) {
      seen.add(candidate);
      const values = Object.fromEntries(formatter.formatToParts(new Date(candidate)).map((part) => [part.type, part.value]));
      const representedAsUtc = Date.UTC(
        Number(values.year), Number(values.month) - 1, Number(values.day),
        Number(values.hour), Number(values.minute)
      );
      const adjustment = targetAsUtc - representedAsUtc;
      if (adjustment === 0) return new Date(candidate);
      // If the requested wall time falls inside a spring-forward gap, choose
      // the first valid local minute after it instead of oscillating across
      // the gap or producing a time before the requested schedule.
      if (representedAsUtc > targetAsUtc) {
        const difference = representedAsUtc - targetAsUtc;
        if (!closestAfter || difference < closestAfter.difference) closestAfter = { timestamp: candidate, difference };
      }
      candidate += adjustment;
    }
    return new Date(closestAfter?.timestamp ?? candidate);
  } catch {
    // Invalid/legacy timezone falls back to the device-local wall clock.
    return new Date(year, month - 1, day, hour, minute, 0, 0);
  }
}

function compareScheduledWalks(a: Walk, b: Walk): number {
  return a.date.localeCompare(b.date)
    || a.scheduledTime.localeCompare(b.scheduledTime)
    || (a.scheduleEntryId ?? '').localeCompare(b.scheduleEntryId ?? '')
    || a.id.localeCompare(b.id);
}

function hasValidScheduleTime(walk: Walk): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(walk.date)
    && /^\d{2}:\d{2}$/.test(walk.scheduledTime)
    && !walk.isUnplanned;
}

/**
 * Combines a walk's family-local date and HH:mm schedule time into an instant.
 * If no family timezone is available, the device's local timezone is used.
 */
export function walkDateTime(walk: Pick<Walk, 'date' | 'scheduledTime'>, timeZone?: string): Date {
  return wallClockDate(walk.date, walk.scheduledTime, timeZone);
}

/**
 * Selects today's current scheduled slot, then the next unresolved future
 * slot. A due slot remains the primary card only until a later scheduled
 * time arrives. Resolved and older pending walks remain persisted and are
 * never silently changed by selection.
 */
export function computeNextWalk(walks: Walk[], now: Date = new Date(), timeZone?: string): Walk | undefined {
  const today = clockParts(now, timeZone);
  const unresolved = walks.filter(
    (walk) => hasValidScheduleTime(walk) && (walk.status === 'pending' || isActiveWalk(walk))
  );
  const todayWalks = unresolved.filter((walk) => walk.date === today.date);

  const dueTimes = walks
    .filter((walk) => hasValidScheduleTime(walk) && walk.date === today.date && walk.scheduledTime <= today.time)
    .map((walk) => walk.scheduledTime)
    .sort();
  const latestDueTime = dueTimes[dueTimes.length - 1];

  if (latestDueTime) {
    const currentSlot = todayWalks
      .filter((walk) => walk.scheduledTime === latestDueTime)
      .sort(compareScheduledWalks);
    if (currentSlot.length > 0) return currentSlot[0];
  }

  const future = unresolved
    .filter((walk) => walk.date > today.date || (walk.date === today.date && walk.scheduledTime > today.time))
    .sort(compareScheduledWalks);
  return future[0];
}

/**
 * Returns how long Home can wait before its next time-based selection update.
 * Includes each scheduled slot, the next family-local midnight, and a minute
 * boundary for live countdown copy. The caller recalculates on schedule or
 * family changes and when the app returns to the foreground.
 */
export function nextWalkSelectionRefreshDelayMs(
  walks: Walk[],
  now: Date = new Date(),
  timeZone?: string
): number {
  const today = clockParts(now, timeZone).date;
  const [year, month, day] = today.split('-').map(Number);
  const nextDay = new Date(Date.UTC(year, month - 1, day + 1));
  const nextDate = `${nextDay.getUTCFullYear()}-${String(nextDay.getUTCMonth() + 1).padStart(2, '0')}-${String(nextDay.getUTCDate()).padStart(2, '0')}`;
  const boundaries = [
    now.getTime() + (60_000 - (now.getTime() % 60_000)),
    wallClockDate(nextDate, '00:00', timeZone).getTime(),
    ...walks
      .filter(hasValidScheduleTime)
      .map((walk) => walkDateTime(walk, timeZone).getTime())
      .filter((timestamp) => timestamp > now.getTime()),
  ].filter((timestamp) => Number.isFinite(timestamp) && timestamp > now.getTime());

  const nextBoundary = Math.min(...boundaries);
  return Math.max(1, Math.ceil(nextBoundary - now.getTime()));
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
 * exactly one. Walks with no `scheduleEntryId` (unplanned/spontaneous) are
 * never deduplicated against each other — each is independently real, and
 * this bug class cannot apply to them (no shared unique constraint). Pure
 * and order-preserving otherwise, so it is safe to call on every schedule
 * load, not just when a duplicate is suspected.
 *
 * ROUND 4 FIX — real-device QA: a valid, still-FUTURE 14:00 occurrence
 * today vanished from Home entirely (it fell through to tomorrow's
 * occurrence instead), even though an earlier walk the same day was
 * correctly 'done'. Root-caused to this function's own status-rank
 * ordering: the exact duplicate-local-id race described above can leave
 * ONE copy of an occurrence genuinely 'pending' (still actionable, not yet
 * due) and the OTHER stuck as 'skipped' — e.g. a stale copy that was
 * generated, then superseded by a LATER walk for the same dog becoming due
 * (finalizeSupersededPendingWalks) on some earlier pass, while the real,
 * still-relevant copy remained 'pending'. The original rank table put
 * `skipped` ABOVE `pending`, so dedup picked the stale, dead-end `skipped`
 * copy as canonical and discarded the genuinely actionable `pending` one —
 * silently removing a valid future occurrence from Home exactly as
 * described above. `pending` now outranks `skipped`: an occurrence that is
 * still genuinely actionable must never lose to a duplicate that gave up
 * on it. This cannot regress the "stays done" guarantee above — `done`
 * and genuine `in_progress` still outrank everything. An audited duplicate
 * start ranks below pending so it cannot hide the actionable occurrence.
 */
export function dedupeCanonicalWalks(walks: Walk[]): Walk[] {
  const statusRank = (walk: Walk): number => {
    if (walk.status === 'in_progress' && walk.duplicateResolutionGroupId) return -1;
    return { skipped: 0, pending: 1, in_progress: 2, done: 3 }[walk.status];
  };
  const canonicalByEntry = new Map<string, Walk>();
  for (const walk of walks) {
    if (!walk.scheduleEntryId) continue;
    const current = canonicalByEntry.get(walk.scheduleEntryId);
    if (!current || statusRank(walk) > statusRank(current)) {
      canonicalByEntry.set(walk.scheduleEntryId, walk);
    }
  }
  const kept = new Set(canonicalByEntry.values());

  // Legacy scheduled walks can lose their schedule_entry_id after a schedule
  // reset. Two distinct pending rows created seconds apart for the exact same
  // slot are an offline replay artifact, not two independently planned slots.
  // Collapse only this narrow case for presentation; do not mutate either
  // persisted row, and never merge completed, active or spontaneous walks.
  const legacyPending = walks.filter((walk) =>
    !walk.scheduleEntryId && !walk.isUnplanned && walk.status === 'pending' &&
    Number.isFinite(Date.parse(walk.createdAt))
  );
  for (const walk of legacyPending) {
    const duplicate = legacyPending.find((other) =>
      other.id !== walk.id &&
      other.familyId === walk.familyId &&
      other.dogId === walk.dogId &&
      other.date === walk.date &&
      other.scheduledTime === walk.scheduledTime &&
      other.responsibleUserId === walk.responsibleUserId &&
      Math.abs(Date.parse(other.createdAt) - Date.parse(walk.createdAt)) <= 60_000 &&
      (Date.parse(other.createdAt) < Date.parse(walk.createdAt) ||
        (other.createdAt === walk.createdAt && other.id < walk.id))
    );
    if (duplicate) kept.delete(walk);
    else kept.add(walk);
  }
  return walks.filter((walk) => !walk.scheduleEntryId ? !legacyPending.includes(walk) || kept.has(walk) : kept.has(walk));
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

export function isOverdue(walk: Walk, now: Date = new Date(), timeZone?: string): boolean {
  return walk.status === 'pending' && walkDateTime(walk, timeZone).getTime() < now.getTime();
}

export function minutesUntil(walk: Pick<Walk, 'date' | 'scheduledTime'>, now: Date = new Date(), timeZone?: string): number {
  return Math.round((walkDateTime(walk, timeZone).getTime() - now.getTime()) / 60000);
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
export function relativeTimeLabel(walk: Walk, now: Date = new Date(), timeZone?: string): string {
  const diff = minutesUntil(walk, now, timeZone);
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
