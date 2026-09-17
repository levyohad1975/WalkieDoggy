import type { Walk, ScheduleEntry } from '../../types';

/**
 * scheduleNotificationsForWalk()'s real local-scheduling happy path (no
 * active remote push channel, a reminders-enabled responsible user, and a
 * loaded family dog) had zero coverage: every other scheduleStore test
 * either short-circuits it via an active remote channel (see
 * reconcileScheduleNotifications.channelGate.test.ts) or never populates
 * familyStore's users/dog, so scheduleNotificationsForWalk's own
 * `!user || !user.remindersEnabled || !dog` guard always returned early
 * before reaching the actual repository.getNotificationSettings() /
 * scheduleWalkNotifications() call. rescheduleWalk() (local/demo mode) is
 * used as the vehicle here since it calls scheduleNotificationsForWalk()
 * directly on success.
 */
describe('scheduleNotificationsForWalk — local-scheduling happy path (via rescheduleWalk, local/demo mode)', () => {
  const WALK: Walk = {
    id: 'walk-1',
    familyId: 'family-1',
    scheduleEntryId: 'entry-1',
    dogId: 'dog-1',
    date: '2026-09-11',
    scheduledTime: '09:00',
    responsibleUserId: 'user-aba',
    status: 'pending',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  const ENTRY: ScheduleEntry = {
    id: 'entry-1',
    familyId: 'family-1',
    ruleId: 'rule-1',
    dogId: 'dog-1',
    date: '2026-09-11',
    time: '09:00',
    responsibleUserId: 'user-aba',
    createdAt: new Date().toISOString(),
  };

  let getNotificationSettings: jest.Mock;
  let scheduleWalkNotifications: jest.Mock;
  let useScheduleStore: typeof import('../scheduleStore').useScheduleStore;

  beforeEach(() => {
    jest.resetModules();

    getNotificationSettings = jest.fn().mockResolvedValue([
      { userId: 'user-aba', minutesBefore: 15, overdueMinutesAfter: 30, enabled: true },
    ]);
    scheduleWalkNotifications = jest.fn().mockResolvedValue(undefined);

    jest.doMock('../../data', () => ({
      repository: {
        saveWalk: jest.fn().mockResolvedValue(undefined),
        updateScheduleEntry: jest.fn().mockResolvedValue(undefined),
        getNotificationSettings,
      },
    }));
    jest.doMock('../../lib/supabase', () => ({ isSupabaseConfigured: false }));
    jest.doMock('../../lib/testModeGuard', () => ({ guardTestModeMutation: () => true }));
    jest.doMock('../../lib/remoteReminderChannel', () => ({
      hasActiveRemoteReminderChannel: jest.fn().mockResolvedValue(false),
    }));
    jest.doMock('../../notifications/notificationService', () => ({
      cancelWalkNotifications: jest.fn().mockResolvedValue(undefined),
      reconcileWalkNotifications: jest.fn().mockResolvedValue(undefined),
      scheduleWalkNotifications,
    }));

    const { useFamilyStore } = require('../familyStore');
    useFamilyStore.setState({
      dog: { id: 'dog-1', familyId: 'family-1', name: 'טופי', walksPerDay: 4 },
      users: [{ id: 'user-aba', familyId: 'family-1', name: 'אבא', avatar: '🧔', color: '#000', remindersEnabled: true, createdAt: new Date().toISOString() }],
    });

    ({ useScheduleStore } = require('../scheduleStore'));
    useScheduleStore.setState({ walks: [WALK], entries: [ENTRY], actionError: null });
  });

  it('looks up this family\'s notification settings and schedules the walk reminder for its reminders-enabled responsible user', async () => {
    await useScheduleStore.getState().rescheduleWalk('walk-1', '19:30');

    expect(getNotificationSettings).toHaveBeenCalledWith('family-1');
    expect(scheduleWalkNotifications).toHaveBeenCalledTimes(1);
    expect(scheduleWalkNotifications).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'walk-1', scheduledTime: '19:30' }),
      expect.objectContaining({ userId: 'user-aba', enabled: true }),
      'אבא',
      'טופי',
      undefined
    );
  });

  it('never schedules when this family has no notification setting for the responsible user', async () => {
    getNotificationSettings.mockResolvedValue([]);

    await useScheduleStore.getState().rescheduleWalk('walk-1', '19:30');

    expect(scheduleWalkNotifications).not.toHaveBeenCalled();
  });
});
