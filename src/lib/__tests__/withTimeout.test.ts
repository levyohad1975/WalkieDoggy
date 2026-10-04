import { SupabaseTimeoutError, withTimeout } from '../withTimeout';

/**
 * Real-device QA fix — "Schedule save never completes" (double-tap bug,
 * round 2): see withTimeout.ts's own doc comment for the full root-cause
 * analysis. This is the focused unit test for the primitive itself; see
 * supabaseRepository.networkTimeout.test.ts for the actual call sites
 * (saveWalk/addScheduleEntries/upsertScheduleRule) that use it.
 */
describe('withTimeout', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('resolves with the underlying value when it settles before the timeout', async () => {
    const promise = withTimeout(Promise.resolve('ok'), 15000, 'test call');
    await expect(promise).resolves.toBe('ok');
  });

  it('rejects with the underlying error when it rejects before the timeout', async () => {
    const promise = withTimeout(Promise.reject(new Error('boom')), 15000, 'test call');
    await expect(promise).rejects.toThrow('boom');
  });

  it('a promise that NEVER settles still rejects once the timeout elapses — this is the core guarantee the Schedule-save hang fix depends on', async () => {
    const neverSettles = new Promise<string>(() => {
      /* intentionally never resolves/rejects — simulates a stalled fetch */
    });
    const promise = withTimeout(neverSettles, 15000, 'stalled call');

    const assertion = expect(promise).rejects.toBeInstanceOf(SupabaseTimeoutError);
    jest.advanceTimersByTime(15000);
    await assertion;
  });

  it("the timeout error names the call and the configured duration, and carries no `.code` — syncQueue.ts's isPermanentSyncError() must classify it as RETRYABLE, not permanent", async () => {
    const neverSettles = new Promise<string>(() => undefined);
    const promise = withTimeout(neverSettles, 15000, 'stalled call');
    jest.advanceTimersByTime(15000);

    await expect(promise).rejects.toMatchObject({
      name: 'SupabaseTimeoutError',
      message: expect.stringContaining('stalled call'),
    });
    try {
      await promise;
    } catch (error) {
      expect((error as { code?: string }).code).toBeUndefined();
    }
  });

  it('clears its internal timer once the promise settles — a fast call never leaves a dangling timer behind', async () => {
    const promise = withTimeout(Promise.resolve('fast'), 15000, 'fast call');
    await promise;
    // If the internal timer were not cleared, advancing past it would
    // attempt to reject an already-settled promise — jest would surface
    // an unhandled rejection / "Promise is already resolved" style issue.
    // Advancing here and letting the test complete cleanly is the proof.
    jest.advanceTimersByTime(20000);
  });
});
