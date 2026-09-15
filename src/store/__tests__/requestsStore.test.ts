jest.mock('../../lib/requests', () => ({
  createSwapRequest: jest.fn(),
  approveSwapRequest: jest.fn(),
  rejectSwapRequest: jest.fn(),
  listSwapRequests: jest.fn(),
  createTimeChangeRequest: jest.fn(),
  approveTimeChangeRequest: jest.fn(),
  rejectTimeChangeRequest: jest.fn(),
  listTimeChangeRequests: jest.fn(),
  markMyRequestResultsSeen: jest.fn(),
}));

jest.mock('../scheduleStore', () => ({
  useScheduleStore: { getState: jest.fn(() => ({ load: jest.fn() })) },
}));

const ORIGINAL_ENV = process.env;

function setupSupabaseMode() {
  process.env = {
    ...ORIGINAL_ENV,
    EXPO_PUBLIC_SUPABASE_URL: 'https://example.supabase.co',
    EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'anon-key',
  };
}

/**
 * requestsStore is the client-side state for the migration-0005 approval
 * workflows. These tests cover: local/demo mode never pretends an approval-
 * sensitive action succeeded (requirement 16 — "server result is
 * authoritative", no offline illusion), and that a server rejection surfaces
 * through `error` rather than being swallowed.
 */
describe('requestsStore', () => {
  afterEach(() => {
    process.env = ORIGINAL_ENV;
    jest.clearAllMocks();
  });

  it('local/demo mode: createSwap surfaces a clear "not available in demo mode" error and never calls the RPC', async () => {
    jest.resetModules();
    process.env = { ...ORIGINAL_ENV };
    delete process.env.EXPO_PUBLIC_SUPABASE_URL;
    delete process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
    const { useRequestsStore } = require('../requestsStore');
    const { createSwapRequest } = require('../../lib/requests');

    await useRequestsStore.getState().createSwap('walk-1', 'walk-2');

    expect(createSwapRequest).not.toHaveBeenCalled();
    expect(useRequestsStore.getState().error).toMatch(/מצב הדגמה/);
  });

  it('local/demo mode: createTimeChange surfaces the same demo-mode error and never calls the RPC', async () => {
    jest.resetModules();
    process.env = { ...ORIGINAL_ENV };
    delete process.env.EXPO_PUBLIC_SUPABASE_URL;
    delete process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
    const { useRequestsStore } = require('../requestsStore');
    const { createTimeChangeRequest } = require('../../lib/requests');

    await useRequestsStore.getState().createTimeChange('walk-1', '19:30');

    expect(createTimeChangeRequest).not.toHaveBeenCalled();
    expect(useRequestsStore.getState().error).toMatch(/מצב הדגמה/);
  });

  it('Supabase mode: createSwap calls the RPC then reloads both lists', async () => {
    jest.resetModules();
    setupSupabaseMode();
    const { useRequestsStore } = require('../requestsStore');
    const { createSwapRequest, listSwapRequests, listTimeChangeRequests } = require('../../lib/requests');
    (createSwapRequest as jest.Mock).mockResolvedValue('req-1');
    (listSwapRequests as jest.Mock).mockResolvedValue([{ id: 'req-1', status: 'pending' }]);
    (listTimeChangeRequests as jest.Mock).mockResolvedValue([]);

    await useRequestsStore.getState().createSwap('walk-1', 'walk-2');

    expect(createSwapRequest).toHaveBeenCalledWith('walk-1', 'walk-2');
    expect(useRequestsStore.getState().swapRequests).toEqual([{ id: 'req-1', status: 'pending' }]);
    expect(useRequestsStore.getState().error).toBeNull();
  });

  it('a server rejection (e.g. approving someone else\'s swap request) surfaces via `error`, not a thrown exception the caller must catch — and (round-5, Part 2E) as a friendly HEBREW message, not the raw Postgres text', async () => {
    jest.resetModules();
    setupSupabaseMode();
    const { useRequestsStore } = require('../requestsStore');
    const { approveSwapRequest } = require('../../lib/requests');
    (approveSwapRequest as jest.Mock).mockRejectedValue(new Error('only the requested member can approve this swap'));

    await useRequestsStore.getState().approveSwap('req-1');

    expect(useRequestsStore.getState().error).toMatch(/[֐-׿]/); // contains Hebrew
    expect(useRequestsStore.getState().error).not.toMatch(/only the requested member/);
  });

  it('an UNRECOGNIZED server rejection still falls back to the existing generic Hebrew message', async () => {
    jest.resetModules();
    setupSupabaseMode();
    const { useRequestsStore } = require('../requestsStore');
    const { approveSwapRequest } = require('../../lib/requests');
    (approveSwapRequest as jest.Mock).mockRejectedValue(new Error('some brand new postgres error nobody mapped yet'));

    await useRequestsStore.getState().approveSwap('req-1');

    expect(useRequestsStore.getState().error).toBe('משהו השתבש, נסו שוב');
  });

  /**
   * ROUND-5, Part 2E: Hebrew mapping for the specific duplicate/conflict/
   * stale-request rejections called out by the spec — mirrors LoginScreen's
   * claimErrorMessage() pattern (see requestsStore.ts's messageFor()).
   */
  describe('Hebrew error mapping (Part 2E)', () => {
    const cases: Array<[string, RegExp]> = [
      ['a pending time-change request already exists for this walk', /כבר קיימת בקשת שינוי שעה ממתינה/],
      ['a pending swap request already exists for this walk', /כבר קיימת בקשת החלפה ממתינה/],
      [
        'the walk has changed since this request was created and can no longer be approved',
        /הטיול השתנה מאז שהבקשה נוצרה/,
      ],
      ['that time is already taken by another scheduled walk', /השעה המבוקשת כבר תפוסה/],
    ];

    it.each(cases)('maps %s to a matching Hebrew message', async (raw, expected) => {
      jest.resetModules();
      setupSupabaseMode();
      const { useRequestsStore } = require('../requestsStore');
      const { createTimeChangeRequest } = require('../../lib/requests');
      (createTimeChangeRequest as jest.Mock).mockRejectedValue(new Error(raw));

      await useRequestsStore.getState().createTimeChange('walk-1', '19:30');

      expect(useRequestsStore.getState().error).toMatch(expected);
    });
  });

  /**
   * ROUND-5, Part 2 (items 1-4, 15-17): requests must work for ANY eligible
   * future walk, not just the immediate next one — createSwap/
   * createTimeChange themselves accept an arbitrary walkId already (see
   * requests.ts's doc comment — this was already true before round 5), and
   * must keep working identically during Real QA Impersonation, while
   * remaining blocked during read-only Test Mode.
   */
  it('createTimeChange works for a walk far in the future (not just the next one), passing its walkId through unchanged', async () => {
    jest.resetModules();
    setupSupabaseMode();
    const { useRequestsStore } = require('../requestsStore');
    const { createTimeChangeRequest, listSwapRequests, listTimeChangeRequests } = require('../../lib/requests');
    (createTimeChangeRequest as jest.Mock).mockResolvedValue('req-later');
    (listSwapRequests as jest.Mock).mockResolvedValue([]);
    (listTimeChangeRequests as jest.Mock).mockResolvedValue([{ id: 'req-later', walk_id: 'walk-day-5', status: 'pending' }]);

    await useRequestsStore.getState().createTimeChange('walk-day-5', '18:00');

    expect(createTimeChangeRequest).toHaveBeenCalledWith('walk-day-5', '18:00');
    expect(useRequestsStore.getState().timeChangeRequests).toEqual([
      { id: 'req-later', walk_id: 'walk-day-5', status: 'pending' },
    ]);
  });

  it('createSwap works for a walk far in the future (not just the next one)', async () => {
    jest.resetModules();
    setupSupabaseMode();
    const { useRequestsStore } = require('../requestsStore');
    const { createSwapRequest, listSwapRequests, listTimeChangeRequests } = require('../../lib/requests');
    (createSwapRequest as jest.Mock).mockResolvedValue('req-later-swap');
    (listSwapRequests as jest.Mock).mockResolvedValue([{ id: 'req-later-swap', walk_id: 'walk-day-6', status: 'pending' }]);
    (listTimeChangeRequests as jest.Mock).mockResolvedValue([]);

    await useRequestsStore.getState().createSwap('walk-day-6', 'walk-user-3');

    expect(createSwapRequest).toHaveBeenCalledWith('walk-day-6', 'walk-user-3');
  });

  it('read-only Test Mode blocks both createSwap and createTimeChange (guardTestModeMutation), and never calls the RPC', async () => {
    jest.resetModules();
    setupSupabaseMode();
    const { useRequestsStore } = require('../requestsStore');
    const { useAuthStore } = require('../authStore');
    const { createSwapRequest, createTimeChangeRequest } = require('../../lib/requests');
    useAuthStore.setState({ testModeUserId: 'member-1' });

    await useRequestsStore.getState().createSwap('walk-1', 'walk-2');
    await useRequestsStore.getState().createTimeChange('walk-1', '19:30');

    expect(createSwapRequest).not.toHaveBeenCalled();
    expect(createTimeChangeRequest).not.toHaveBeenCalled();
  });

  it('Real QA Impersonation does NOT block requests (only testModeUserId does) — the RPC is still called normally', async () => {
    jest.resetModules();
    setupSupabaseMode();
    const { useRequestsStore } = require('../requestsStore');
    const { useAuthStore } = require('../authStore');
    const { createSwapRequest, listSwapRequests, listTimeChangeRequests } = require('../../lib/requests');
    (createSwapRequest as jest.Mock).mockResolvedValue('req-imp');
    (listSwapRequests as jest.Mock).mockResolvedValue([]);
    (listTimeChangeRequests as jest.Mock).mockResolvedValue([]);
    useAuthStore.setState({ impersonatingUserId: 'member-omar' });

    await useRequestsStore.getState().createSwap('walk-3-days-out', 'walk-user-4');

    expect(createSwapRequest).toHaveBeenCalledWith('walk-3-days-out', 'walk-user-4');
  });

  it('clearError resets the error field', async () => {
    jest.resetModules();
    setupSupabaseMode();
    const { useRequestsStore } = require('../requestsStore');
    useRequestsStore.setState({ error: 'something' });

    useRequestsStore.getState().clearError();

    expect(useRequestsStore.getState().error).toBeNull();
  });
});

/**
 * approveSwap / rejectSwap / approveTimeChange / rejectTimeChange /
 * markResultsSeen / load()'s own failure path — none of these were
 * previously exercised beyond the Hebrew-error-mapping cases (which only
 * ever hit createTimeChange's catch and approveSwap's catch). This also
 * covers reloadScheduleAndNotifications(), the best-effort helper that
 * refreshes scheduleStore after a swap/time-change approval mutates a walk
 * directly server-side (A3): its early-return (no familyId known yet), its
 * real call (familyId known), and its own catch (a failed reload must never
 * surface as an approval failure, since the approval itself already
 * succeeded).
 */
describe('requestsStore — approveSwap / rejectSwap / approveTimeChange / rejectTimeChange / markResultsSeen / load failure', () => {
  afterEach(() => {
    process.env = ORIGINAL_ENV;
    jest.clearAllMocks();
  });

  it('load() surfaces a server failure via `error` without wiping the last successfully loaded lists', async () => {
    jest.resetModules();
    setupSupabaseMode();
    const { useRequestsStore } = require('../requestsStore');
    const { listSwapRequests, listTimeChangeRequests } = require('../../lib/requests');
    (listSwapRequests as jest.Mock).mockRejectedValue(new Error('network down'));
    (listTimeChangeRequests as jest.Mock).mockResolvedValue([]);
    useRequestsStore.setState({ swapRequests: [{ id: 'stale', status: 'pending' }] });

    await useRequestsStore.getState().load();

    expect(useRequestsStore.getState().loading).toBe(false);
    expect(useRequestsStore.getState().error).toBe('משהו השתבש, נסו שוב');
    expect(useRequestsStore.getState().swapRequests).toEqual([{ id: 'stale', status: 'pending' }]);
  });

  it('createSwap surfaces a server RPC failure via `error`', async () => {
    jest.resetModules();
    setupSupabaseMode();
    const { useRequestsStore } = require('../requestsStore');
    const { createSwapRequest } = require('../../lib/requests');
    (createSwapRequest as jest.Mock).mockRejectedValue(new Error('some unrecognized failure'));

    await useRequestsStore.getState().createSwap('walk-1', 'walk-2');

    expect(useRequestsStore.getState().error).toBe('משהו השתבש, נסו שוב');
  });

  it('approveSwap succeeds, reloads both lists, and — when a familyId is known — reloads the schedule store too', async () => {
    jest.resetModules();
    setupSupabaseMode();
    const { useRequestsStore } = require('../requestsStore');
    const { useAuthStore } = require('../authStore');
    const { useScheduleStore } = require('../scheduleStore');
    const { approveSwapRequest, listSwapRequests, listTimeChangeRequests } = require('../../lib/requests');
    (approveSwapRequest as jest.Mock).mockResolvedValue(undefined);
    (listSwapRequests as jest.Mock).mockResolvedValue([{ id: 'req-1', status: 'approved' }]);
    (listTimeChangeRequests as jest.Mock).mockResolvedValue([]);
    const scheduleLoad = jest.fn().mockResolvedValue(true);
    (useScheduleStore.getState as jest.Mock).mockReturnValue({ load: scheduleLoad });
    useAuthStore.setState({ familyId: 'family-1' });

    await useRequestsStore.getState().approveSwap('req-1');

    expect(approveSwapRequest).toHaveBeenCalledWith('req-1');
    expect(useRequestsStore.getState().swapRequests).toEqual([{ id: 'req-1', status: 'approved' }]);
    expect(useRequestsStore.getState().error).toBeNull();
    expect(scheduleLoad).toHaveBeenCalledWith('family-1');
  });

  it('approveSwap never reloads the schedule store when no familyId is known yet (reloadScheduleAndNotifications early-return)', async () => {
    jest.resetModules();
    setupSupabaseMode();
    const { useRequestsStore } = require('../requestsStore');
    const { useAuthStore } = require('../authStore');
    const { useScheduleStore } = require('../scheduleStore');
    const { approveSwapRequest, listSwapRequests, listTimeChangeRequests } = require('../../lib/requests');
    (approveSwapRequest as jest.Mock).mockResolvedValue(undefined);
    (listSwapRequests as jest.Mock).mockResolvedValue([]);
    (listTimeChangeRequests as jest.Mock).mockResolvedValue([]);
    const scheduleLoad = jest.fn();
    (useScheduleStore.getState as jest.Mock).mockReturnValue({ load: scheduleLoad });
    useAuthStore.setState({ familyId: null });

    await useRequestsStore.getState().approveSwap('req-1');

    expect(scheduleLoad).not.toHaveBeenCalled();
    expect(useRequestsStore.getState().error).toBeNull();
  });

  it('a failed schedule-store reload after approveSwap is swallowed (best-effort) and never surfaces as an approval failure', async () => {
    jest.resetModules();
    setupSupabaseMode();
    const { useRequestsStore } = require('../requestsStore');
    const { useAuthStore } = require('../authStore');
    const { useScheduleStore } = require('../scheduleStore');
    const { approveSwapRequest, listSwapRequests, listTimeChangeRequests } = require('../../lib/requests');
    (approveSwapRequest as jest.Mock).mockResolvedValue(undefined);
    (listSwapRequests as jest.Mock).mockResolvedValue([]);
    (listTimeChangeRequests as jest.Mock).mockResolvedValue([]);
    const scheduleLoad = jest.fn().mockRejectedValue(new Error('schedule reload blew up'));
    (useScheduleStore.getState as jest.Mock).mockReturnValue({ load: scheduleLoad });
    useAuthStore.setState({ familyId: 'family-1' });

    await useRequestsStore.getState().approveSwap('req-1');

    expect(scheduleLoad).toHaveBeenCalledWith('family-1');
    expect(useRequestsStore.getState().error).toBeNull();
  });

  it('rejectSwap succeeds and reloads both lists', async () => {
    jest.resetModules();
    setupSupabaseMode();
    const { useRequestsStore } = require('../requestsStore');
    const { rejectSwapRequest, listSwapRequests, listTimeChangeRequests } = require('../../lib/requests');
    (rejectSwapRequest as jest.Mock).mockResolvedValue(undefined);
    (listSwapRequests as jest.Mock).mockResolvedValue([{ id: 'req-1', status: 'rejected' }]);
    (listTimeChangeRequests as jest.Mock).mockResolvedValue([]);

    await useRequestsStore.getState().rejectSwap('req-1');

    expect(rejectSwapRequest).toHaveBeenCalledWith('req-1');
    expect(useRequestsStore.getState().swapRequests).toEqual([{ id: 'req-1', status: 'rejected' }]);
    expect(useRequestsStore.getState().error).toBeNull();
  });

  it('rejectSwap surfaces a server rejection via `error`', async () => {
    jest.resetModules();
    setupSupabaseMode();
    const { useRequestsStore } = require('../requestsStore');
    const { rejectSwapRequest } = require('../../lib/requests');
    (rejectSwapRequest as jest.Mock).mockRejectedValue(new Error('cannot reject an already-approved request'));

    await useRequestsStore.getState().rejectSwap('req-1');

    expect(useRequestsStore.getState().error).toBe('משהו השתבש, נסו שוב');
  });

  it('approveTimeChange succeeds, reloads both lists, and reloads the schedule store', async () => {
    jest.resetModules();
    setupSupabaseMode();
    const { useRequestsStore } = require('../requestsStore');
    const { useAuthStore } = require('../authStore');
    const { useScheduleStore } = require('../scheduleStore');
    const { approveTimeChangeRequest, listSwapRequests, listTimeChangeRequests } = require('../../lib/requests');
    (approveTimeChangeRequest as jest.Mock).mockResolvedValue(undefined);
    (listSwapRequests as jest.Mock).mockResolvedValue([]);
    (listTimeChangeRequests as jest.Mock).mockResolvedValue([{ id: 'tc-1', status: 'approved' }]);
    const scheduleLoad = jest.fn().mockResolvedValue(true);
    (useScheduleStore.getState as jest.Mock).mockReturnValue({ load: scheduleLoad });
    useAuthStore.setState({ familyId: 'family-1' });

    await useRequestsStore.getState().approveTimeChange('tc-1');

    expect(approveTimeChangeRequest).toHaveBeenCalledWith('tc-1');
    expect(useRequestsStore.getState().timeChangeRequests).toEqual([{ id: 'tc-1', status: 'approved' }]);
    expect(scheduleLoad).toHaveBeenCalledWith('family-1');
  });

  it('approveTimeChange surfaces a server rejection via `error`', async () => {
    jest.resetModules();
    setupSupabaseMode();
    const { useRequestsStore } = require('../requestsStore');
    const { approveTimeChangeRequest } = require('../../lib/requests');
    (approveTimeChangeRequest as jest.Mock).mockRejectedValue(new Error('some brand new failure'));

    await useRequestsStore.getState().approveTimeChange('tc-1');

    expect(useRequestsStore.getState().error).toBe('משהו השתבש, נסו שוב');
  });

  it('rejectTimeChange succeeds and reloads both lists', async () => {
    jest.resetModules();
    setupSupabaseMode();
    const { useRequestsStore } = require('../requestsStore');
    const { rejectTimeChangeRequest, listSwapRequests, listTimeChangeRequests } = require('../../lib/requests');
    (rejectTimeChangeRequest as jest.Mock).mockResolvedValue(undefined);
    (listSwapRequests as jest.Mock).mockResolvedValue([]);
    (listTimeChangeRequests as jest.Mock).mockResolvedValue([{ id: 'tc-1', status: 'rejected' }]);

    await useRequestsStore.getState().rejectTimeChange('tc-1');

    expect(rejectTimeChangeRequest).toHaveBeenCalledWith('tc-1');
    expect(useRequestsStore.getState().timeChangeRequests).toEqual([{ id: 'tc-1', status: 'rejected' }]);
  });

  it('rejectTimeChange surfaces a server rejection via `error`', async () => {
    jest.resetModules();
    setupSupabaseMode();
    const { useRequestsStore } = require('../requestsStore');
    const { rejectTimeChangeRequest } = require('../../lib/requests');
    (rejectTimeChangeRequest as jest.Mock).mockRejectedValue(new Error('cannot reject'));

    await useRequestsStore.getState().rejectTimeChange('tc-1');

    expect(useRequestsStore.getState().error).toBe('משהו השתבש, נסו שוב');
  });

  it('markResultsSeen is a no-op in local/demo mode (never calls the RPC)', async () => {
    jest.resetModules();
    process.env = { ...ORIGINAL_ENV };
    delete process.env.EXPO_PUBLIC_SUPABASE_URL;
    delete process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
    const { useRequestsStore } = require('../requestsStore');
    const { markMyRequestResultsSeen } = require('../../lib/requests');

    await useRequestsStore.getState().markResultsSeen();

    expect(markMyRequestResultsSeen).not.toHaveBeenCalled();
  });

  it('markResultsSeen calls the RPC then reloads both lists', async () => {
    jest.resetModules();
    setupSupabaseMode();
    const { useRequestsStore } = require('../requestsStore');
    const { markMyRequestResultsSeen, listSwapRequests, listTimeChangeRequests } = require('../../lib/requests');
    (markMyRequestResultsSeen as jest.Mock).mockResolvedValue(undefined);
    (listSwapRequests as jest.Mock).mockResolvedValue([{ id: 'req-1', status: 'approved', resultSeen: true }]);
    (listTimeChangeRequests as jest.Mock).mockResolvedValue([]);

    await useRequestsStore.getState().markResultsSeen();

    expect(markMyRequestResultsSeen).toHaveBeenCalled();
    expect(useRequestsStore.getState().swapRequests).toEqual([
      { id: 'req-1', status: 'approved', resultSeen: true },
    ]);
  });

  it('markResultsSeen surfaces a server failure via `error`', async () => {
    jest.resetModules();
    setupSupabaseMode();
    const { useRequestsStore } = require('../requestsStore');
    const { markMyRequestResultsSeen } = require('../../lib/requests');
    (markMyRequestResultsSeen as jest.Mock).mockRejectedValue(new Error('boom'));

    await useRequestsStore.getState().markResultsSeen();

    expect(useRequestsStore.getState().error).toBe('משהו השתבש, נסו שוב');
  });

  it('load() is a no-op in local/demo mode (never calls the RPC)', async () => {
    jest.resetModules();
    process.env = { ...ORIGINAL_ENV };
    delete process.env.EXPO_PUBLIC_SUPABASE_URL;
    delete process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
    const { useRequestsStore } = require('../requestsStore');
    const { listSwapRequests, listTimeChangeRequests } = require('../../lib/requests');

    await useRequestsStore.getState().load();

    expect(listSwapRequests).not.toHaveBeenCalled();
    expect(listTimeChangeRequests).not.toHaveBeenCalled();
    expect(useRequestsStore.getState().loading).toBe(false);
  });

  it("load()'s failure is never logged to the console in a production build", async () => {
    jest.resetModules();
    setupSupabaseMode();
    process.env.NODE_ENV = 'production';
    const { useRequestsStore } = require('../requestsStore');
    const { listSwapRequests, listTimeChangeRequests } = require('../../lib/requests');
    (listSwapRequests as jest.Mock).mockRejectedValue(new Error('network down'));
    (listTimeChangeRequests as jest.Mock).mockResolvedValue([]);
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {});

    await useRequestsStore.getState().load();

    expect(spy).not.toHaveBeenCalled();
    expect(useRequestsStore.getState().error).toBe('משהו השתבש, נסו שוב');
    spy.mockRestore();
  });

  it('read-only Test Mode also blocks approveSwap, rejectSwap, approveTimeChange, rejectTimeChange, and markResultsSeen', async () => {
    jest.resetModules();
    setupSupabaseMode();
    const { useRequestsStore } = require('../requestsStore');
    const { useAuthStore } = require('../authStore');
    const {
      approveSwapRequest,
      rejectSwapRequest,
      approveTimeChangeRequest,
      rejectTimeChangeRequest,
      markMyRequestResultsSeen,
    } = require('../../lib/requests');
    useAuthStore.setState({ testModeUserId: 'member-1' });

    await useRequestsStore.getState().approveSwap('req-1');
    await useRequestsStore.getState().rejectSwap('req-1');
    await useRequestsStore.getState().approveTimeChange('tc-1');
    await useRequestsStore.getState().rejectTimeChange('tc-1');
    await useRequestsStore.getState().markResultsSeen();

    expect(approveSwapRequest).not.toHaveBeenCalled();
    expect(rejectSwapRequest).not.toHaveBeenCalled();
    expect(approveTimeChangeRequest).not.toHaveBeenCalled();
    expect(rejectTimeChangeRequest).not.toHaveBeenCalled();
    expect(markMyRequestResultsSeen).not.toHaveBeenCalled();
  });
});
