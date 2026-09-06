import type { Walk } from '../types';
import { toDateOnly } from './rotation';
import { walkDateTime } from './nextWalk';

/**
 * History contains only resolved occurrences whose calendar day has arrived.
 * A future occurrence can transiently carry `skipped`/`done` after schedule
 * edits or request resolution; it must never be presented as a past
 * "לא בוצע" item before that day.
 */
export function isWalkEligibleForHistory(walk: Walk, now: Date = new Date()): boolean {
  return walk.status === 'pending'
    ? walkDateTime(walk).getTime() <= now.getTime()
    : walk.date <= toDateOnly(now);
}
