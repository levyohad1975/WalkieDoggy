import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import type { HealthTask } from '../../types';
import {
  cancelHealthTaskNotifications,
  ensureAndroidHealthReminderChannel,
  reconcileHealthTaskNotifications,
  scheduleHealthTaskNotifications,
} from '../healthReminderService';

const scheduleMock = Notifications.scheduleNotificationAsync as jest.Mock;
const cancelMock = Notifications.cancelScheduledNotificationAsync as jest.Mock;
const getAllScheduledMock = Notifications.getAllScheduledNotificationsAsync as jest.Mock;

const notificationsMock = require('expo-notifications') as { setNotificationChannelAsync: jest.Mock };
const setChannelMock = notificationsMock.setNotificationChannelAsync;

const originalPlatformOS = Platform.OS;
function setPlatformOS(os: typeof Platform.OS) {
  Object.defineProperty(Platform, 'OS', { value: os, configurable: true, writable: true });
}

// Far enough ahead that planHealthTaskNotifications' fire times are never
// "in the past" relative to Date.now() at test-run time.
const FUTURE_DATE = '2099-06-15';

function fakeTask(id: string, overrides: Partial<HealthTask> = {}): HealthTask {
  return {
    id,
    familyId: 'family-1',
    dogId: 'dog-1',
    category: 'vaccination',
    title: 'חיסון כלבת',
    dueDate: FUTURE_DATE,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

function fakeScheduledRequest(identifier: string, data?: Record<string, unknown>): Notifications.NotificationRequest {
  return { identifier, content: { title: 't', body: 'b', data: data ?? {} }, trigger: null } as unknown as Notifications.NotificationRequest;
}

beforeEach(() => {
  jest.clearAllMocks();
  getAllScheduledMock.mockResolvedValue([]);
  setChannelMock.mockResolvedValue(undefined);
});

afterEach(() => {
  setPlatformOS(originalPlatformOS);
});

describe('healthReminderService — dedup via deterministic identifier', () => {
  it('rescheduling the same task uses the SAME identifiers both times (OS replaces in place, no duplicates)', async () => {
    await scheduleHealthTaskNotifications(fakeTask('task-1'), 'טופי');
    await scheduleHealthTaskNotifications(fakeTask('task-1', { title: 'חיסון כלבת (עדכון)' }), 'טופי');

    const identifiers = scheduleMock.mock.calls.map((call) => call[0].identifier);
    expect(new Set(identifiers).size).toBe(2);
    identifiers.forEach((id) => expect(['health-notif:task-1:health_task_due', 'health-notif:task-1:health_task_overdue']).toContain(id));
  });

  it('repeated calls for an unchanged task never accumulate extra scheduled entries beyond the 2 kinds', async () => {
    await scheduleHealthTaskNotifications(fakeTask('task-dup'), 'טופי');
    await scheduleHealthTaskNotifications(fakeTask('task-dup'), 'טופי');
    await scheduleHealthTaskNotifications(fakeTask('task-dup'), 'טופי');

    const identifiers = new Set(scheduleMock.mock.calls.map((call) => call[0].identifier));
    expect(identifiers).toEqual(new Set(['health-notif:task-dup:health_task_due', 'health-notif:task-dup:health_task_overdue']));
  });
});

describe('healthReminderService — a completed task has its reminders removed', () => {
  it('scheduleHealthTaskNotifications cancels rather than schedules for a completed task', async () => {
    const completed = fakeTask('task-done', { completedAt: new Date().toISOString() });
    await scheduleHealthTaskNotifications(completed, 'טופי');

    expect(cancelMock).toHaveBeenCalledWith('health-notif:task-done:health_task_due');
    expect(cancelMock).toHaveBeenCalledWith('health-notif:task-done:health_task_overdue');
    expect(scheduleMock).not.toHaveBeenCalled();
  });

  it('reconcileHealthTaskNotifications cancels a completed task while scheduling an open one', async () => {
    const open = fakeTask('task-open');
    const completed = fakeTask('task-done', { completedAt: new Date().toISOString() });
    await reconcileHealthTaskNotifications([open, completed], 'טופי');

    expect(cancelMock).toHaveBeenCalledWith('health-notif:task-done:health_task_due');
    const scheduledIds = scheduleMock.mock.calls.map((call) => call[0].identifier);
    expect(scheduledIds).toContain('health-notif:task-open:health_task_due');
  });
});

describe('healthReminderService — cancelHealthTaskNotifications', () => {
  it('cancels both kinds by deterministic id regardless of prior state', async () => {
    await cancelHealthTaskNotifications('task-x');
    expect(cancelMock).toHaveBeenCalledWith('health-notif:task-x:health_task_due');
    expect(cancelMock).toHaveBeenCalledWith('health-notif:task-x:health_task_overdue');
  });
});

describe('healthReminderService — orphan cleanup (dog switch / task no longer in the loaded set)', () => {
  it('cancels an app-owned health reminder whose task id is absent from the reconciled set entirely', async () => {
    getAllScheduledMock.mockResolvedValue([
      fakeScheduledRequest('health-notif:task-other-dog:health_task_due', { healthTaskId: 'task-other-dog', kind: 'health_task_due' }),
    ]);

    await reconcileHealthTaskNotifications([fakeTask('task-still-here')], 'טופי');

    expect(cancelMock).toHaveBeenCalledWith('health-notif:task-other-dog:health_task_due');
  });

  it('does not cancel an app-owned notification for a task id that IS still present', async () => {
    getAllScheduledMock.mockResolvedValue([
      fakeScheduledRequest('health-notif:task-present:health_task_due', { healthTaskId: 'task-present', kind: 'health_task_due' }),
    ]);

    await reconcileHealthTaskNotifications([fakeTask('task-present')], 'טופי');

    expect(cancelMock).not.toHaveBeenCalledWith('health-notif:task-present:health_task_due');
  });

  it('leaves an unrelated notification (e.g. a walk reminder) already scheduled on the device untouched', async () => {
    getAllScheduledMock.mockResolvedValue([
      fakeScheduledRequest('notif:walk-1:pre_walk_reminder', { walkId: 'walk-1', kind: 'pre_walk_reminder' }),
    ]);

    await reconcileHealthTaskNotifications([], 'טופי');

    expect(cancelMock).not.toHaveBeenCalledWith('notif:walk-1:pre_walk_reminder');
  });

  it('falls back to parsing the deterministic identifier when content.data did not round-trip', async () => {
    getAllScheduledMock.mockResolvedValue([fakeScheduledRequest('health-notif:task-legacy:health_task_overdue')]);

    await reconcileHealthTaskNotifications([], 'טופי');

    expect(cancelMock).toHaveBeenCalledWith('health-notif:task-legacy:health_task_overdue');
  });
});

describe('healthReminderService — Android notification channel', () => {
  it('ensureAndroidHealthReminderChannel creates a distinct channel from walk reminders, on Android only', async () => {
    setPlatformOS('android');
    await ensureAndroidHealthReminderChannel();
    expect(setChannelMock).toHaveBeenCalledWith('health-grooming-reminders', {
      name: 'תזכורות בריאות וטיפוח',
      importance: Notifications.AndroidImportance.DEFAULT,
      sound: 'default',
    });
  });

  it('does nothing on iOS', async () => {
    setPlatformOS('ios');
    await ensureAndroidHealthReminderChannel();
    expect(setChannelMock).not.toHaveBeenCalled();
  });

  it('scheduleHealthTaskNotifications on Android routes to the health-grooming-reminders channel', async () => {
    setPlatformOS('android');
    await scheduleHealthTaskNotifications(fakeTask('task-android'), 'טופי');
    expect(scheduleMock).toHaveBeenCalled();
    scheduleMock.mock.calls.forEach((call) => expect(call[0].content.channelId).toBe('health-grooming-reminders'));
  });
});

describe('healthReminderService — stale-kind cleanup', () => {
  it('cancels the one kind whose computed fire time has already passed while still (re)scheduling the other', async () => {
    // FIXED `now` (noon on a fixed date), injected explicitly — see
    // scheduleHealthTaskNotifications' own doc comment. This is what makes
    // the test deterministic regardless of the real wall-clock hour at
    // test-run time: previously it compared a task due "today" (fires at
    // 09:00 local) against the REAL Date.now(), which only reads as
    // "already past" when the suite happens to run after 09:00 local —
    // exactly the flake this now-injectable `now` param exists to remove.
    const fixedNow = new Date(2026, 0, 15, 12, 0, 0); // 2026-01-15 12:00 local
    const dueToday = '2026-01-15';
    // health_task_due fires at 2026-01-15T09:00 (3h before fixedNow) ->
    // stale. health_task_overdue fires at 2026-01-16T09:00 (still ahead of
    // fixedNow) -> not stale. Both relationships hold unconditionally,
    // independent of whatever the real current time is.
    await scheduleHealthTaskNotifications(fakeTask('task-stale', { dueDate: dueToday }), 'טופי', fixedNow);

    const scheduledIds = scheduleMock.mock.calls.map((call) => call[0].identifier);
    expect(scheduledIds).not.toContain('health-notif:task-stale:health_task_due');
    expect(scheduledIds).toContain('health-notif:task-stale:health_task_overdue');
    expect(cancelMock).toHaveBeenCalledWith('health-notif:task-stale:health_task_due');
  });
});

describe('healthReminderService — resiliency', () => {
  it('does not throw, and still completes reconciliation, when the OS fails to enumerate scheduled notifications', async () => {
    getAllScheduledMock.mockRejectedValueOnce(new Error('OS enumeration failed'));
    await expect(reconcileHealthTaskNotifications([fakeTask('task-enum-fail')], 'טופי')).resolves.toBeUndefined();
  });
});
