import type { Walk } from '../types';
import { isActiveWalk } from './walkLifecycle';

/**
 * Group key for active spontaneous walks whose dogId is missing or does not
 * belong to any dog the family currently has loaded. Such rows cannot be
 * attributed to a dog safely, so they are never merged into a real dog's
 * group, but they are still collected into ONE group so legacy rows cannot
 * fan out into a stack of separate Home cards.
 */
export const UNASSIGNED_DOG_GROUP_KEY = '__unassigned_dog__';

export interface ActiveSpontaneousWalkGroup {
  /** Stable React key / group identity: a known dogId or UNASSIGNED_DOG_GROUP_KEY. */
  key: string;
  /** The real dog id for this group, or null for the unassigned group. */
  dogId: string | null;
  /** Unique (by walk id) records, oldest start first, then by id. */
  walks: Walk[];
  /** More than one distinct active record for the same dog: needs Admin review. */
  duplicate: boolean;
}

export interface ActiveSpontaneousWalkGroupOptions {
  familyId?: string | null;
  /** Dog ids of the family currently loaded on this device. */
  knownDogIds: readonly string[];
  viewerUserId: string | null | undefined;
  viewerIsAdmin: boolean;
}

function startKey(walk: Walk): string {
  return walk.startedAt ?? walk.createdAt ?? '';
}

function canViewerSee(walk: Walk, options: ActiveSpontaneousWalkGroupOptions): boolean {
  if (options.viewerIsAdmin) return true;
  if (!options.viewerUserId) return false;
  if (walk.actualWalkerUserId) return walk.actualWalkerUserId === options.viewerUserId;
  return walk.responsibleUserId === options.viewerUserId;
}

export function activeSpontaneousGroupKey(walk: Pick<Walk, 'dogId'>, knownDogIds: readonly string[]): string {
  const dogId = typeof walk.dogId === 'string' ? walk.dogId.trim() : '';
  if (!dogId) return UNASSIGNED_DOG_GROUP_KEY;
  if (knownDogIds.length > 0 && !knownDogIds.includes(dogId)) return UNASSIGNED_DOG_GROUP_KEY;
  return dogId;
}

/**
 * Deterministic grouping of active spontaneous walks for Home.
 *
 * - The same record (same walk id) seen more than once (e.g. an optimistic
 *   local copy next to the server row) collapses to one entry, keeping the
 *   most recently updated copy. That never merges two distinct walks.
 * - Distinct records for the same dog stay distinct inside one group and are
 *   flagged `duplicate`, so Home renders one audit warning listing every
 *   exact walk id instead of one card per record.
 * - Different dogs always stay in different groups.
 *
 * Callers pass the FULL visible pool, including the walk shown in the main
 * next-walk card, so a duplicate of that walk is still detected.
 */
export function groupActiveSpontaneousWalks(
  walks: readonly Walk[],
  options: ActiveSpontaneousWalkGroupOptions,
): ActiveSpontaneousWalkGroup[] {
  const byId = new Map<string, Walk>();
  for (const walk of walks) {
    if (!walk.isUnplanned || !isActiveWalk(walk)) continue;
    if (options.familyId && walk.familyId !== options.familyId) continue;
    if (!canViewerSee(walk, options)) continue;
    const existing = byId.get(walk.id);
    if (!existing || (walk.updatedAt ?? '') > (existing.updatedAt ?? '')) byId.set(walk.id, walk);
  }

  const groups = new Map<string, Walk[]>();
  for (const walk of byId.values()) {
    const key = activeSpontaneousGroupKey(walk, options.knownDogIds);
    const group = groups.get(key) ?? [];
    group.push(walk);
    groups.set(key, group);
  }

  return [...groups.entries()]
    .map(([key, group]) => {
      const sorted = [...group].sort((a, b) => startKey(a).localeCompare(startKey(b)) || a.id.localeCompare(b.id));
      return {
        key,
        dogId: key === UNASSIGNED_DOG_GROUP_KEY ? null : key,
        walks: sorted,
        duplicate: sorted.length > 1,
      };
    })
    .sort((a, b) => {
      if (a.dogId === null && b.dogId !== null) return 1;
      if (b.dogId === null && a.dogId !== null) return -1;
      return startKey(a.walks[0]).localeCompare(startKey(b.walks[0])) || a.key.localeCompare(b.key);
    });
}

/**
 * What Home should render for each group. A single active walk that is
 * already the main next-walk card is not repeated; everything else gets
 * exactly one block per group.
 */
export function activeSpontaneousHomeBlocks(
  groups: readonly ActiveSpontaneousWalkGroup[],
  mainCardWalkId: string | null | undefined,
): ActiveSpontaneousWalkGroup[] {
  return groups.filter((group) => group.duplicate || group.walks[0].id !== mainCardWalkId);
}
