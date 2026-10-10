import type { Walk } from '../types';
import { localDateOnly } from './dateFormat';
import { walkDateTime } from './nextWalk';

/**
 * History contains only resolved occurrences whose calendar day has arrived.
 * A future occurrence can transiently carry `skipped`/`done` after schedule
 * edits or request resolution; it must never be presented as a past
 * "לא בוצע" item before that day.
 *
 * Local calendar day, not UTC — see dateFormat.ts's doc comment on why a
 * UTC-anchored "today" is wrong for a viewer-facing check like this one, for
 * anyone in a timezone ahead of UTC (e.g. Israel).
 */
export function isWalkEligibleForHistory(walk: Walk, now: Date = new Date()): boolean {
  return walk.status === 'pending'
    ? walkDateTime(walk).getTime() <= now.getTime()
    : walk.date <= localDateOnly(now);
}

/**
 * PRD §14: "History displays ... with filtering AND SEARCH." A walk's note
 * is the one free-text field History surfaces per item (see HistoryScreen's
 * "💬 {w.note}" line) — this is a case/whitespace-insensitive substring
 * match against it. An empty/whitespace-only query matches every walk, so a
 * cleared search box never hides the list.
 */
export function walkMatchesHistorySearch(walk: Walk, query: string): boolean {
  const trimmed = query.trim().toLowerCase();
  if (!trimmed) return true;
  return (walk.note ?? '').toLowerCase().includes(trimmed);
}
