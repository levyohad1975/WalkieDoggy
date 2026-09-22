import type { Walk, WalkGpsSession, WalkStatus } from '../types';
import { localDateOnly } from './dateFormat';
import { walkDateTime } from './nextWalk';
import { formatDistanceMeters } from './gpsDistance';

export type StatsPeriod = '7d' | '30d' | 'all';

/** Filters walks to a period, counting back from `now` (inclusive of today). Pure — Section 13 requires deriving from live store data, so this always takes `walks` fresh rather than caching anything. */
export function filterWalksByPeriod(walks: Walk[], period: StatsPeriod, now: Date = new Date()): Walk[] {
  if (period === 'all') return walks;
  const days = period === '7d' ? 6 : 29;
  // `w.date` is the walk's local calendar date (see dateFormat.ts's own
  // doc comment) — the cutoff must be computed the same way, or a UTC-
  // anchored `toDateOnly` would shift this boundary by a day for anyone
  // in a timezone ahead of UTC (e.g. Israel) for a few hours after
  // local midnight.
  const start = localDateOnly(new Date(now.getTime() - days * 86400000));
  return walks.filter((w) => w.date >= start);
}

export interface CompletionStats {
  done: number;
  notDone: number;
  pending: number;
  total: number;
  /** 0-100, rounded; 0 when there's nothing resolved yet (avoids NaN/div-by-zero). */
  donePercentOfResolved: number;
}

export function computeCompletionStats(walks: Walk[]): CompletionStats {
  const done = walks.filter((w) => w.status === 'done').length;
  const notDone = walks.filter((w) => w.status === 'skipped').length;
  const pending = walks.filter((w) => w.status === 'pending').length;
  const resolved = done + notDone;
  return {
    done,
    notDone,
    pending,
    total: walks.length,
    donePercentOfResolved: resolved === 0 ? 0 : Math.round((done / resolved) * 100),
  };
}

export interface MemberStat {
  userId: string;
  count: number;
}

/** Distribution of DONE walks by who actually walked the dog (completedByUserId, falling back to responsibleUserId for older/edge-case rows), sorted descending. */
export function computeMemberDistribution(walks: Walk[]): MemberStat[] {
  const counts = new Map<string, number>();
  for (const w of walks) {
    if (w.status !== 'done') continue;
    const userId = w.completedByUserId ?? w.responsibleUserId;
    counts.set(userId, (counts.get(userId) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([userId, count]) => ({ userId, count }))
    .sort((a, b) => b.count - a.count);
}

export interface PlannedVsSpontaneousStats {
  planned: number;
  spontaneous: number;
}

export function computePlannedVsSpontaneous(walks: Walk[]): PlannedVsSpontaneousStats {
  const spontaneous = walks.filter((w) => w.isUnplanned).length;
  return { planned: walks.length - spontaneous, spontaneous };
}

export interface PeePoopStats {
  peeCount: number;
  poopCount: number;
  /** Out of DONE walks only — pee/poop is only ever recorded for a completed walk. */
  doneCount: number;
  peePercent: number;
  poopPercent: number;
}

export function computePeePoopStats(walks: Walk[]): PeePoopStats {
  const doneWalks = walks.filter((w) => w.status === 'done');
  const peeCount = doneWalks.filter((w) => w.hadPee).length;
  const poopCount = doneWalks.filter((w) => w.hadPoop).length;
  const doneCount = doneWalks.length;
  return {
    peeCount,
    poopCount,
    doneCount,
    peePercent: doneCount === 0 ? 0 : Math.round((peeCount / doneCount) * 100),
    poopPercent: doneCount === 0 ? 0 : Math.round((poopCount / doneCount) * 100),
  };
}

/**
 * Reports & Insights redesign — a real filter set (date range/dog/member/
 * status/planned-vs-ad-hoc), replacing the old period-chip-only screen.
 * `dateRange` is inclusive "YYYY-MM-DD" bounds; null means unbounded (the
 * old 'all' period). `memberId` matches EITHER responsibleUserId or
 * completedByUserId — "walks involving this person", not just ones they
 * completed, so filtering to a member still shows a walk they were
 * scheduled for but someone else ended up completing.
 */
export interface StatisticsFilters {
  dateRange: { start: string; end: string } | null;
  dogId: string | null;
  memberId: string | null;
  status: WalkStatus | 'all';
  planned: 'all' | 'planned' | 'adhoc';
}

export const DEFAULT_STATISTICS_FILTERS: StatisticsFilters = {
  dateRange: null,
  dogId: null,
  memberId: null,
  status: 'all',
  planned: 'all',
};

/** Converts the quick period chips (7d/30d/all) into a dateRange bound — kept separate from StatisticsFilters itself so a custom date range and the quick chips share one underlying filter shape rather than being two parallel code paths. */
export function periodToDateRange(period: StatsPeriod, now: Date = new Date()): { start: string; end: string } | null {
  if (period === 'all') return null;
  const days = period === '7d' ? 6 : 29;
  const start = localDateOnly(new Date(now.getTime() - days * 86400000));
  return { start, end: localDateOnly(now) };
}

export function applyStatisticsFilters(walks: Walk[], filters: StatisticsFilters): Walk[] {
  return walks.filter((w) => {
    if (filters.dateRange && (w.date < filters.dateRange.start || w.date > filters.dateRange.end)) return false;
    if (filters.dogId && w.dogId !== filters.dogId) return false;
    if (filters.memberId && w.responsibleUserId !== filters.memberId && w.completedByUserId !== filters.memberId) return false;
    if (filters.status !== 'all' && w.status !== filters.status) return false;
    if (filters.planned === 'planned' && w.isUnplanned) return false;
    if (filters.planned === 'adhoc' && !w.isUnplanned) return false;
    return true;
  });
}

/** Grace period before a completed walk counts as "late" — matches the walk-reminder system's own DEFAULT_OVERDUE_MINUTES_AFTER (logic/reminders.ts), so "on time" here means the same threshold the reminder that would have fired already uses, not a second, differently-tuned notion of lateness. */
export const ON_TIME_GRACE_MINUTES = 10;

/**
 * null = not applicable — an unplanned/ad-hoc walk has no real "scheduled
 * time" to be on-time against (its date/scheduledTime record when it
 * actually happened, not a commitment), and a walk that isn't done yet
 * hasn't been completed at all. Both are excluded from on-time/late
 * entirely rather than silently counted as one or the other.
 */
export function wasCompletedOnTime(walk: Pick<Walk, 'status' | 'completedAt' | 'date' | 'scheduledTime' | 'isUnplanned'>, graceMinutes: number = ON_TIME_GRACE_MINUTES): boolean | null {
  if (walk.status !== 'done' || !walk.completedAt || walk.isUnplanned) return null;
  const scheduled = walkDateTime(walk).getTime();
  const completed = new Date(walk.completedAt).getTime();
  return completed <= scheduled + graceMinutes * 60000;
}

export interface OnTimeStats {
  onTime: number;
  late: number;
  /** Pending walks and every ad-hoc walk — see wasCompletedOnTime's own doc comment for why these are excluded rather than guessed at. */
  notApplicable: number;
  /** Of resolved (onTime + late) only — 0 when nothing is resolved yet, avoiding NaN/div-by-zero, same convention as CompletionStats.donePercentOfResolved. */
  onTimePercent: number;
}

export function computeOnTimeStats(walks: Walk[]): OnTimeStats {
  let onTime = 0;
  let late = 0;
  let notApplicable = 0;
  for (const w of walks) {
    const result = wasCompletedOnTime(w);
    if (result === null) notApplicable++;
    else if (result) onTime++;
    else late++;
  }
  const resolved = onTime + late;
  return { onTime, late, notApplicable, onTimePercent: resolved === 0 ? 0 : Math.round((onTime / resolved) * 100) };
}

export interface DurationStats {
  totalMinutes: number;
  /** null when no completed walk in range has a recorded duration at all (never 0 — that would misleadingly read as "walks take no time"). */
  averageMinutes: number | null;
  /** How many of the completed walks actually contributed a duration — shown alongside the average so a tiny sample isn't presented with false confidence. */
  countWithDuration: number;
}

export function computeDurationStats(walks: Walk[]): DurationStats {
  const withDuration = walks.filter((w) => w.status === 'done' && typeof w.durationMinutes === 'number');
  const totalMinutes = withDuration.reduce((sum, w) => sum + (w.durationMinutes ?? 0), 0);
  return {
    totalMinutes,
    averageMinutes: withDuration.length === 0 ? null : Math.round(totalMinutes / withDuration.length),
    countWithDuration: withDuration.length,
  };
}

export interface DogStat {
  dogId: string;
  count: number;
}

/** Distribution of DONE walks by dog, sorted descending — the per-dog counterpart to computeMemberDistribution, filling the PRD's "חלוקה לפי כלבים" gap. */
export function computeDogDistribution(walks: Walk[]): DogStat[] {
  const counts = new Map<string, number>();
  for (const w of walks) {
    if (w.status !== 'done') continue;
    counts.set(w.dogId, (counts.get(w.dogId) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([dogId, count]) => ({ dogId, count }))
    .sort((a, b) => b.count - a.count);
}

export interface TrendPoint {
  date: string; // "YYYY-MM-DD"
  count: number;
}

/** Completed-walks-per-day within whatever range is already filtered — the screen's trend chart. Ascending by date (chart-ready left-to-right); the screen itself handles RTL presentation. */
export function computeDailyTrend(walks: Walk[]): TrendPoint[] {
  const counts = new Map<string, number>();
  for (const w of walks) {
    if (w.status !== 'done') continue;
    counts.set(w.date, (counts.get(w.date) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([date, count]) => ({ date, count }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

export interface DistanceStats {
  totalMeters: number;
  averageMeters: number | null;
  /** How many of the in-range walks actually have a GPS session — the screen only shows this KPI at all when this is > 0 (PRD gap analysis: distance is an optional field that appears once GPS data exists, never a blocking/empty-by-default tile). Uses correctedDistanceMeters over distanceMeters when a family member has confirmed/corrected it — see WalkGpsSession's own doc comment for why the correction, once set, is authoritative. */
  sessionCount: number;
}

export function computeDistanceStats(sessions: WalkGpsSession[]): DistanceStats {
  const distances = sessions
    .map((s) => s.correctedDistanceMeters ?? s.distanceMeters)
    .filter((d): d is number => typeof d === 'number');
  const totalMeters = distances.reduce((sum, d) => sum + d, 0);
  return {
    totalMeters,
    averageMeters: distances.length === 0 ? null : Math.round(totalMeters / distances.length),
    sessionCount: distances.length,
  };
}

/**
 * PRD §5's "תובנות קצרות" (short insights) — plain-Hebrew-sentence
 * generation belongs in logic (testable, same convention as
 * reminderMessages.ts), not scattered JSX string interpolation. Pee/poop
 * appears here, tucked into one supplementary sentence, deliberately never
 * as its own KPI tile — see this module's own callers for that boundary.
 * Returns [] (never a placeholder string) when there's nothing meaningful
 * to say yet, e.g. an empty filtered range.
 */
export function computeInsights(
  walks: Walk[],
  usersById: Record<string, { name: string } | undefined>,
  dogsById: Record<string, { name: string } | undefined>
): string[] {
  const insights: string[] = [];
  if (walks.length === 0) return insights;

  const memberDist = computeMemberDistribution(walks);
  if (memberDist.length > 0) {
    const top = memberDist[0];
    const name = usersById[top.userId]?.name ?? 'מישהו/י מהמשפחה';
    insights.push(`${name} הכי פעיל/ה — ${top.count} טיולים הושלמו.`);
  }

  const dogDist = computeDogDistribution(walks);
  if (dogDist.length > 1) {
    const top = dogDist[0];
    const name = dogsById[top.dogId]?.name ?? 'הכלב/ה';
    insights.push(`${name} עם הכי הרבה טיולים בטווח הזה — ${top.count}.`);
  }

  const onTime = computeOnTimeStats(walks);
  if (onTime.onTime + onTime.late >= 3) {
    insights.push(`${onTime.onTimePercent}% מהטיולים המתוכננים בוצעו בזמן.`);
  }

  const peePoop = computePeePoopStats(walks);
  if (peePoop.doneCount >= 3) {
    insights.push(`פיפי נרשם ב-${peePoop.peePercent}% מהטיולים, קקי ב-${peePoop.poopPercent}%.`);
  }

  return insights;
}

/** Re-exported for screens that only need the formatting rule and don't otherwise touch logic/gpsDistance.ts directly — keeps a single import source for "statistics-adjacent" formatting. */
export { formatDistanceMeters };
