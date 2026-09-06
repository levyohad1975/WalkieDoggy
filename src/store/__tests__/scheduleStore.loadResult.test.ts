/**
 * Round-6 fix #2 regression tests: scheduleStore.load() must resolve a
 * boolean signaling success/failure (true = fresh authoritative data
 * loaded, false = failed) WITHOUT breaking the existing screen-level
 * contract — never rejects, sets the friendly `error` field on failure, and
 * never clears `walks`/`entries`/`rules` on a failed reload (the previously
 * displayed schedule must stay visible).
 *
 * Uses a mocked repository so the failure path is deterministic.
 */

// IMPORTANT: the mocked repository object is defined ENTIRELY INSIDE the
// jest.mock() factory below, not as a separate outer `const` that the
// factory closes over. jest.mock() calls are hoisted by
// babel-plugin-jest-hoist, and while a variable prefixed with `mock` is
// permitted by the hoist plugin's static check, that only guards against a
// *build-time* error — it does not, by itself, guarantee that an
// out-of-scope `const` has actually finished initializing by the time the
// mocked module is first required (which, depending on transform/hoist
// ordering, can happen before that `const`'s own initializer runs, silently
// yielding `repository: undefined` for the lifetime of the mocked module).
// Defining the mock object as a literal directly inside the factory avoids
// that class of bug entirely — there is no outer variable for the factory
// to reference at all. The mock is then retrieved via `require(...)` further
// down (a plain runtime call, executed at its own textual position, strictly
// after the mock has been registered), so `mockRepository` below is always
// the actual mocked object, never undefined.
jest.mock('../../data', () => ({
  repository: {
    getScheduleRules: jest.fn(),
    getScheduleEntries: jest.fn(),
    getWalks: jest.fn(),
    getNotificationSettings: jest.fn().mockResolvedValue([]),
    addScheduleEntries: jest.fn().mockResolvedValue(undefined),
    saveWalk: jest.fn().mockResolvedValue(undefined),
  },
}));

// Notification reconciliation is irrelevant to this file's assertions and
// touches modules (expo-notifications) that need their own setup elsewhere.
jest.mock('../../notifications/notificationService', () => ({
  cancelWalkNotifications: jest.fn().mockResolvedValue(undefined),
  reconcileWalkNotifications: jest.fn().mockResolvedValue(undefined),
  scheduleWalkNotifications: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../familyStore', () => ({
  useFamilyStore: { getState: () => ({ users: [], dog: null }) },
}));

jest.mock('../../lib/testModeGuard', () => ({ guardTestModeMutation: () => true }));

import { useScheduleStore } from '../scheduleStore';

type MockRepository = {
  getScheduleRules: jest.Mock;
  getScheduleEntries: jest.Mock;
  getWalks: jest.Mock;
  getNotificationSettings: jest.Mock;
  addScheduleEntries: jest.Mock;
  saveWalk: jest.Mock;
};

// Pulled out via a plain require() (not a hoisted outer const the factory
// above closes over) so this is guaranteed to be the same object the mocked
// '../../data' module actually exports — see the comment on jest.mock above.
const { repository: mockRepository } = require('../../data') as { repository: MockRepository };

const FAMILY_ID = 'family-main';

describe('scheduleStore.load() success/failure signal', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRepository.getNotificationSettings.mockResolvedValue([]);
    useScheduleStore.setState({ rules: [], entries: [], walks: [], loading: false, error: null, actionError: null });
  });

  it('resolves true and sets fresh rules/entries/walks on success', async () => {
    mockRepository.getScheduleRules.mockResolvedValue([]);
    mockRepository.getScheduleEntries.mockResolvedValue([]);
    mockRepository.getWalks.mockResolvedValue([{ id: 'walk-fresh', familyId: FAMILY_ID, status: 'pending' }]);

    const result = await useScheduleStore.getState().load(FAMILY_ID);

    expect(result).toBe(true);
    expect(useScheduleStore.getState().error).toBeNull();
    expect(useScheduleStore.getState().walks).toEqual([{ id: 'walk-fresh', familyId: FAMILY_ID, status: 'pending' }]);
  });

  it('resolves false, sets the friendly error, and never rejects, on a repository failure', async () => {
    mockRepository.getScheduleRules.mockRejectedValue(new Error('network down'));
    mockRepository.getScheduleEntries.mockResolvedValue([]);
    mockRepository.getWalks.mockResolvedValue([]);

    await expect(useScheduleStore.getState().load(FAMILY_ID)).resolves.toBe(false);
    expect(useScheduleStore.getState().error).toBe('network down');
    expect(useScheduleStore.getState().loading).toBe(false);
  });

  it('preserves the previously displayed walks/entries/rules untouched when a reload fails (does not clear the schedule)', async () => {
    // Seed the store as if a previous successful load already populated it.
    const previousWalks = [{ id: 'walk-old', familyId: FAMILY_ID, status: 'pending' }] as any;
    useScheduleStore.setState({ walks: previousWalks, entries: [{ id: 'entry-old' }] as any, rules: [{ id: 'rule-old' }] as any });

    mockRepository.getScheduleRules.mockRejectedValue(new Error('boom'));
    mockRepository.getScheduleEntries.mockResolvedValue([]);
    mockRepository.getWalks.mockResolvedValue([]);

    const result = await useScheduleStore.getState().load(FAMILY_ID);

    expect(result).toBe(false);
    const state = useScheduleStore.getState();
    expect(state.walks).toBe(previousWalks); // exact same reference — untouched
    expect(state.entries).toEqual([{ id: 'entry-old' }]);
    expect(state.rules).toEqual([{ id: 'rule-old' }]);
    expect(state.error).toBe('boom');
  });

  it('regression: an existing screen-level caller (e.g. a mount-effect reload) can still just `await load()` and read `error` afterward, with no unhandled rejection', async () => {
    mockRepository.getScheduleRules.mockRejectedValue(new Error('network down'));
    mockRepository.getScheduleEntries.mockResolvedValue([]);
    mockRepository.getWalks.mockResolvedValue([]);

    // Mirrors how RootNavigator / a screen mount effect calls it today —
    // fire-and-forget or awaited, ignoring the resolved value entirely.
    await useScheduleStore.getState().load(FAMILY_ID);

    expect(useScheduleStore.getState().error).toBe('network down');
    // No throw reached this point — proves load() never rejects even though
    // the underlying repository call did.
  });
});
