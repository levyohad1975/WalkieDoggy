const ORIGINAL_ENV = process.env;

type PermKey = 'view_history' | 'view_statistics';
interface OverrideRow {
  userId: string;
  permissionKey: PermKey;
  allowed: boolean;
}

const CALLER_ID = 'noam';
const FAMILY_WALKS = [{ id: 'walk-1' }, { id: 'walk-2' }];

/**
 * BATCH 3 CORRECTION #1/#2 (review #2) — this repo has no live Postgres to
 * run migration 0027's actual RPCs against in this sandbox. The functions
 * below are a TEST-ONLY, hand-derived reimplementation of that migration's
 * SQL logic (has_member_permission() / list_history_walks() /
 * list_statistics_walks()) — not a substitute for a real integration test,
 * and NOT the production code path (the production path is
 * src/lib/permissionedWalks.ts, exercised for real below). Its shape is
 * cross-checked against migration0027.serverEnforcement.test.ts's
 * source-scan assertions in this same directory, which prove the actual
 * SQL has this exact structure (explicit per-key defaults, unknown-key
 * fail-closed, each RPC checking only its own key). This file's job is to
 * drive that documented rule through the REAL client wrappers
 * (fetchHistoryWalks/fetchStatisticsWalks) across the full permission
 * matrix the review asked for, via a mocked Supabase `rpc()` that applies
 * this simulation instead of hitting a real database.
 *
 * The complementary claim — that raw `walks` table access (what
 * scheduleStore/repository.getWalks() reads) does NOT expose historical
 * rows beyond the operational window for ANY combination of these two
 * permissions — is proven structurally, not simulated here: migration
 * 0027's `select walks in own family` policy simply does not reference
 * has_member_permission() at all (see migration0027.serverEnforcement.test.ts's
 * "does NOT reference has_member_permission" assertion), so its behavior is
 * identical regardless of what view_history/view_statistics resolve to —
 * there is no permission-dependent branch in that policy to exercise a
 * matrix against.
 */
function simulateHasMemberPermission(key: string, callerId: string | null, overrides: OverrideRow[]): boolean {
  const KNOWN_ROLE_DEFAULTS: Record<PermKey, boolean> = { view_history: true, view_statistics: true };
  if (!(key in KNOWN_ROLE_DEFAULTS)) return false; // unknown/typo'd key -> fail closed, never open
  if (!callerId) return false;
  const override = overrides.find((o) => o.userId === callerId && o.permissionKey === key);
  if (!override) return KNOWN_ROLE_DEFAULTS[key as PermKey];
  return override.allowed;
}

function simulateListHistoryWalks(callerId: string | null, overrides: OverrideRow[]) {
  if (!callerId) throw new Error('this device is not a member of a family');
  if (!simulateHasMemberPermission('view_history', callerId, overrides)) {
    throw new Error('view_history permission required');
  }
  return FAMILY_WALKS;
}

function simulateListStatisticsWalks(callerId: string | null, overrides: OverrideRow[]) {
  if (!callerId) throw new Error('this device is not a member of a family');
  if (!simulateHasMemberPermission('view_statistics', callerId, overrides)) {
    throw new Error('view_statistics permission required');
  }
  return FAMILY_WALKS;
}

function mockSupabaseClientWithSimulatedRpc(overrides: OverrideRow[]) {
  const rpc = jest.fn((fnName: string) => {
    try {
      if (fnName === 'list_history_walks') {
        return Promise.resolve({ data: simulateListHistoryWalks(CALLER_ID, overrides), error: null });
      }
      if (fnName === 'list_statistics_walks') {
        return Promise.resolve({ data: simulateListStatisticsWalks(CALLER_ID, overrides), error: null });
      }
      throw new Error(`unexpected rpc: ${fnName}`);
    } catch (e) {
      return Promise.resolve({ data: null, error: { message: e instanceof Error ? e.message : String(e) } });
    }
  });
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
  return rpc;
}

function overridesFor(viewHistory: boolean, viewStatistics: boolean): OverrideRow[] {
  return [
    { userId: CALLER_ID, permissionKey: 'view_history', allowed: viewHistory },
    { userId: CALLER_ID, permissionKey: 'view_statistics', allowed: viewStatistics },
  ];
}

/**
 * BATCH 3 CORRECTION #3 (review #2) — the five scenarios the review named
 * explicitly for has_member_permission()'s fail-closed-unknown-key
 * correction: known view_history default, known view_statistics default,
 * explicit false, explicit true, unknown key fails closed. Exercises the
 * same simulateHasMemberPermission() defined above (see this file's own
 * doc comment on why this is a labeled simulation, not a live-DB test).
 */
describe('simulateHasMemberPermission — mirrors migration 0027 has_member_permission()', () => {
  it('known key view_history, no override: role default is true', () => {
    expect(simulateHasMemberPermission('view_history', CALLER_ID, [])).toBe(true);
  });

  it('known key view_statistics, no override: role default is true', () => {
    expect(simulateHasMemberPermission('view_statistics', CALLER_ID, [])).toBe(true);
  });

  it('explicit override allowed=false wins over the role default', () => {
    const overrides = overridesFor(false, true);
    expect(simulateHasMemberPermission('view_history', CALLER_ID, overrides)).toBe(false);
  });

  it('explicit override allowed=true wins over (and matches) the role default', () => {
    const overrides: OverrideRow[] = [{ userId: CALLER_ID, permissionKey: 'view_history', allowed: true }];
    expect(simulateHasMemberPermission('view_history', CALLER_ID, overrides)).toBe(true);
  });

  it('an unknown/typo permission key fails closed regardless of any override rows present', () => {
    const overrides: OverrideRow[] = [{ userId: CALLER_ID, permissionKey: 'view_history', allowed: true }];
    expect(simulateHasMemberPermission('view_statitics', CALLER_ID, overrides)).toBe(false);
  });

  it('no active profile (callerId null) fails closed even for a known key with an otherwise-true role default', () => {
    expect(simulateHasMemberPermission('view_history', null, [])).toBe(false);
  });
});

describe('History/Statistics permission matrix — the two permissions are independent capabilities', () => {
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

  it('view_history=false + view_statistics=true: list_history_walks is denied, list_statistics_walks is allowed', async () => {
    mockSupabaseClientWithSimulatedRpc(overridesFor(false, true));
    const { fetchHistoryWalks, fetchStatisticsWalks } = require('../permissionedWalks');

    await expect(fetchHistoryWalks()).rejects.toBeTruthy();
    await expect(fetchStatisticsWalks()).resolves.toBeDefined();
  });

  it('view_history=true + view_statistics=false: list_history_walks is allowed, list_statistics_walks is denied', async () => {
    mockSupabaseClientWithSimulatedRpc(overridesFor(true, false));
    const { fetchHistoryWalks, fetchStatisticsWalks } = require('../permissionedWalks');

    await expect(fetchHistoryWalks()).resolves.toBeDefined();
    await expect(fetchStatisticsWalks()).rejects.toBeTruthy();
  });

  it('both false: neither historical RPC is allowed', async () => {
    mockSupabaseClientWithSimulatedRpc(overridesFor(false, false));
    const { fetchHistoryWalks, fetchStatisticsWalks } = require('../permissionedWalks');

    await expect(fetchHistoryWalks()).rejects.toBeTruthy();
    await expect(fetchStatisticsWalks()).rejects.toBeTruthy();
  });

  it('both true: both RPCs are allowed', async () => {
    mockSupabaseClientWithSimulatedRpc(overridesFor(true, true));
    const { fetchHistoryWalks, fetchStatisticsWalks } = require('../permissionedWalks');

    await expect(fetchHistoryWalks()).resolves.toBeDefined();
    await expect(fetchStatisticsWalks()).resolves.toBeDefined();
  });

  it('an unknown/typo permission key fails closed in the simulated helper itself (mirrors migration 0027 has_member_permission — see this file doc comment)', () => {
    expect(simulateHasMemberPermission('view_statitics', CALLER_ID, [])).toBe(false);
    expect(simulateHasMemberPermission('view_history_extra', CALLER_ID, [])).toBe(false);
    // Sanity: the two REAL keys still resolve to their documented defaults
    // with no override present, so the fail-closed branch above is
    // specifically about the unknown key, not a blanket false.
    expect(simulateHasMemberPermission('view_history', CALLER_ID, [])).toBe(true);
    expect(simulateHasMemberPermission('view_statistics', CALLER_ID, [])).toBe(true);
  });
});
