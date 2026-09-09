import type { Walk } from '../../types';

/**
 * Batch 2 / Decision 4: reconcileScheduleNotifications() must never schedule
 * a LOCAL walk reminder for a profile that already has an active REMOTE
 * push channel — the server-side scheduler is authoritative for that
 * profile, and scheduling both would violate "the same logical reminder
 * must not appear twice". See src/lib/remoteReminderChannel.ts.
 */
describe('reconcileScheduleNotifications — native-local vs server-push channel gate', () => {
  const walks: Walk[] = [
    {
      id: 'walk-1',
      familyId: 'family-main',
      dogId: 'dog-topi',
      date: '2026-08-26',
      scheduledTime: '20:00',
      responsibleUserId: 'user-aba',
      status: 'pending',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
  ];

  beforeEach(() => {
    jest.resetModules();
  });

  it('cancels (does not schedule) local reminders when an active remote channel exists', async () => {
    jest.doMock('../../lib/remoteReminderChannel', () => ({
      hasActiveRemoteReminderChannel: jest.fn().mockResolvedValue(true),
    }));
    const cancelWalkNotifications = jest.fn().mockResolvedValue(undefined);
    const scheduleWalkNotifications = jest.fn().mockResolvedValue(undefined);
    const reconcileWalkNotifications = jest.fn().mockResolvedValue(undefined);
    jest.doMock('../../notifications/notificationService', () => ({
      cancelWalkNotifications,
      scheduleWalkNotifications,
      reconcileWalkNotifications,
    }));

    const { reconcileScheduleNotifications } = require('../scheduleStore');
    await reconcileScheduleNotifications('family-main', walks);

    expect(cancelWalkNotifications).toHaveBeenCalledWith('walk-1');
    expect(reconcileWalkNotifications).not.toHaveBeenCalled();
    expect(scheduleWalkNotifications).not.toHaveBeenCalled();
  });

  it('falls back to local reconciliation when no active remote channel exists', async () => {
    jest.doMock('../../lib/remoteReminderChannel', () => ({
      hasActiveRemoteReminderChannel: jest.fn().mockResolvedValue(false),
    }));
    const cancelWalkNotifications = jest.fn().mockResolvedValue(undefined);
    const scheduleWalkNotifications = jest.fn().mockResolvedValue(undefined);
    const reconcileWalkNotifications = jest.fn().mockResolvedValue(undefined);
    jest.doMock('../../notifications/notificationService', () => ({
      cancelWalkNotifications,
      scheduleWalkNotifications,
      reconcileWalkNotifications,
    }));

    // reconcileScheduleNotifications() no-ops (by design, unrelated to this
    // batch) until the family store has a loaded dog — seed it directly so
    // this test can reach the actual reconciliation call.
    const { useFamilyStore } = require('../familyStore');
    useFamilyStore.setState({
      dog: { id: 'dog-topi', familyId: 'family-main', name: 'טופי', walksPerDay: 4 },
      users: [],
    });

    const { reconcileScheduleNotifications } = require('../scheduleStore');
    await reconcileScheduleNotifications('family-main', walks);

    expect(reconcileWalkNotifications).toHaveBeenCalled();
  });
});
