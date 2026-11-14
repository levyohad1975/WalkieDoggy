/**
 * Permanent routine change requests (owner request 2026-11-10; migration
 * 20261110090000_routine_change_requests). A family member asks to change
 * the weekly routine grid; the other member (for a swap/give/take) and then
 * the family admin approve. The admin's device applies the request as
 * ordinary cell assignments (planCellAssignment), one step at a time against
 * the latest rules, and only then marks the request approved, so a retry
 * after a partial failure simply finishes the job.
 */
import type { FamilyUser, ScheduleRule } from '../types';
import { buildRoutineRows, DAY_LONG_LABELS } from './routineGrid';

/**
 * 'take_once' (owner request 2026-11-12, migration 20261112110000): take ONE
 * pending walk of another member. Accepting it (the member, or the admin)
 * reassigns that walk on the server; the routine rules are not touched.
 */
export type RoutineRequestKind = 'swap' | 'give' | 'take' | 'change_time' | 'take_once';
export type RoutineRequestStatus = 'pending_target' | 'pending_admin' | 'approved' | 'rejected' | 'cancelled';

export interface RoutineChangeRequest {
  id: string;
  familyId: string;
  dogId: string;
  requesterUserId: string;
  targetUserId: string | null;
  kind: RoutineRequestKind;
  myDay: number | null;
  myTime: string | null;
  theirDay: number | null;
  theirTime: string | null;
  newTime: string | null;
  note: string | null;
  status: RoutineRequestStatus;
  createdAt: string;
  decidedAt: string | null;
  /** take_once only: the exact walk and its date (YYYY-MM-DD). */
  walkId?: string | null;
  walkDate?: string | null;
}

/** One cell assignment: who walks at `time` on `day` from now on. */
export interface RoutineRequestStep {
  time: string;
  day: number;
  userId: string | null;
}

export const isOpenRoutineRequest = (r: Pick<RoutineChangeRequest, 'status'>) =>
  r.status === 'pending_target' || r.status === 'pending_admin';

export function routineRequestSteps(r: RoutineChangeRequest): RoutineRequestStep[] {
  switch (r.kind) {
    case 'swap':
      return [
        { time: r.myTime!, day: r.myDay!, userId: r.targetUserId },
        { time: r.theirTime!, day: r.theirDay!, userId: r.requesterUserId },
      ];
    case 'give':
      return [{ time: r.myTime!, day: r.myDay!, userId: r.targetUserId }];
    case 'take':
      return [{ time: r.theirTime!, day: r.theirDay!, userId: r.requesterUserId }];
    case 'change_time':
      return [
        { time: r.myTime!, day: r.myDay!, userId: null },
        { time: r.newTime!, day: r.myDay!, userId: r.requesterUserId },
      ];
    case 'take_once':
      // One walk, reassigned by the server; nothing changes in the routine.
      return [];
  }
}

/** The single member who walks at that time on that day, or null. */
export function routineCellOwner(rules: ScheduleRule[], day: number, time: string): string | null {
  const row = buildRoutineRows(rules).find((x) => x.time === time);
  const cell = row?.cells[day];
  return cell && cell.kind === 'person' ? cell.userId : null;
}

function routineCellEmpty(rules: ScheduleRule[], day: number, time: string): boolean {
  const row = buildRoutineRows(rules).find((x) => x.time === time);
  return !row || !row.cells[day];
}

/**
 * Can the admin apply this request to the routine as it is now?
 *  'ok'      the routine still looks as it did when the request was made
 *  'applied' the routine already reflects it (an earlier attempt applied it)
 *  'stale'   the routine changed since; applying would overwrite someone
 */
export function routineRequestState(rules: ScheduleRule[], r: RoutineChangeRequest): 'ok' | 'applied' | 'stale' {
  // A one-off take is checked and applied by the server against the walk itself.
  if (r.kind === 'take_once') return 'ok';
  const steps = routineRequestSteps(r);
  if (steps.every((s) => (s.userId ? routineCellOwner(rules, s.day, s.time) === s.userId : routineCellEmpty(rules, s.day, s.time)))) {
    return 'applied';
  }
  const mine = r.myTime !== null && r.myDay !== null ? routineCellOwner(rules, r.myDay, r.myTime) : null;
  const theirs = r.theirTime !== null && r.theirDay !== null ? routineCellOwner(rules, r.theirDay, r.theirTime) : null;
  switch (r.kind) {
    case 'swap':
      return mine === r.requesterUserId && theirs === r.targetUserId ? 'ok' : 'stale';
    case 'give':
      return mine === r.requesterUserId ? 'ok' : 'stale';
    case 'take':
      return theirs === r.targetUserId ? 'ok' : 'stale';
    case 'change_time':
      return mine === r.requesterUserId && routineCellEmpty(rules, r.myDay!, r.newTime!) ? 'ok' : 'stale';
  }
}

/** "12.11" for a YYYY-MM-DD date. */
export function shortDateLabel(date: string | null | undefined): string {
  const m = date ? /^\d{4}-(\d{2})-(\d{2})$/.exec(date) : null;
  return m ? `${Number(m[2])}.${Number(m[1])}` : '';
}

export const routineSlotLabel = (day: number | null, time: string | null) =>
  day === null || time === null ? '' : `${DAY_LONG_LABELS[day] ?? ''} ${time}`;

/** One Hebrew line describing what is asked. */
export function describeRoutineRequest(r: RoutineChangeRequest, usersById: Record<string, Pick<FamilyUser, 'name'> | undefined>): string {
  const requester = usersById[r.requesterUserId]?.name ?? 'בן משפחה';
  const target = (r.targetUserId && usersById[r.targetUserId]?.name) || 'בן משפחה';
  switch (r.kind) {
    case 'swap':
      return `${requester} ⇄ ${target}: ${routineSlotLabel(r.myDay, r.myTime)} של ${requester} תמורת ${routineSlotLabel(r.theirDay, r.theirTime)} של ${target}`;
    case 'give':
      return `${requester} מעביר/ה ל${target} את ${routineSlotLabel(r.myDay, r.myTime)}`;
    case 'take':
      return `${requester} מבקש/ת לקחת מ${target} את ${routineSlotLabel(r.theirDay, r.theirTime)}`;
    case 'change_time':
      return `${requester}: להזיז את ${routineSlotLabel(r.myDay, r.myTime)} לשעה ${r.newTime}`;
    case 'take_once': {
      const date = shortDateLabel(r.walkDate);
      return `${requester} מבקש/ת לקחת מ${target} רק את הטיול של ${routineSlotLabel(r.theirDay, r.theirTime)}${date ? ` (${date})` : ''} · חד-פעמי`;
    }
  }
}

export function routineRequestStatusText(r: RoutineChangeRequest, usersById: Record<string, Pick<FamilyUser, 'name'> | undefined>): string {
  const target = (r.targetUserId && usersById[r.targetUserId]?.name) || 'בן המשפחה';
  switch (r.status) {
    case 'pending_target': return `ממתין לתשובה של ${target}`;
    case 'pending_admin': return 'ממתין לאישור מנהל המשפחה';
    case 'approved': return r.kind === 'take_once' ? 'אושר — הטיול הועבר' : 'אושר ועודכן בשגרה';
    case 'rejected': return 'לא אושר';
    case 'cancelled': return 'בוטל';
  }
}

/** Cells (`day|time`) touched by an open request, to mark them in the grid. */
export function openRequestCellKeys(requests: RoutineChangeRequest[]): Set<string> {
  const keys = new Set<string>();
  for (const r of requests) {
    if (!isOpenRoutineRequest(r) || r.kind === 'take_once') continue;
    if (r.myDay !== null && r.myTime) keys.add(`${r.myDay}|${r.myTime}`);
    if (r.theirDay !== null && r.theirTime) keys.add(`${r.theirDay}|${r.theirTime}`);
  }
  return keys;
}
