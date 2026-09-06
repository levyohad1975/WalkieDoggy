import type { Walk } from '../types';
import { toDateOnly } from './rotation';

export type StatsPeriod = '7d' | '30d' | 'all';

/** Filters walks to a period, counting back from `now` (inclusive of today). Pure — Section 13 requires deriving from live store data, so this always takes `walks` fresh rather than caching anything. */
export function filterWalksByPeriod(walks: Walk[], period: StatsPeriod, now: Date = new Date()): Walk[] {
  if (period === 'all') return walks;
  const days = period === '7d' ? 6 : 29;
  const start = toDateOnly(new Date(now.getTime() - days * 86400000));
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
