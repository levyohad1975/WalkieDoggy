jest.mock('../../lib/requests', () => ({
  createSwapRequest: jest.fn(),
  approveSwapRequest: jest.fn(),
  rejectSwapRequest: jest.fn(),
  listSwapRequests: jest.fn(),
  createTimeChangeRequest: jest.fn(),
  approveTimeChangeRequest: jest.fn(),
  rejectTimeChangeRequest: jest.fn(),
  listTimeChangeRequests: jest.fn(),
}));

const ORIGINAL_ENV = process.env;

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

  function setupSupabaseMode() {
    process.env = {
      ...ORIGINAL_ENV,
      EXPO_PUBLIC_SUPABASE_URL: 'https://example.supabase.co',
      EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'anon-key',
    };
  }

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
