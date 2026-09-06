/**
 * Bug 1 (foreground schedule refresh) + Bug 2 (cold-start sync race)
 * regression tests, at the level that's actually testable without rendering
 * the full React Native component tree: App.tsx's exported
 * `runForegroundSync()` / `performColdStart()` orchestration functions,
 * with every store/service dependency mocked so call ORDER can be asserted
 * directly.
 */

const mockTrySync = jest.fn().mockResolvedValue(undefined);
jest.mock('../src/data', () => ({
  repository: { trySync: (...args: unknown[]) => mockTrySync(...args) },
  setSyncQueueActorGetter: jest.fn(),
}));

let mockAuthState = { familyId: 'family-1', currentUserId: 'user-a' };
const mockRevalidateClaim = jest.fn().mockResolvedValue(undefined);
jest.mock('../src/store/authStore', () => ({
  useAuthStore: { getState: () => ({ ...mockAuthState, revalidateClaim: mockRevalidateClaim }) },
}));

const mockScheduleLoad = jest.fn();
let mockScheduleWalks: unknown[] = [];
jest.mock('../src/store/scheduleStore', () => ({
  useScheduleStore: { getState: () => ({ load: (...args: unknown[]) => mockScheduleLoad(...args), walks: mockScheduleWalks }) },
  reconcileScheduleNotifications: jest.fn().mockResolvedValue(undefined),
}));

const mockRequestsLoad = jest.fn().mockResolvedValue(undefined);
jest.mock('../src/store/requestsStore', () => ({
  useRequestsStore: { getState: () => ({ load: (...args: unknown[]) => mockRequestsLoad(...args) }) },
}));

jest.mock('../src/lib/supabase', () => ({ isSupabaseConfigured: true }));

const mockTouchLastSeen = jest.fn().mockResolvedValue(undefined);
jest.mock('../src/lib/requests', () => ({ touchLastSeen: (...args: unknown[]) => mockTouchLastSeen(...args) }));

jest.mock('../src/notifications/notificationService', () => ({
  requestNotificationPermissions: jest.fn().mockResolvedValue(true),
}));

jest.mock('../src/navigation/RootNavigator', () => ({ RootNavigator: () => null }));
jest.mock('../src/screens/LoginScreen', () => ({ LoginScreen: () => null }));
jest.mock('../src/screens/FamilyOnboardingScreen', () => ({ FamilyOnboardingScreen: () => null }));
// These are only ever touched inside App()'s JSX, which this file never
// renders (it only exercises the exported orchestration functions) — mocked
// anyway so importing App.tsx never depends on native view registration.
jest.mock('react-native-safe-area-context', () => ({
  SafeAreaProvider: ({ children }: { children?: unknown }) => children ?? null,
  SafeAreaView: ({ children }: { children?: unknown }) => children ?? null,
}));
jest.mock('expo-status-bar', () => ({ StatusBar: () => null }));

import { performColdStart, runForegroundSync } from '../App';

function orderOf(calls: { name: string; mock: jest.Mock }[]): string[] {
  const events: { name: string; order: number }[] = [];
  for (const { name, mock } of calls) {
    mock.mock.invocationCallOrder.forEach((order) => events.push({ name, order }));
  }
  return events.sort((a, b) => a.order - b.order).map((e) => e.name);
}

beforeEach(() => {
  jest.clearAllMocks();
  // jest.clearAllMocks() only resets call history (mock.calls/results) — it
  // does NOT remove a custom mockImplementation installed by an earlier test
  // (that's mockReset()/resetAllMocks()). The "guards against two
  // overlapping runs" test below installs a mockTrySync implementation that
  // returns a promise it never resolves (it captures `resolveTrySync` in a
  // test-local variable and only calls it once, inside that same test). Left
  // in place, every later test's `await repository.trySync?.()` call inside
  // runForegroundSync() hangs forever: the awaited call never settles, so
  // runForegroundSync()'s `finally` block never runs and the module-scope
  // `foregroundSyncInFlight` guard in App.tsx is left stuck at `true` —
  // which then makes every subsequent runForegroundSync()/performColdStart()
  // call in the suite silently no-op (the guard returns immediately without
  // calling anything downstream). Restoring the default resolved
  // implementation here, every test, is what keeps each test's mockTrySync
  // behavior independent of what earlier tests configured on it.
  mockTrySync.mockResolvedValue(undefined);
  mockAuthState = { familyId: 'family-1', currentUserId: 'user-a' };
  mockScheduleWalks = [];
  mockScheduleLoad.mockImplementation(async () => {
    // Simulates the reload actually replacing walks — a later assertion
    // checks reconcile runs against THIS (post-reload) value, not whatever
    // was there before. Resolves true — the real scheduleStore.load()
    // contract: true means fresh, authoritative data was loaded.
    mockScheduleWalks = [{ id: 'walk-1', status: 'done' }];
    return true;
  });
});

describe('Bug 1 — runForegroundSync() orchestration order', () => {
  it('runs mockTrySync, then schedule reload, then requests reload, then reconcile, then presence/claim housekeeping, in that exact order', async () => {
    await runForegroundSync();

    const order = orderOf([
      { name: 'mockTrySync', mock: mockTrySync },
      { name: 'mockScheduleLoad', mock: mockScheduleLoad },
      { name: 'mockRequestsLoad', mock: mockRequestsLoad },
      { name: 'mockTouchLastSeen', mock: mockTouchLastSeen },
      { name: 'mockRevalidateClaim', mock: mockRevalidateClaim },
    ]);

    expect(order).toEqual(['mockTrySync', 'mockScheduleLoad', 'mockRequestsLoad', 'mockTouchLastSeen', 'mockRevalidateClaim']);
  });

  it('reloads the schedule (step 2) before reconciling notifications (step 4) — Device B foreground scenario', async () => {
    // mockScheduleWalks starts empty; mockScheduleLoad (mocked above) populates it.
    // reconcileNotificationsNow() reads useScheduleStore.getState().walks
    // synchronously — asserting it only fires with a non-empty walks array
    // confirms it ran AFTER mockScheduleLoad populated it, not before.
    const { reconcileScheduleNotifications } = require('../src/store/scheduleStore');

    await runForegroundSync();

    expect(mockScheduleLoad.mock.invocationCallOrder[0]).toBeLessThan(
      reconcileScheduleNotifications.mock.invocationCallOrder[0]
    );
    expect(reconcileScheduleNotifications).toHaveBeenCalledWith('family-1', [{ id: 'walk-1', status: 'done' }]);
  });

  it('is a no-op when there is no claimed family/profile yet', async () => {
    mockAuthState = { familyId: null as unknown as string, currentUserId: null as unknown as string };
    await runForegroundSync();
    expect(mockTrySync).not.toHaveBeenCalled();
    expect(mockScheduleLoad).not.toHaveBeenCalled();
  });

  it('guards against two overlapping runs — a second call while the first is still in-flight does not start a duplicate pipeline', async () => {
    // Note: runForegroundSync() now dedupes via a shared in-flight promise
    // (not a boolean no-op guard) — see the "Test E" describe block below
    // for the dedicated test asserting BOTH callers' promises resolve only
    // once the shared orchestration genuinely completes. This test just
    // covers the "no duplicate pipeline" half.
    let resolveTrySync!: () => void;
    mockTrySync.mockImplementation(() => new Promise<void>((resolve) => (resolveTrySync = resolve)));

    const first = runForegroundSync();
    const second = runForegroundSync(); // fires while `first` is still awaiting mockTrySync()

    resolveTrySync();
    await first;
    await second;

    expect(mockTrySync).toHaveBeenCalledTimes(1);
    expect(mockScheduleLoad).toHaveBeenCalledTimes(1);
  });
});

describe('Test E — shared-promise guard: concurrent runForegroundSync() callers', () => {
  it('a second overlapping call reuses the first call\'s in-flight promise, and BOTH resolve only once the orchestration genuinely completes', async () => {
    let resolveTrySync!: () => void;
    let trySyncSettled = false;
    mockTrySync.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveTrySync = () => {
            trySyncSettled = true;
            resolve();
          };
        })
    );

    let firstSettled = false;
    let secondSettled = false;
    const first = runForegroundSync().then(() => {
      firstSettled = true;
    });
    const second = runForegroundSync().then(() => {
      secondSettled = true;
    }); // fires while `first` is still awaiting mockTrySync() — should reuse the SAME in-flight promise, not start a second pipeline

    // Let any already-resolved microtasks flush without resolving trySync yet.
    await Promise.resolve();
    await Promise.resolve();
    expect(trySyncSettled).toBe(false);
    expect(firstSettled).toBe(false);
    expect(secondSettled).toBe(false);
    // Neither caller has been released yet — proves the second call did not
    // silently no-op past a boolean guard while the first was still pending;
    // it is genuinely still waiting on the shared in-flight promise.
    expect(mockScheduleLoad).not.toHaveBeenCalled();

    resolveTrySync();
    await first;
    await second;

    // Both awaited promises actually settled once the real orchestration finished.
    expect(firstSettled).toBe(true);
    expect(secondSettled).toBe(true);

    // No duplicate pipeline: every downstream step ran exactly once, not
    // skipped and not duplicated.
    expect(mockTrySync).toHaveBeenCalledTimes(1);
    expect(mockScheduleLoad).toHaveBeenCalledTimes(1);
    expect(mockRequestsLoad).toHaveBeenCalledTimes(1);
    expect(mockTouchLastSeen).toHaveBeenCalledTimes(1);
    expect(mockRevalidateClaim).toHaveBeenCalledTimes(1);
    const { reconcileScheduleNotifications } = require('../src/store/scheduleStore');
    expect(reconcileScheduleNotifications).toHaveBeenCalledTimes(1);

    // A subsequent, non-overlapping call starts a fresh pipeline (the guard
    // correctly clears once the shared promise settles). Restore a
    // resolving default first — the custom never-auto-resolving
    // implementation installed above only had its one captured `resolve`
    // called already, and a fresh mockTrySync() call here would otherwise
    // return a brand-new promise that hangs forever.
    mockTrySync.mockResolvedValue(undefined);
    await runForegroundSync();
    expect(mockTrySync).toHaveBeenCalledTimes(2);
  });
});

describe('Round-6 fix #2 — schedule-load success/failure signal gates notification reconciliation', () => {
  it('(A) successful schedule load: reconciliation runs and receives the freshly-loaded walks', async () => {
    const { reconcileScheduleNotifications } = require('../src/store/scheduleStore');
    mockScheduleLoad.mockImplementation(async () => {
      mockScheduleWalks = [{ id: 'walk-fresh', status: 'pending' }];
      return true;
    });

    await runForegroundSync();

    expect(reconcileScheduleNotifications).toHaveBeenCalledTimes(1);
    expect(reconcileScheduleNotifications).toHaveBeenCalledWith('family-1', [{ id: 'walk-fresh', status: 'pending' }]);
  });

  it('(B) failed schedule load: previous walks stay in the store untouched, and reconciliation is skipped entirely', async () => {
    const { reconcileScheduleNotifications } = require('../src/store/scheduleStore');
    // Simulate walks already holding a previously-loaded (now stale) value,
    // and load() failing WITHOUT touching them — exactly like the real
    // scheduleStore.load()'s catch branch (only error/loading change).
    mockScheduleWalks = [{ id: 'walk-stale', status: 'pending' }];
    mockScheduleLoad.mockImplementation(async () => {
      // deliberately does NOT reassign mockScheduleWalks — mirrors load()'s
      // failure path leaving `walks` untouched.
      return false;
    });

    await runForegroundSync();

    expect(mockScheduleWalks).toEqual([{ id: 'walk-stale', status: 'pending' }]);
    expect(reconcileScheduleNotifications).not.toHaveBeenCalled();
  });

  it('(C) failed schedule load: requests reload and presence/claim housekeeping still run (independent subsystems)', async () => {
    mockScheduleLoad.mockImplementation(async () => false);

    await runForegroundSync();

    expect(mockRequestsLoad).toHaveBeenCalledTimes(1);
    expect(mockTouchLastSeen).toHaveBeenCalledTimes(1);
    expect(mockRevalidateClaim).toHaveBeenCalledTimes(1);
  });
});

describe('Bug 2 — performColdStart() awaits restoreSession() before syncing', () => {
  it('does not call mockTrySync (or anything else in runForegroundSync) until restoreSession has resolved', async () => {
    let resolveRestore!: () => void;
    const restoreSession = jest.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveRestore = resolve;
        })
    );

    const coldStart = performColdStart(restoreSession);

    // restoreSession is in flight — nothing downstream may have run yet.
    await Promise.resolve(); // flush a microtask so a (buggy) fire-and-forget call would have fired
    expect(mockTrySync).not.toHaveBeenCalled();
    expect(mockScheduleLoad).not.toHaveBeenCalled();

    resolveRestore();
    await coldStart;

    expect(restoreSession).toHaveBeenCalledTimes(1);
    expect(mockTrySync).toHaveBeenCalledTimes(1);
  });

  it('flushes a queued write only after restoreSession has actually resolved the real profile (no skip, no drop)', async () => {
    // Simulates: cold start, currentUserId starts null; a queued op is owned
    // by "user-omar"; restoreSession resolves to user-omar; mockTrySync (called
    // from runForegroundSync, AFTER restoreSession) must then see
    // currentUserId === 'user-omar', not null.
    mockAuthState = { familyId: null as unknown as string, currentUserId: null as unknown as string };
    const restoreSession = jest.fn().mockImplementation(async () => {
      mockAuthState = { familyId: 'family-1', currentUserId: 'user-omar' };
    });

    mockTrySync.mockImplementation(async () => {
      // At the moment mockTrySync actually runs, the real profile must already
      // be restored — this is the exact ordering bug 2 fixes.
      expect(mockAuthState.currentUserId).toBe('user-omar');
    });

    await performColdStart(restoreSession);
    expect(mockTrySync).toHaveBeenCalledTimes(1);
  });
});
