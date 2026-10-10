import { SupabaseRepository } from '../supabaseRepository';
import { SupabaseTimeoutError } from '../../lib/withTimeout';
import type { ScheduleEntry, ScheduleRule, Walk } from '../../types';

/**
 * Real-device QA fix — "Schedule save never completes" (double-tap bug,
 * round 2). Real-iPhone evidence: the new schedule_rules row for 18:00
 * was already confirmed present in Supabase while the Save spinner kept
 * spinning indefinitely — proving the INSERT succeeded and something
 * AWAITED after it never settled. scheduleStore.addRule() awaits, in
 * order: upsertScheduleRule(), addScheduleEntries() (two sequential
 * calls), then saveWalk() once per generated occurrence (up to
 * GENERATE_DAYS_AHEAD of them, each itself up to two sequential calls).
 * None of these carried a client-side timeout, so a single stalled
 * supabase-js call anywhere in that chain hung the whole awaited promise
 * forever — exactly what a real mobile connection can do (a dropped
 * connection, a backgrounded tab mid-request, a flaky cell handoff).
 *
 * These tests simulate that exact condition — a client call whose promise
 * never settles — against each of the three methods in that chain, and
 * prove they now reject within the bounded SUPABASE_CALL_TIMEOUT_MS
 * instead of hanging. This is the proof requirement: "a successful
 * remote INSERT cannot leave addRule/onSave pending indefinitely" — here
 * demonstrated one level down, at the exact network call that can stall.
 */
describe('SupabaseRepository — a stalled network call times out instead of hanging forever', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  function neverSettlingThenable() {
    // A minimal stand-in for a supabase-js query builder whose underlying
    // fetch never resolves or rejects — the real-world condition this
    // whole fix is for. Real builders are thenables (awaitable), not
    // Promise instances, so this deliberately only implements `.then`.
    return { then: () => undefined } as unknown as PromiseLike<never>;
  }

  it('saveWalk() for a new scheduled (pending) occurrence times out rather than hanging — this is the highest-probability real-device hang point, since addRule() calls it once per generated walk', async () => {
    const client: any = {
      from: () => ({
        select: () => ({
          eq: () => ({
            maybeSingle: () => neverSettlingThenable(),
          }),
        }),
      }),
    };
    const repo = new SupabaseRepository(client);
    const walk: Walk = {
      id: 'walk-1',
      familyId: 'fam-1',
      dogId: 'dog-1',
      responsibleUserId: 'user-1',
      date: '2026-10-05',
      scheduledTime: '18:00',
      status: 'pending',
      scheduleEntryId: 'entry-1',
      isUnplanned: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    } as Walk;

    const promise = repo.saveWalk(walk);
    const assertion = expect(promise).rejects.toBeInstanceOf(SupabaseTimeoutError);
    await jest.advanceTimersByTimeAsync(15000);
    await assertion;
  });

  it('addScheduleEntries() times out on a stalled upsert rather than hanging', async () => {
    const client: any = {
      from: () => ({
        upsert: () => neverSettlingThenable(),
      }),
    };
    const repo = new SupabaseRepository(client);
    const entry: ScheduleEntry = {
      id: 'entry-1',
      ruleId: 'rule-1',
      dogId: 'dog-1',
      familyId: 'fam-1',
      date: '2026-10-05',
      time: '18:00',
      responsibleUserId: 'user-1',
    } as ScheduleEntry;

    const promise = repo.addScheduleEntries([entry]);
    const assertion = expect(promise).rejects.toBeInstanceOf(SupabaseTimeoutError);
    await jest.advanceTimersByTimeAsync(15000);
    await assertion;
  });

  it('upsertScheduleRule() times out on a stalled update rather than hanging', async () => {
    const client: any = {
      from: () => ({
        update: () => ({
          eq: () => ({
            select: () => neverSettlingThenable(),
          }),
        }),
      }),
    };
    const repo = new SupabaseRepository(client);
    const rule: ScheduleRule = {
      id: 'rule-1',
      familyId: 'fam-1',
      dogId: 'dog-1',
      time: '18:00',
      daysOfWeek: [0, 1, 2, 3, 4, 5, 6],
      rotationUserIds: ['user-1'],
      rotationAnchorDate: '2026-08-27',
      sortOrder: 0,
      active: true,
      createdAt: new Date().toISOString(),
    };

    const promise = repo.upsertScheduleRule(rule);
    const assertion = expect(promise).rejects.toBeInstanceOf(SupabaseTimeoutError);
    await jest.advanceTimersByTimeAsync(15000);
    await assertion;
  });
});
