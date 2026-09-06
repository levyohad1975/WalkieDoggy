/**
 * NARROW BUG FIX PASS — concurrency defect in claim_family_profile_with_pin()'s
 * PIN-attempt rate limiter (migrations/0016_*.sql).
 *
 * HONESTY NOTE (same standard as lostClaimAuthorization.spec.test.ts): there
 * is no live Postgres database in this sandbox. This file does NOT, and
 * cannot, prove that concurrent Postgres transactions actually serialize
 * correctly — that is a property of Postgres's own row-locking/MVCC
 * machinery, which Jest never touches (it only mocks the RPC boundary, see
 * authStore.test.ts). What THIS file verifies instead is the pure ARITHMETIC
 * of the two candidate designs — "precompute the new count in application
 * code before writing" (final8's actual, buggy design) vs "derive the new
 * count from the row's own stored value at write time" (this pass's fix) —
 * under a SIMULATED serialized-conflict execution order that mirrors how
 * Postgres actually resolves two conflicting `INSERT ... ON CONFLICT DO
 * UPDATE` statements (the second one blocks until the first commits, then
 * evaluates its own SET expressions against the now-current row). This is a
 * logic/specification check, not a concurrency proof — see this pass's
 * MANIFEST.txt for the manual Supabase integration-test checklist that
 * actually exercises real concurrent Postgres transactions.
 */

interface AttemptRow {
  failCount: number;
  lockedUntil: number | null; // epoch ms, or null
}

type Store = Map<string, AttemptRow>;

const NOW = 1_000_000_000_000; // fixed reference "now" for determinism
const LOCK_MS = 15 * 60 * 1000;
const THRESHOLD = 5;

/**
 * FINAL8's ACTUAL, BUGGY DESIGN: the caller reads the row (or "no row"),
 * computes the new count in application code, then writes it via an upsert
 * whose conflict branch unconditionally overwrites with that PRECOMPUTED
 * value (`excluded.fail_count`) — i.e. exactly `set fail_count =
 * excluded.fail_count`. Reproduced here only to demonstrate the bug it had.
 */
function buggyPrecomputedUpsert(store: Store, key: string, nowMs: number): void {
  const existing = store.get(key);
  const failCount = existing?.failCount ?? 0;
  const newCount = failCount + 1; // computed from a snapshot read BEFORE the write
  const newLockedUntil = newCount >= THRESHOLD ? nowMs + LOCK_MS : null;
  // The "upsert" always overwrites with the precomputed values, regardless
  // of what the row's CURRENT value is by the time this write actually runs.
  store.set(key, { failCount: newCount, lockedUntil: newLockedUntil });
}

/**
 * THIS PASS'S FIX: the conflict branch derives the new count from the row's
 * OWN CURRENT stored value at write time — mirroring `set fail_count =
 * profile_pin_attempts.fail_count + 1` (with the expired-cooldown reset
 * folded in, mirroring the CASE expression in the migration). Since this
 * function itself reads `store.get(key)` fresh on every call, calling it
 * once per "transaction" IN COMMIT ORDER is the correct way to simulate
 * Postgres's actual behavior: a blocked conflicting UPDATE re-evaluates its
 * SET expressions against the row as it exists AFTER the blocking
 * transaction commits, not against a snapshot taken before the wait began.
 */
function fixedAtomicUpsert(store: Store, key: string, nowMs: number): void {
  const existing = store.get(key);
  const cooldownExpired = existing?.lockedUntil != null && existing.lockedUntil <= nowMs;
  const newCount = !existing || cooldownExpired ? 1 : existing.failCount + 1;
  const newLockedUntil = newCount >= THRESHOLD ? nowMs + LOCK_MS : null;
  store.set(key, { failCount: newCount, lockedUntil: newLockedUntil });
}

/**
 * Simulates N "concurrent" wrong-PIN calls for the same key as Postgres
 * actually resolves them: each call blocks until it can acquire the row's
 * lock, in SOME serial commit order (order is a scheduling detail — which
 * one wins the lock race first is not deterministic in real Postgres — but
 * every real execution DOES commit them one at a time, in SOME order, never
 * truly simultaneously at the row level). Modeling them as a simple ordered
 * loop is therefore a faithful mirror of "N conflicting UPSERTs eventually
 * all commit, one at a time, each seeing the previous one's result" —
 * exactly the property final8's buggy design violated (it could have every
 * racer's write depend on a snapshot from BEFORE the wait, not after).
 */
function runNConcurrentAttempts(
  upsert: (store: Store, key: string, nowMs: number) => void,
  n: number,
  key = 'caller-1|target-1',
  nowMs = NOW
): AttemptRow {
  const store: Store = new Map();
  for (let i = 0; i < n; i++) {
    upsert(store, key, nowMs);
  }
  return store.get(key)!;
}

describe('PIN attempt rate limiter — pure-logic mirror of the DO UPDATE SET arithmetic (migrations/0016_*.sql)', () => {
  describe('the bug this pass fixes (final8\'s precomputed-value design)', () => {
    it('correctly counts a single attempt (the bug only manifests under a real race, which a plain loop over "committed" writes does not reproduce by itself)', () => {
      const row = runNConcurrentAttempts(buggyPrecomputedUpsert, 1);
      expect(row.failCount).toBe(1);
    });

    it('DEMONSTRATES the actual lost-update failure mode: two racers who BOTH read "no row" before either writes, then both compute newCount=1 independently, collapse into a persisted count of 1 instead of 2', () => {
      const store: Store = new Map();
      const key = 'caller-1|target-1';
      // Both racers read the pre-write state (no row) BEFORE either writes —
      // this is the actual race final8 was vulnerable to: the PL/pgSQL
      // computation happened from a `select ... for update` that, for a
      // brand-new pair, locked nothing and could be stale by write time.
      const racer1Existing = store.get(key);
      const racer2Existing = store.get(key);
      const racer1NewCount = (racer1Existing?.failCount ?? 0) + 1;
      const racer2NewCount = (racer2Existing?.failCount ?? 0) + 1;
      // Both then "write" (in whatever order Postgres's row lock actually
      // serializes them) using their OWN precomputed value, exactly like
      // `set fail_count = excluded.fail_count` does — the second write
      // clobbers the first's effect instead of building on it.
      store.set(key, { failCount: racer1NewCount, lockedUntil: null });
      store.set(key, { failCount: racer2NewCount, lockedUntil: null });

      expect(store.get(key)!.failCount).toBe(1); // BUG: should be 2
    });
  });

  describe('this pass\'s fix (derive-from-current-row design)', () => {
    it('a single wrong attempt for a brand-new pair -> fail_count 1, not locked', () => {
      const row = runNConcurrentAttempts(fixedAtomicUpsert, 1);
      expect(row.failCount).toBe(1);
      expect(row.lockedUntil).toBeNull();
    });

    it('N serialized (Postgres-style) conflicting writes for the SAME pair correctly accumulate to N — the exact race final8 lost', () => {
      for (const n of [1, 2, 3, 4, 5, 6, 10]) {
        const row = runNConcurrentAttempts(fixedAtomicUpsert, n);
        expect(row.failCount).toBe(n);
      }
    });

    it('the 5th attempt locks; attempts 1-4 do not', () => {
      for (let n = 1; n <= 4; n++) {
        expect(runNConcurrentAttempts(fixedAtomicUpsert, n).lockedUntil).toBeNull();
      }
      const fifth = runNConcurrentAttempts(fixedAtomicUpsert, 5);
      expect(fifth.failCount).toBe(5);
      expect(fifth.lockedUntil).toBe(NOW + LOCK_MS);
    });

    it('a 6th attempt landing before the row is ever read as "expired" keeps incrementing past 5 (this function does not itself refuse writes during cooldown — the SQL function\'s earlier, separate cooldown-check branch is what refuses the RPC call before this statement is ever reached; this upsert alone is just the counter)', () => {
      const sixth = runNConcurrentAttempts(fixedAtomicUpsert, 6);
      expect(sixth.failCount).toBe(6);
      expect(sixth.lockedUntil).toBe(NOW + LOCK_MS);
    });

    it('EXPIRED-COOLDOWN RESET: a wrong attempt after locked_until has passed starts a fresh sequence at 1, not 6', () => {
      const store: Store = new Map();
      const key = 'caller-1|target-1';
      // Drive to a locked state at NOW.
      for (let i = 0; i < 5; i++) fixedAtomicUpsert(store, key, NOW);
      expect(store.get(key)!.failCount).toBe(5);
      expect(store.get(key)!.lockedUntil).toBe(NOW + LOCK_MS);

      // A new wrong attempt AFTER the cooldown has expired.
      const afterExpiry = NOW + LOCK_MS + 1;
      fixedAtomicUpsert(store, key, afterExpiry);

      expect(store.get(key)!.failCount).toBe(1); // fresh sequence, not 6
      expect(store.get(key)!.lockedUntil).toBeNull();
    });

    it('a wrong attempt DURING an still-active cooldown (hypothetically reaching this statement at all) would continue incrementing rather than resetting — confirming the reset is keyed on EXPIRY, not merely "locked_until is set"', () => {
      const store: Store = new Map();
      const key = 'caller-1|target-1';
      for (let i = 0; i < 5; i++) fixedAtomicUpsert(store, key, NOW);
      const stillLocked = NOW + LOCK_MS - 1; // one ms before expiry
      fixedAtomicUpsert(store, key, stillLocked);
      expect(store.get(key)!.failCount).toBe(6); // NOT reset — cooldown not yet expired
      // (In the real function, this statement is never actually reached
      // while locked_until is still in the future — the separate,
      // earlier cooldown-check branch returns {success:false,
      // reason:'cooldown'} first. This test only confirms the upsert's OWN
      // arithmetic is correctly keyed on expiry, independent of that
      // earlier guard.)
    });

    it('different (caller, target) pairs never interfere with each other', () => {
      const store: Store = new Map();
      fixedAtomicUpsert(store, 'caller-1|target-A', NOW);
      fixedAtomicUpsert(store, 'caller-1|target-A', NOW);
      fixedAtomicUpsert(store, 'caller-1|target-B', NOW);
      fixedAtomicUpsert(store, 'caller-2|target-A', NOW);

      expect(store.get('caller-1|target-A')!.failCount).toBe(2);
      expect(store.get('caller-1|target-B')!.failCount).toBe(1);
      expect(store.get('caller-2|target-A')!.failCount).toBe(1);
    });
  });
});
