import type { Walk } from '../types';

export interface RetrospectiveWalkInput {
  dogId: string;
  performedByUserId: string;
  date: string;
  time: string;
  durationMinutes?: number;
  excludeWalkId?: string;
}

/** Finds completed walks that overlap a retrospective entry for the same dog. */
export function findRetrospectiveWalkDuplicates(
  walks: Walk[],
  input: RetrospectiveWalkInput,
): Walk[] {
  const candidateStart = Date.parse(`${input.date}T${input.time}:00`);
  if (!Number.isFinite(candidateStart)) return [];
  const candidateEnd = candidateStart + Math.max(0, input.durationMinutes ?? 60) * 60_000;

  return walks.filter((walk) => {
    if (walk.id === input.excludeWalkId || walk.dogId !== input.dogId || walk.status !== 'done') return false;
    if ((walk.actualWalkerUserId ?? walk.responsibleUserId) !== input.performedByUserId || walk.date !== input.date) return false;
    const start = Date.parse(`${walk.date}T${walk.scheduledTime}:00`);
    if (!Number.isFinite(start)) return false;
    const end = start + Math.max(0, walk.durationMinutes ?? 60) * 60_000;
    return start <= candidateEnd && candidateStart <= end;
  });
}
