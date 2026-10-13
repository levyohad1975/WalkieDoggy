import type { Walk } from '../types';
import { walkDateTime } from './nextWalk';

export const DEFAULT_SPONTANEOUS_ASSOCIATION_WINDOW_MINUTES = 30;

/**
 * Returns nearby pending scheduled occurrences as choices, never as an
 * automatic association. `now` and occurrence instants are both resolved in
 * the family's IANA timezone so midnight/DST behavior is family-local.
 */
export function findSpontaneousAssociationCandidates(
  walks: Walk[],
  dogId: string,
  now: Date,
  familyTimezone?: string,
  windowMinutes = DEFAULT_SPONTANEOUS_ASSOCIATION_WINDOW_MINUTES,
): Walk[] {
  if (!Number.isFinite(windowMinutes) || windowMinutes < 1) return [];
  return walks
    .filter((walk) => walk.dogId === dogId && walk.status === 'pending' && !walk.isUnplanned && Boolean(walk.scheduleEntryId))
    .map((walk) => ({ walk, delta: Math.abs(walkDateTime(walk, familyTimezone).getTime() - now.getTime()) }))
    .filter(({ delta }) => delta <= windowMinutes * 60_000)
    .sort((a, b) => a.delta - b.delta || walkDateTime(a.walk, familyTimezone).getTime() - walkDateTime(b.walk, familyTimezone).getTime() || a.walk.id.localeCompare(b.walk.id))
    .map(({ walk }) => walk);
}
