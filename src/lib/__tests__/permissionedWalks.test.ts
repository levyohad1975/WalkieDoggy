const ORIGINAL_ENV = process.env;

function mockSupabaseClient(rpc: jest.Mock) {
  jest.doMock('@supabase/supabase-js', () => ({
    createClient: jest.fn(() => ({
      auth: {
        getSession: jest.fn().mockResolvedValue({ data: { session: null } }),
        signInAnonymously: jest.fn().mockResolvedValue({ error: null }),
      },
      rpc,
      from: jest.fn(),
      storage: { from: jest.fn() },
    })),
  }));
}

const HISTORY_ROW = {
  id: 'walk-1',
  family_id: 'family-1',
  schedule_entry_id: 'entry-1',
  dog_id: 'dog-1',
  date: '2026-09-11',
  scheduled_time: '09:00',
  responsible_user_id: 'noam',
  status: 'done',
  completed_at: '2026-09-11T09:15:00.000Z',
  completed_by_user_id: 'noam',
  had_pee: true,
  had_poop: false,
  note: null,
  duration_minutes: 20,
  is_unplanned: false,
  swap_original_user_id: null,
  swap_new_user_id: null,
  swap_swapped_at: null,
  swap_swapped_by_user_id: null,
  created_at: '2026-09-11T09:00:00.000Z',
  updated_at: '2026-09-11T09:15:00.000Z',
};

/**
 * BATCH 3 CORRECTION #1 (post-review) — client-side (call-shape / error-
 * propagation / row-mapping) tests for the list_history_walks()/
 * list_statistics_walks() RPC wrappers (migration 0027), mirroring
 * lib/__tests__/walkAdmin.test.ts's approach exactly. The actual server-
 * side permission check (has_member_permission()) lives in the RPCs
 * themselves and can only be verified against a real Supabase project —
 * not from this Jest sandbox; this file only proves the client asks for
 * the right thing and does not swallow a denial.
 */
describe('lib/permissionedWalks — fetchHistoryWalks / fetchStatisticsWalks (Supabase mode)', () => {
  beforeEach(() => {
    jest.resetModules();
    process.env = {
      ...ORIGINAL_ENV,
      EXPO_PUBLIC_SUPABASE_URL: 'https://example.supabase.co',
      EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'anon-key',
    };
  });

  afterEach(() => {
    process.env = ORIGINAL_ENV;
  });

  it('fetchHistoryWalks calls list_history_walks with no arguments and maps rows through the same snake_case -> camelCase mapping as every other walks read', async () => {
    const rpc = jest.fn().mockResolvedValue({ data: [HISTORY_ROW], error: null });
    mockSupabaseClient(rpc);
    const { fetchHistoryWalks } = require('../permissionedWalks');

    const result = await fetchHistoryWalks();

    expect(rpc).toHaveBeenCalledWith('list_history_walks');
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(result).toEqual([
      expect.objectContaining({
        id: 'walk-1',
        familyId: 'family-1',
        scheduleEntryId: 'entry-1',
        scheduledTime: '09:00',
        status: 'done',
        hadPee: true,
        hadPoop: false,
      }),
    ]);
  });

  it('fetchHistoryWalks surfaces "view_history permission required" (a genuine server-side denial) rather than swallowing it or returning an empty array', async () => {
    const rpc = jest.fn().mockResolvedValue({ data: null, error: { message: 'view_history permission required' } });
    mockSupabaseClient(rpc);
    const { fetchHistoryWalks } = require('../permissionedWalks');

    await expect(fetchHistoryWalks()).rejects.toBeTruthy();
  });

  it('fetchStatisticsWalks calls list_statistics_walks with no arguments', async () => {
    const rpc = jest.fn().mockResolvedValue({ data: [], error: null });
    mockSupabaseClient(rpc);
    const { fetchStatisticsWalks } = require('../permissionedWalks');

    await expect(fetchStatisticsWalks()).resolves.toEqual([]);
    expect(rpc).toHaveBeenCalledWith('list_statistics_walks');
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it('fetchStatisticsWalks surfaces "view_statistics permission required" rather than swallowing it', async () => {
    const rpc = jest.fn().mockResolvedValue({ data: null, error: { message: 'view_statistics permission required' } });
    mockSupabaseClient(rpc);
    const { fetchStatisticsWalks } = require('../permissionedWalks');

    await expect(fetchStatisticsWalks()).rejects.toBeTruthy();
  });

  it('local/demo mode (no Supabase configured): both throw SupabaseNotConfiguredError rather than pretending to succeed', async () => {
    jest.resetModules();
    process.env = { ...ORIGINAL_ENV };
    delete process.env.EXPO_PUBLIC_SUPABASE_URL;
    delete process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
    const { fetchHistoryWalks, fetchStatisticsWalks } = require('../permissionedWalks');
    const { SupabaseNotConfiguredError } = require('../supabase');

    await expect(fetchHistoryWalks()).rejects.toBeInstanceOf(SupabaseNotConfiguredError);
    await expect(fetchStatisticsWalks()).rejects.toBeInstanceOf(SupabaseNotConfiguredError);
  });

  /**
   * BATCH 3 FINAL REVIEW CORRECTION — fetchLastResolvedWalk() (thin wrapper
   * over get_last_resolved_walk(), migration 0027). Unlike fetchHistoryWalks/
   * fetchStatisticsWalks above, this RPC is never permission-denied (every
   * authenticated family member may call it) — it resolves `null` for
   * "genuinely no resolved walk yet" (zero rows) rather than rejecting, and
   * only rejects for a real transport/auth error.
   */
  it('fetchLastResolvedWalk calls get_last_resolved_walk with no arguments and maps the single returned row', async () => {
    const rpc = jest.fn().mockResolvedValue({ data: [HISTORY_ROW], error: null });
    mockSupabaseClient(rpc);
    const { fetchLastResolvedWalk } = require('../permissionedWalks');

    const result = await fetchLastResolvedWalk();

    expect(rpc).toHaveBeenCalledWith('get_last_resolved_walk');
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(result).toEqual(expect.objectContaining({ id: 'walk-1', familyId: 'family-1', status: 'done' }));
  });

  it('fetchLastResolvedWalk resolves null (not an error) when the family has no resolved walk yet — zero rows is a genuine, non-error outcome', async () => {
    const rpc = jest.fn().mockResolvedValue({ data: [], error: null });
    mockSupabaseClient(rpc);
    const { fetchLastResolvedWalk } = require('../permissionedWalks');

    await expect(fetchLastResolvedWalk()).resolves.toBeNull();
  });

  it('fetchLastResolvedWalk still surfaces a genuine transport/auth error rather than swallowing it as null', async () => {
    const rpc = jest.fn().mockResolvedValue({ data: null, error: { message: 'JWT expired' } });
    mockSupabaseClient(rpc);
    const { fetchLastResolvedWalk } = require('../permissionedWalks');

    await expect(fetchLastResolvedWalk()).rejects.toBeTruthy();
  });

  it('local/demo mode: fetchLastResolvedWalk also throws SupabaseNotConfiguredError rather than pretending to succeed', async () => {
    jest.resetModules();
    process.env = { ...ORIGINAL_ENV };
    delete process.env.EXPO_PUBLIC_SUPABASE_URL;
    delete process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
    const { fetchLastResolvedWalk } = require('../permissionedWalks');
    const { SupabaseNotConfiguredError } = require('../supabase');

    await expect(fetchLastResolvedWalk()).rejects.toBeInstanceOf(SupabaseNotConfiguredError);
  });
});
