import type { Walk } from '../types';

/** Counts are authoritative only when persisted. Legacy walks stored flags. */
export interface WalkEventCounts { pee: number; poop: number }

export function validWalkEventCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

/** Never infer multiple events from a legacy boolean or device-only counter. */
export function getWalkEventCounts(walk: Pick<Walk, 'hadPee' | 'hadPoop' | 'peeCount' | 'poopCount'>): WalkEventCounts {
  return {
    pee: validWalkEventCount(walk.peeCount) ? walk.peeCount : (walk.hadPee ? 1 : 0),
    poop: validWalkEventCount(walk.poopCount) ? walk.poopCount : (walk.hadPoop ? 1 : 0),
  };
}

export function summarizeWalkEvents(walks: ReadonlyArray<Pick<Walk, 'hadPee' | 'hadPoop' | 'peeCount' | 'poopCount'>>): WalkEventCounts {
  return walks.reduce<WalkEventCounts>((total, walk) => {
    const current = getWalkEventCounts(walk);
    return { pee: total.pee + current.pee, poop: total.poop + current.poop };
  }, { pee: 0, poop: 0 });
}
