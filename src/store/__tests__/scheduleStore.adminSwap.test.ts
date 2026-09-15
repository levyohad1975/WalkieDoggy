import type { Walk, ScheduleEntry } from '../../types';

/**
 * swapTwoWalks() in Supabase mode had zero coverage for its
 * admin_swap_walks (0031) RPC branch — every other swapTwoWalks test runs
 * in local/demo mode. Mirrors scheduleStore.adminReschedule.test.ts's
 * isSupabaseConfigured-mocking approach: the RPC is the sole authoritative
 * server write, exchanging both walk owners and their linked schedule
 * entries in one transaction, so no raw repository.saveWalk()/
 * updateScheduleEntry() call should follow it.
 */
const WALK_A: Walk = {
  id: 'walk-a',
  familyId: 'family-1',
  scheduleEntryId: 'entry-a',
  dogId: 'dog-1',
  date: '2026-09-11',
  scheduledTime: '09:00',
  responsibleUserId: 'noam',
  status: 'pending',
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

const WALK_B: Walk = {
  id: 'walk-b',
  familyId: 'family-1',
  scheduleEntryId: 'entry-b',
  dogId: 'dog-1',
  date: '2026-09-11',
  scheduledTime: '18:00',
  responsibleUserId: 'dana',
  status: 'pending',
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

const ENTRY_A: ScheduleEntry = {
  id: 'entry-a',
  familyId: 'family-1',
  ruleId: 'rule-1',
  dogId: 'dog-1',
  date: '2026-09-11',
  time: '09:00',
  responsibleUserId: 'noam',
  createdAt: new Date().toISOString(),
};

const ENTRY_B: ScheduleEntry = {
  id: 'entry-b',
  familyId: 'family-1',
  ruleId: 'rule-2',
  dogId: 'dog-1',
  date: '2026-09-11',
  time: '18:00',
  responsibleUserId: 'dana',
  createdAt: new Date().toISOString(),
};

function mockNotificationCollaborators() {
  // Short-circuits scheduleNotificationsForWalk straight to
  // cancelWalkNotifications so this file doesn't also need to stand up
  // familyStore/notification settings — irrelevant to what it verifies.
  jest.doMock('../../lib/remoteReminderChannel', () => ({ hasActiveRemoteReminderChannel: jest.fn().mockResolvedValue(true) }));
  jest.doMock('../../notifications/notificationService', () => ({
    cancelWalkNotifications: jest.fn().mockResolvedValue(undefined),
    reconcileWalkNotifications: jest.fn().mockResolvedValue(undefined),
    scheduleWalkNotifications: jest.fn().mockResolvedValue(undefined),
  }));
}

describe('scheduleStore.swapTwoWalks — Supabase mode: admin_swap_walks is the sole server mutation', () => {
  let saveWalk: jest.Mock;
  let updateScheduleEntry: jest.Mock;
  let adminSwapWalks: jest.Mock;
  let useScheduleStore: typeof import('../scheduleStore').useScheduleStore;

  beforeEach(() => {
    jest.resetModules();

    saveWalk = jest.fn().mockResolvedValue(undefined);
    updateScheduleEntry = jest.fn().mockResolvedValue(undefined);
    adminSwapWalks = jest.fn().mockResolvedValue(undefined);

    jest.doMock('../../data', () => ({
      repository: { saveWalk, updateScheduleEntry },
    }));
    jest.doMock('../../lib/supabase', () => ({ isSupabaseConfigured: true }));
    jest.doMock('../../lib/walkAdmin', () => ({ adminSwapWalks }));
    jest.doMock('../../lib/testModeGuard', () => ({ guardTestModeMutation: () => true }));
    mockNotificationCollaborators();

    ({ useScheduleStore } = require('../scheduleStore'));
    useScheduleStore.setState({ walks: [WALK_A, WALK_B], entries: [ENTRY_A, ENTRY_B], actionError: null });
  });

  it('calls admin_swap_walks exactly once and does NOT subsequently call repository.saveWalk/updateScheduleEntry (no duplicate raw mutation)', async () => {
    await useScheduleStore.getState().swapTwoWalks('walk-a', 'walk-b', 'noam');

    expect(adminSwapWalks).toHaveBeenCalledTimes(1);
    expect(adminSwapWalks).toHaveBeenCalledWith('walk-a', 'walk-b');
    expect(saveWalk).not.toHaveBeenCalled();
    expect(updateScheduleEntry).not.toHaveBeenCalled();
  });

  it('a successful RPC still swaps the responsible users in local state (walks AND linked schedule entries)', async () => {
    await useScheduleStore.getState().swapTwoWalks('walk-a', 'walk-b', 'noam');

    const state = useScheduleStore.getState();
    expect(state.walks.find((w) => w.id === 'walk-a')?.responsibleUserId).toBe('dana');
    expect(state.walks.find((w) => w.id === 'walk-b')?.responsibleUserId).toBe('noam');
    expect(state.entries.find((e) => e.id === 'entry-a')?.responsibleUserId).toBe('dana');
    expect(state.entries.find((e) => e.id === 'entry-b')?.responsibleUserId).toBe('noam');
    expect(state.actionError).toBeNull();
  });

  it('a server-side rejection surfaces as actionError and never touches local state (no optimistic swap)', async () => {
    adminSwapWalks.mockRejectedValue(new Error('admin permission required'));

    await useScheduleStore.getState().swapTwoWalks('walk-a', 'walk-b', 'noam');

    expect(saveWalk).not.toHaveBeenCalled();
    expect(updateScheduleEntry).not.toHaveBeenCalled();
    const state = useScheduleStore.getState();
    expect(state.walks.find((w) => w.id === 'walk-a')?.responsibleUserId).toBe('noam');
    expect(state.walks.find((w) => w.id === 'walk-b')?.responsibleUserId).toBe('dana');
    expect(state.actionError).toBe('רק מנהל/ת יכולים לבצע פעולה זו.');
  });
});
