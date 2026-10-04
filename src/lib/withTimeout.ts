/**
 * Real-device QA fix — "Schedule save never completes" (double-tap bug,
 * round 2). Real-iPhone evidence: the new schedule_rules row for 18:00 was
 * already confirmed present in Supabase while the Save spinner kept
 * spinning indefinitely. That proves the INSERT itself is not the problem
 * — something AWAITED after it never settles.
 *
 * Root cause: addRule() (scheduleStore.ts) awaits a SEQUENTIAL chain of
 * Supabase network calls after the rule insert — addScheduleEntries()
 * (an upsert, then a read-back of canonical ids) and one saveWalk() call
 * PER generated occurrence (up to GENERATE_DAYS_AHEAD = 14 of them, each
 * itself up to two sequential calls: a lookup, then an upsert). None of
 * supabase-js's underlying fetch calls anywhere in this codebase carry a
 * client-side timeout — on a real mobile connection, ANY single one of
 * those awaited calls stalling (a dropped TCP connection, a backgrounded
 * tab mid-request, a flaky cell handoff) leaves that `await` — and
 * therefore the whole chain RuleFormModal's `saving` state is awaiting —
 * pending forever. There was nothing wrong with the duplicate-tap guard
 * added in 7583b59 (it worked exactly as intended — exactly one call was
 * made); the hang is further down this same awaited chain, on whichever
 * single network call happens to stall.
 *
 * Fix: wrap the SPECIFIC Supabase calls in this exact chain
 * (SupabaseRepository.upsertScheduleRule/addScheduleEntries/saveWalk —
 * see each one's own call sites) with this helper, so a stalled call
 * REJECTS instead of hanging. The resulting error carries no `.code`
 * property, so syncQueue.ts's isPermanentSyncError() already classifies
 * it as RETRYABLE (the same bucket as a genuine network/5xx failure) —
 * this is not a new failure category, it slots into the exact
 * offline-first "queue it, retry later" path OfflineFirstRepository
 * already has for every other transient failure. The net effect: a
 * stalled call now fails fast and predictably instead of hanging forever,
 * so addRule()/onSave() always SETTLES (success, queued-for-retry, or a
 * surfaced error) within a bounded time — never pending indefinitely —
 * and RuleFormModal's `finally { setSaving(false) }` always runs.
 */
export class SupabaseTimeoutError extends Error {
  constructor(label: string, ms: number) {
    super(`${label} did not respond within ${ms}ms`);
    this.name = 'SupabaseTimeoutError';
  }
}

/**
 * 15s: long enough that a genuinely slow-but-working mobile connection
 * (3G, a cold Supabase connection pool, etc.) is not falsely treated as
 * failed, short enough that "the spinner never stops" can never again
 * mean "literally forever" — the worst case becomes one bounded wait per
 * network call in the chain, not an unbounded one.
 */
export const SUPABASE_CALL_TIMEOUT_MS = 15000;

/**
 * Races `promise` against a timer. On timeout, rejects with
 * SupabaseTimeoutError (never hangs); the original promise is left to
 * settle on its own (there is no way to cancel a supabase-js/fetch call
 * already in flight) — its eventual result is simply ignored once the
 * timeout has already resolved this race.
 */
export function withTimeout<T>(promise: PromiseLike<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new SupabaseTimeoutError(label, ms)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      }
    );
  });
}
