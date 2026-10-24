import type { Walk } from '../types';

/** True only for an active lifecycle row not explicitly excluded by its audit marker. */
export function isActiveWalk(walk: Pick<Walk, 'status' | 'duplicateResolutionGroupId'>): boolean {
  return walk.status === 'in_progress' && !walk.duplicateResolutionGroupId;
}
