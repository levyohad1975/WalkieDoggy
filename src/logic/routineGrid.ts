/**
 * Weekly routine grid (owner request 2026-11-09): "ניהול שגרה" shows the
 * routine as times × days instead of one row per rule. Each cell says who
 * walks at that time on that day. The grid is only a view of the existing
 * schedule rules; an edit becomes ordinary rule operations (updateRule /
 * deleteRule / addRule), so walks, reminders and history keep working.
 *
 * The database refuses two active rules for the same dog at the same time
 * with a shared day (prevent_overlapping_schedule_rules), so a plan always
 * removes the day from its old rule BEFORE giving it to the new one.
 */
import type { FamilyUser, ScheduleRule } from '../types';

export const WEEK_DAYS = [0, 1, 2, 3, 4, 5, 6] as const;
export const DAY_SHORT_LABELS = ['א׳', 'ב׳', 'ג׳', 'ד׳', 'ה׳', 'ו׳', 'ש׳'];
export const DAY_LONG_LABELS = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];

export type RoutineCell =
  | { kind: 'person'; ruleId: string; userId: string }
  /** A rule with a rotation of several people: edited in the full rule form. */
  | { kind: 'rotation'; ruleId: string; userIds: string[] }
  | null;

export interface RoutineRow {
  time: string;
  cells: RoutineCell[]; // index = day of week (0 = Sunday)
}

export type RoutineOp =
  | { type: 'update'; ruleId: string; daysOfWeek: number[] }
  | { type: 'delete'; ruleId: string }
  | { type: 'add'; time: string; daysOfWeek: number[]; userId: string };

const sortDays = (days: number[]) => [...new Set(days)].sort((a, b) => a - b);

export function buildRoutineRows(rules: ScheduleRule[]): RoutineRow[] {
  const active = rules.filter((r) => r.active);
  const times = [...new Set(active.map((r) => r.time))].sort();
  return times.map((time) => {
    const cells: RoutineCell[] = WEEK_DAYS.map(() => null);
    for (const rule of active.filter((r) => r.time === time)) {
      for (const day of rule.daysOfWeek) {
        if (day < 0 || day > 6 || cells[day]) continue;
        cells[day] = rule.rotationUserIds.length === 1
          ? { kind: 'person', ruleId: rule.id, userId: rule.rotationUserIds[0] }
          : { kind: 'rotation', ruleId: rule.id, userIds: rule.rotationUserIds };
      }
    }
    return { time, cells };
  });
}

/**
 * Who walks at `time` on each of `days` from now on: `userId`, or nobody.
 * Removals come first, then the person's single rule at that time is
 * extended (or created), which also merges duplicate rules of one person.
 */
export function planCellAssignment(rules: ScheduleRule[], time: string, days: number[], userId: string | null): RoutineOp[] {
  const target = sortDays(days.filter((d) => d >= 0 && d <= 6));
  if (target.length === 0) return [];
  const atTime = rules.filter((r) => r.active && r.time === time);
  const personRules = userId ? atTime.filter((r) => r.rotationUserIds.length === 1 && r.rotationUserIds[0] === userId) : [];
  const keep = personRules[0];
  const ops: RoutineOp[] = [];

  for (const rule of atTime) {
    if (keep && rule.id === keep.id) continue;
    // A duplicate rule of the same person at this time is merged into `keep`.
    const mergeAll = Boolean(keep && personRules.some((r) => r.id === rule.id));
    const remaining = mergeAll ? [] : rule.daysOfWeek.filter((d) => !target.includes(d));
    if (remaining.length === rule.daysOfWeek.length) continue;
    ops.push(remaining.length === 0 ? { type: 'delete', ruleId: rule.id } : { type: 'update', ruleId: rule.id, daysOfWeek: sortDays(remaining) });
  }

  if (userId) {
    if (keep) {
      const merged = sortDays([...keep.daysOfWeek, ...target, ...personRules.slice(1).flatMap((r) => r.daysOfWeek)]);
      if (merged.join(',') !== sortDays(keep.daysOfWeek).join(',')) ops.push({ type: 'update', ruleId: keep.id, daysOfWeek: merged });
    } else {
      ops.push({ type: 'add', time, daysOfWeek: target, userId });
    }
  }
  return ops;
}

/** Walks per person per week; days of a rotation rule are counted apart. */
export function weeklyLoad(rows: RoutineRow[]): { byUser: Record<string, number>; rotation: number; empty: number } {
  const byUser: Record<string, number> = {};
  let rotation = 0;
  let empty = 0;
  for (const row of rows) {
    for (const cell of row.cells) {
      if (!cell) empty += 1;
      else if (cell.kind === 'rotation') rotation += 1;
      else byUser[cell.userId] = (byUser[cell.userId] ?? 0) + 1;
    }
  }
  return { byUser, rotation, empty };
}

/** A distinct on-screen tint per family member (profile colours often repeat). */
export const ROUTINE_TINTS = [
  { bg: '#DCEBFF', fg: '#1F4E9A' },
  { bg: '#DDF3E6', fg: '#1E6B3E' },
  { bg: '#EFE1F8', fg: '#6B2E8C' },
  { bg: '#FFE6CC', fg: '#8A4B00' },
  { bg: '#FCE0E6', fg: '#8F2840' },
  { bg: '#DFF5F7', fg: '#0B5C75' },
  { bg: '#FFF3C4', fg: '#6E5A00' },
  { bg: '#E8E6FF', fg: '#3D3591' },
];

export function tintsByUser(users: FamilyUser[]): Record<string, { bg: string; fg: string }> {
  return Object.fromEntries(users.map((u, i) => [u.id, ROUTINE_TINTS[i % ROUTINE_TINTS.length]]));
}
