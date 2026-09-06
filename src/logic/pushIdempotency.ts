/**
 * Idempotency correction: the pure decision rule behind
 * claim_request_push_event() (migration 0014_request_push_events.sql),
 * documented and unit-tested here so the rule itself is reviewable/testable
 * independent of the Deno HTTP handler and the SQL that actually enforces
 * it atomically.
 *
 * IMPORTANT: this function does NOT provide the atomicity guarantee by
 * itself — two concurrent Edge Function invocations racing on the same
 * dedupeKey could both evaluate this function against the same "existing
 * row" snapshot and both conclude 'claim'. The REAL guarantee is the
 * database's unique constraint on `request_push_events.dedupe_key` plus a
 * single atomic `INSERT ... ON CONFLICT (dedupe_key) DO UPDATE ... WHERE
 * <this same rule, expressed in SQL>` statement, which Postgres resolves
 * under row-level locking so only one of two racing callers ever actually
 * inserts/updates the row (see the migration's claim_request_push_event()
 * function). This TS function exists so that same rule has one place where
 * it's spelled out precisely and can be tested with plain unit tests,
 * rather than only living inside untestable SQL/Deno code — keep both in
 * sync if the rule ever changes.
 */

export type PushEventStatus = 'sending' | 'sent' | 'failed';

export interface ExistingPushEventRow {
  status: PushEventStatus;
  /** ISO timestamp of the row's last update — used to detect a `sending` row stuck by a crashed/timed-out invocation. */
  updatedAt: string;
}

export type ClaimOutcome =
  | 'claim' // no prior row — safe to insert one and proceed to send
  | 'already_sent' // a prior attempt already completed successfully — never resend
  | 'already_sending' // a prior attempt is still in flight and not yet stale — don't send a duplicate concurrently
  | 'reclaim_stale'; // a prior attempt claimed this key but never finished (crash/timeout) long enough ago that it's safe to retry

/**
 * Default staleness window for a stuck `sending` row (Requirement 3): long
 * enough that a normal Expo API round trip always finishes well within it,
 * short enough that a genuinely crashed invocation doesn't block a
 * legitimate retry for an unreasonable amount of time.
 */
export const DEFAULT_STALE_MS = 30_000;

export function decideClaimOutcome(
  existing: ExistingPushEventRow | null,
  now: Date = new Date(),
  staleMs: number = DEFAULT_STALE_MS
): ClaimOutcome {
  if (!existing) return 'claim';
  if (existing.status === 'sent') return 'already_sent';
  if (existing.status === 'failed') return 'claim'; // a failed send remains retryable, per Requirement 3
  // status === 'sending'
  const ageMs = now.getTime() - new Date(existing.updatedAt).getTime();
  return ageMs > staleMs ? 'reclaim_stale' : 'already_sending';
}

/** Whether a given claim outcome means "proceed to actually call the Expo API". */
export function shouldSend(outcome: ClaimOutcome): boolean {
  return outcome === 'claim' || outcome === 'reclaim_stale';
}
