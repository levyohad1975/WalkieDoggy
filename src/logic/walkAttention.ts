import type { Walk } from '../types';
import { walkDateTime } from './nextWalk';

/**
 * Batch 2, requirement 7: "create/support an in-app state meaning 'Walk
 * requires attention'" for a walk still pending 30 minutes (T+30) after its
 * scheduled time — the same threshold the server-side scheduler uses for
 * its admin-escalation stage (see supabase/migrations/0025_walk_reminder_scheduler.sql's
 * 'T+30' stage and src/logic/reminderMessages.ts's REMINDER_STAGE_OFFSET_MINUTES).
 *
 * DELIBERATELY a pure, derived function rather than a new persisted
 * column/flag: "requires attention" is 100% computable from data the app
 * already has (walk.status + walk.date/scheduledTime) — exactly the same
 * pattern already used for isOverdue() (src/logic/nextWalk.ts) and
 * computeRequestLifecycle()'s 'expired' state (src/logic/requestLifecycle.ts).
 * No migration, no write path, and — importantly — nothing here can ever
 * "add more reminders": this only answers a yes/no question at render time.
 *
 * Uses the SAME device-local date/time interpretation as every other
 * "is this walk overdue" computation in this codebase today
 * (walkDateTime()) — not family-timezone-aware. The server-side scheduler
 * (0025) is what actually enforces the family's authoritative timezone for
 * SENDING reminders (Decision 3); this client-side, read-only "does this
 * deserve a visual flag right now" helper intentionally stays consistent
 * with isOverdue()'s existing behavior rather than introducing a second,
 * differently-computed notion of "overdue" in the UI. See this batch's
 * report for that scope decision.
 */
export const ATTENTION_MINUTES_AFTER = 30;

export function isWalkRequiringAttention(walk: Pick<Walk, 'status' | 'date' | 'scheduledTime'>, now: Date = new Date()): boolean {
  if (walk.status !== 'pending') return false;
  const scheduled = walkDateTime(walk);
  return now.getTime() - scheduled.getTime() >= ATTENTION_MINUTES_AFTER * 60000;
}
