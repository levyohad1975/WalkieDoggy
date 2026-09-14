import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import type { NotificationSetting, Walk } from '../../types';
import {
  cancelWalkNotifications,
  ensureAndroidNotificationChannel,
  reconcileWalkNotifications,
  requestNotificationPermissions,
  scheduleWalkNotifications,
  subscribeToWalkReminderResponses,
  __resetNotificationCapabilityCacheForTests,
} from '../notificationService';
import { subscribeToReminderOpens, __resetReminderEntryForTests } from '../reminderEntry';

const scheduleMock = Notifications.scheduleNotificationAsync as jest.Mock;
const cancelMock = Notifications.cancelScheduledNotificationAsync as jest.Mock;
const getAllScheduledMock = Notifications.getAllScheduledNotificationsAsync as jest.Mock;
const getPermissionsMock = Notifications.getPermissionsAsync as jest.Mock;
const requestPermissionsMock = Notifications.requestPermissionsAsync as jest.Mock;
const getLastResponseMock = Notifications.getLastNotificationResponseAsync as jest.Mock;
const clearLastResponseMock = Notifications.clearLastNotificationResponseAsync as jest.Mock;
const addResponseListenerMock = Notifications.addNotificationResponseReceivedListener as jest.Mock;

// jest.setup.js owns the shared expo-notifications mock. Use the exact
// CommonJS mock object that notificationService.ts receives via require()
// so the assertions below observe the same jest.fn() instance.
const notificationsMock = require('expo-notifications') as {
  setNotificationChannelAsync: jest.Mock;
};
const setChannelMock = notificationsMock.setNotificationChannelAsync;

const originalPlatformOS = Platform.OS;
function setPlatformOS(os: typeof Platform.OS) {
  Object.defineProperty(Platform, 'OS', { value: os, configurable: true, writable: true });
}

// Far enough in the future that planWalkNotifications' fire times are never
// "in the past" relative to Date.now() at test-run time (see
// scheduleWalkNotifications' `fireDate.getTime() <= Date.now()` guard).
const FUTURE_DATE = '2099-06-15';
const FUTURE_TIME = '12:00';

function fakeWalk(id: string, overrides: Partial<Walk> = {}): Walk {
  return {
    id,
    familyId: 'family-1',
    dogId: 'dog-1',
    date: FUTURE_DATE,
    scheduledTime: FUTURE_TIME,
    responsibleUserId: 'user-a',
    status: 'pending',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

const setting: NotificationSetting = {
  userId: 'user-a',
  minutesBefore: 15,
  overdueMinutesAfter: 10,
  enabled: true,
};

/** Builds a fake Notifications.NotificationRequest the way expo-notifications would return it from getAllScheduledNotificationsAsync — content.data matches what scheduleWalkNotifications() actually schedules with. */
function fakeScheduledRequest(
  identifier: string,
  data?: Record<string, unknown>
): Notifications.NotificationRequest {
  return {
    identifier,
    content: { title: 't', body: 'b', data: data ?? {} },
    trigger: null,
  } as unknown as Notifications.NotificationRequest;
}

/** `YYYY-MM-DD`/`HH:MM` in LOCAL time, matching walkDateTime()'s own (y, mo, d, h, m) construction. */
function localDateString(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function localTimeString(d: Date): string {
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

beforeEach(() => {
  jest.clearAllMocks();
  // Round 6D fix: jest.clearAllMocks() clears call history but does NOT
  // drain a mock's queued *Once (mockResolvedValueOnce/mockImplementationOnce)
  // implementations — those stay queued until consumed. The permission tests
  // below queue one-time implementations on getPermissionsMock/
  // requestPermissionsMock/setChannelMock to track call order; without an
  // explicit mockReset() here, a leftover unconsumed queued implementation
  // from one test could be consumed by the NEXT test's call instead of that
  // test's own setup, causing cross-test leakage. mockReset() clears both
  // call history and any queued/default implementations, so every test in
  // this file starts these three mocks from a clean slate.
  getPermissionsMock.mockReset();
  requestPermissionsMock.mockReset();
  setChannelMock.mockReset();
  getAllScheduledMock.mockResolvedValue([]);
  getPermissionsMock.mockResolvedValue({ granted: true });
  requestPermissionsMock.mockResolvedValue({ granted: true });
  setChannelMock.mockResolvedValue(undefined);
  getLastResponseMock.mockResolvedValue(null);
  clearLastResponseMock.mockResolvedValue(undefined);
  addResponseListenerMock.mockReturnValue({ remove: jest.fn() });
  __resetReminderEntryForTests();
});

afterEach(() => {
  setPlatformOS(originalPlatformOS);
});

describe('notificationService — reassignment replaces old content (regression)', () => {
  it('scheduling for a reassigned walk uses the SAME deterministic identifier, replacing the old notification in place', async () => {
    const walk = fakeWalk('walk-1', { responsibleUserId: 'user-a' });
    await scheduleWalkNotifications(walk, setting, 'עומר', 'רקסי');

    const reassigned = fakeWalk('walk-1', { responsibleUserId: 'user-b' });
    await scheduleWalkNotifications(reassigned, setting, 'אבא', 'רקסי');

    const identifiers = scheduleMock.mock.calls.map((call) => call[0].identifier);
    // Same two identifiers both times — no separate "old" vs "new" ids ever created.
    expect(new Set(identifiers).size).toBe(2);
    // scheduleWalkNotifications() is called twice above (initial assignment,
    // then reassignment), each time scheduling both notification kinds — so
    // 4 calls are recorded in total, using only these 2 distinct identifiers
    // each time. expo-notifications' scheduleNotificationAsync with an
    // explicit `identifier` replaces the previous notification with that id
    // in place, which is exactly the behavior this regression test protects.
    identifiers.forEach((id) =>
      expect(['notif:walk-1:pre_walk_reminder', 'notif:walk-1:overdue_reminder']).toContain(id)
    );
    // The LAST schedule call for each kind (the reassignment) is what
    // actually matters for "replaces old content in place".
    expect(identifiers.slice(-2)).toEqual(['notif:walk-1:pre_walk_reminder', 'notif:walk-1:overdue_reminder']);

    const lastCallBodies = scheduleMock.mock.calls.slice(-2).map((call) => call[0].content.body);
    expect(lastCallBodies.some((b: string) => b.includes('אבא'))).toBe(true);
    expect(lastCallBodies.some((b: string) => b.includes('עומר'))).toBe(false);
  });
});

describe('notificationService — a walk marked done has its reminders removed', () => {
  it('reconcileWalkNotifications cancels a done walk\'s notifications by its deterministic ids', async () => {
    const doneWalk = fakeWalk('walk-2', { status: 'done' });
    await reconcileWalkNotifications(
      [doneWalk],
      async () => setting,
      () => 'עומר',
      'רקסי'
    );

    expect(cancelMock).toHaveBeenCalledWith('notif:walk-2:pre_walk_reminder');
    expect(cancelMock).toHaveBeenCalledWith('notif:walk-2:overdue_reminder');
    expect(scheduleMock).not.toHaveBeenCalled();
  });
});

describe('notificationService — bug 4: orphaned notification for a remotely-deleted walk', () => {
  it('cancels a scheduled notification whose walk id is absent from the current walks array entirely', async () => {
    // Simulates a reminder that got scheduled earlier for a walk that has
    // since been deleted on another device — it is not in the fresh `walks`
    // list at all (not even as a done/skipped entry).
    getAllScheduledMock.mockResolvedValue([
      fakeScheduledRequest('notif:deleted-walk:pre_walk_reminder', {
        walkId: 'deleted-walk',
        kind: 'pre_walk_reminder',
      }),
    ]);

    const stillPendingWalk = fakeWalk('walk-still-here');
    await reconcileWalkNotifications(
      [stillPendingWalk],
      async () => setting,
      () => 'עומר',
      'רקסי'
    );

    expect(cancelMock).toHaveBeenCalledWith('notif:deleted-walk:pre_walk_reminder');
  });

  it('does not cancel an app-owned notification for a walk id that IS still present', async () => {
    getAllScheduledMock.mockResolvedValue([
      fakeScheduledRequest('notif:walk-present:pre_walk_reminder', {
        walkId: 'walk-present',
        kind: 'pre_walk_reminder',
      }),
    ]);

    const stillPendingWalk = fakeWalk('walk-present');
    await reconcileWalkNotifications(
      [stillPendingWalk],
      async () => setting,
      () => 'עומר',
      'רקסי'
    );

    expect(cancelMock).not.toHaveBeenCalledWith('notif:walk-present:pre_walk_reminder');
  });

  it('leaves an unrelated (non-walk) notification already scheduled on the device untouched', async () => {
    // No `data.walkId`/`data.kind`, and an identifier that doesn't match the
    // app's own `notif:{walkId}:{kind}` scheme — e.g. some other feature's
    // notification, or something scheduled outside this app entirely.
    getAllScheduledMock.mockResolvedValue([
      fakeScheduledRequest('some-other-feature:reminder-42', { somethingElse: true }),
    ]);

    await reconcileWalkNotifications([], async () => setting, () => 'עומר', 'רקסי');

    expect(cancelMock).not.toHaveBeenCalledWith('some-other-feature:reminder-42');
  });

  it('falls back to parsing the deterministic identifier when content.data did not round-trip', async () => {
    getAllScheduledMock.mockResolvedValue([
      fakeScheduledRequest('notif:deleted-walk-2:overdue_reminder' /* no data */),
    ]);

    await reconcileWalkNotifications([], async () => setting, () => 'עומר', 'רקסי');

    expect(cancelMock).toHaveBeenCalledWith('notif:deleted-walk-2:overdue_reminder');
  });
});

describe('notificationService — cancelWalkNotifications', () => {
  it('cancels both kinds by deterministic id regardless of prior state', async () => {
    await cancelWalkNotifications('walk-x');
    expect(cancelMock).toHaveBeenCalledWith('notif:walk-x:pre_walk_reminder');
    expect(cancelMock).toHaveBeenCalledWith('notif:walk-x:overdue_reminder');
  });
});

// Round 6D — Android notification channel
describe('notificationService — Android notification channel (Round 6D)', () => {
  it('ensureAndroidNotificationChannel creates the walk-reminders channel with HIGH importance and default sound on Android', async () => {
    setPlatformOS('android');
    await ensureAndroidNotificationChannel();
    expect(setChannelMock).toHaveBeenCalledWith('walk-reminders', {
      name: 'תזכורות טיול',
      importance: Notifications.AndroidImportance.HIGH,
      sound: 'default',
    });
  });

  it('ensureAndroidNotificationChannel does nothing on iOS', async () => {
    setPlatformOS('ios');
    await ensureAndroidNotificationChannel();
    expect(setChannelMock).not.toHaveBeenCalled();
  });

  it('requestNotificationPermissions ensures the Android channel before checking/requesting permission, without a second permission system', async () => {
    setPlatformOS('android');
    // Wrap each mock's one-and-only expected call in a call-order-tracking
    // implementation. Each of these mocks is called exactly once by
    // requestNotificationPermissions() in this scenario (granted: false ->
    // falls through to requestPermissionsAsync), so a single
    // mockImplementationOnce per mock is enough to both stand in for the
    // real call AND record when it happened — no separate/duplicate
    // mockResolvedValueOnce is queued alongside it (a second queued
    // implementation would never be reached by this single real call, and
    // would incorrectly carry over to whichever test runs next).
    const callOrder: string[] = [];
    setChannelMock.mockImplementationOnce(async () => {
      callOrder.push('channel');
    });
    getPermissionsMock.mockImplementationOnce(async () => {
      callOrder.push('getPermissions');
      return { granted: false };
    });
    requestPermissionsMock.mockImplementationOnce(async () => {
      callOrder.push('requestPermissions');
      return { granted: true };
    });

    const granted = await requestNotificationPermissions();

    expect(callOrder).toEqual(['channel', 'getPermissions', 'requestPermissions']);
    expect(setChannelMock).toHaveBeenCalledTimes(1);
    expect(granted).toBe(true);
  });

  it('requestNotificationPermissions does not create a channel on iOS, and still uses the existing permission flow', async () => {
    setPlatformOS('ios');
    getPermissionsMock.mockResolvedValueOnce({ granted: true });

    const granted = await requestNotificationPermissions();

    expect(setChannelMock).not.toHaveBeenCalled();
    expect(requestPermissionsMock).not.toHaveBeenCalled(); // already granted — existing short-circuit, unchanged
    expect(granted).toBe(true);
  });

  it('scheduleWalkNotifications on Android routes scheduled notifications to channelId "walk-reminders"', async () => {
    setPlatformOS('android');
    const walk = fakeWalk('walk-android');
    await scheduleWalkNotifications(walk, setting, 'עומר', 'רקסי');

    expect(scheduleMock).toHaveBeenCalled();
    scheduleMock.mock.calls.forEach((call) => {
      expect(call[0].content.channelId).toBe('walk-reminders');
    });
  });

  it('scheduleWalkNotifications on iOS does not gain Android-specific channel content', async () => {
    setPlatformOS('ios');
    const walk = fakeWalk('walk-ios');
    await scheduleWalkNotifications(walk, setting, 'עומר', 'רקסי');

    expect(scheduleMock).toHaveBeenCalled();
    scheduleMock.mock.calls.forEach((call) => {
      expect(call[0].content).not.toHaveProperty('channelId');
    });
  });

  it('deterministic notification identifiers are unchanged by the channel work, on both platforms', async () => {
    setPlatformOS('android');
    const androidWalk = fakeWalk('walk-ids-android');
    await scheduleWalkNotifications(androidWalk, setting, 'עומר', 'רקסי');
    const androidIdentifiers = scheduleMock.mock.calls.map((call) => call[0].identifier);
    expect(new Set(androidIdentifiers)).toEqual(
      new Set(['notif:walk-ids-android:pre_walk_reminder', 'notif:walk-ids-android:overdue_reminder'])
    );

    scheduleMock.mockClear();

    setPlatformOS('ios');
    const iosWalk = fakeWalk('walk-ids-ios');
    await scheduleWalkNotifications(iosWalk, setting, 'עומר', 'רקסי');
    const iosIdentifiers = scheduleMock.mock.calls.map((call) => call[0].identifier);
    expect(new Set(iosIdentifiers)).toEqual(
      new Set(['notif:walk-ids-ios:pre_walk_reminder', 'notif:walk-ids-ios:overdue_reminder'])
    );
  });
});

/**
 * subscribeToWalkReminderResponses() is the sole entry point that turns a
 * real OS notification tap (cold-launch or live) into a reminderEntry
 * publishReminderOpen() event — this is what HomeScreen's mascot prompt
 * (see HomeScreen.tsx's subscribeToReminderOpens usage) reacts to. It had no
 * coverage at all before this: the shared expo-notifications jest mock
 * didn't even expose getLastNotificationResponseAsync/
 * clearLastNotificationResponseAsync/addNotificationResponseReceivedListener,
 * so the function's own `if (!Notifications?.addNotificationResponseReceivedListener)
 * return () => undefined;` guard silently made it a no-op under any test
 * that happened to call it — see jest.setup.js for the mock additions this
 * coverage required.
 */
describe('notificationService — subscribeToWalkReminderResponses (notification-open entry point)', () => {
  afterEach(() => {
    __resetNotificationCapabilityCacheForTests();
  });

  it('cold launch: consumes a genuine pending response exactly once and publishes the matching reminder-open event', async () => {
    getLastResponseMock.mockResolvedValueOnce({
      notification: { request: { content: { data: { walkId: 'walk-cold', kind: 'pre_walk_reminder' } } } },
    });

    const unsubscribeResponses = await subscribeToWalkReminderResponses();

    // publishReminderOpen() already fired above, before any listener existed —
    // subscribeToReminderOpens()'s "replay the last event to a late
    // subscriber" behavior (reminderEntry.ts) is what a real cold launch
    // relies on, since HomeScreen only subscribes after it mounts.
    const received: unknown[] = [];
    const unsubscribeReminder = subscribeToReminderOpens((event) => received.push(event));

    expect(received).toEqual([{ walkId: 'walk-cold', kind: 'pre_walk_reminder' }]);
    expect(clearLastResponseMock).toHaveBeenCalledTimes(1);

    unsubscribeReminder();
    unsubscribeResponses();
  });

  it('cold launch: no pending response publishes nothing', async () => {
    getLastResponseMock.mockResolvedValueOnce(null);

    const unsubscribeResponses = await subscribeToWalkReminderResponses();
    const received: unknown[] = [];
    subscribeToReminderOpens((event) => received.push(event));

    expect(received).toEqual([]);
    unsubscribeResponses();
  });

  it('cold launch: a foreign/malformed payload is rejected, not published', async () => {
    getLastResponseMock.mockResolvedValueOnce({
      notification: { request: { content: { data: { someUnrelatedKey: true } } } },
    });

    const unsubscribeResponses = await subscribeToWalkReminderResponses();
    const received: unknown[] = [];
    subscribeToReminderOpens((event) => received.push(event));

    expect(received).toEqual([]);
    unsubscribeResponses();
  });

  it('live tap: the registered OS listener publishes a reminder-open event when invoked', async () => {
    const unsubscribeResponses = await subscribeToWalkReminderResponses();
    expect(addResponseListenerMock).toHaveBeenCalledTimes(1);
    const liveHandler = addResponseListenerMock.mock.calls[0][0];

    const received: unknown[] = [];
    const unsubscribeReminder = subscribeToReminderOpens((event) => received.push(event));

    liveHandler({ notification: { request: { content: { data: { walkId: 'walk-live', kind: 'overdue_reminder' } } } } });

    expect(received).toEqual([{ walkId: 'walk-live', kind: 'overdue_reminder' }]);

    unsubscribeReminder();
    unsubscribeResponses();
  });

  it('the returned unsubscribe function removes the underlying OS subscription', async () => {
    const removeMock = jest.fn();
    addResponseListenerMock.mockReturnValueOnce({ remove: removeMock });

    const unsubscribeResponses = await subscribeToWalkReminderResponses();
    unsubscribeResponses();

    expect(removeMock).toHaveBeenCalledTimes(1);
  });

  it('is a safe no-op that touches no notification API when notifications are unavailable (e.g. Web)', async () => {
    __resetNotificationCapabilityCacheForTests();
    setPlatformOS('web');

    const unsubscribeResponses = await subscribeToWalkReminderResponses();
    expect(() => unsubscribeResponses()).not.toThrow();

    expect(getLastResponseMock).not.toHaveBeenCalled();
    expect(clearLastResponseMock).not.toHaveBeenCalled();
    expect(addResponseListenerMock).not.toHaveBeenCalled();
  });
});

/**
 * detectCapability()'s and getNotifications()'s own try/catch fallbacks (fail
 * OPEN toward "available" if expo-constants can't be loaded; return `null` —
 * never throw — if expo-notifications itself can't be loaded) are covered in
 * the dedicated notificationServiceCapabilityFallbacks.test.ts file instead
 * of here: this file has a static top-level `import * as Notifications from
 * 'expo-notifications'` that ~25 other tests depend on referencing a stable
 * singleton, and both `jest.resetModules()` and `jest.isolateModules()` were
 * found (empirically, not just in theory) to risk evicting/bypassing that
 * singleton for later tests in this same file. A separate file with no such
 * static import — mirroring src/lib/__tests__/pushTokensNative.test.ts's
 * established per-test `jest.doMock` + `jest.resetModules()` + fresh
 * `require()` pattern — avoids the cross-test pollution entirely, since Jest
 * gives each test FILE its own isolated module registry already.
 */

/**
 * The handleNotification() callback passed to Notifications.setNotificationHandler
 * is itself never invoked by any mock (it's only ever called by the real OS),
 * so its body had zero coverage. Reset the module-scope `handlerRegistered`
 * flag first (it starts `true` for the rest of this file's tests by this
 * point) so the handler is actually (re-)registered here, then capture and
 * invoke the callback the same way the OS eventually would.
 */
describe('notificationService — registered notification handler presentation behavior', () => {
  it('resolves the documented foreground-presentation options', async () => {
    __resetNotificationCapabilityCacheForTests();
    const setHandlerMock = Notifications.setNotificationHandler as jest.Mock;

    await cancelWalkNotifications('walk-handler-check');

    expect(setHandlerMock).toHaveBeenCalledTimes(1);
    const { handleNotification } = setHandlerMock.mock.calls[0][0];
    await expect(handleNotification()).resolves.toEqual({
      shouldShowAlert: true,
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: false,
      shouldSetBadge: false,
    });
  });
});

describe('notificationService — scheduleWalkNotifications no-longer-pending guard', () => {
  it('cancels rather than schedules when the walk passed in is no longer pending', async () => {
    const doneWalk = fakeWalk('walk-done-guard', { status: 'done' });
    await scheduleWalkNotifications(doneWalk, setting, 'עומר', 'רקסי');

    expect(cancelMock).toHaveBeenCalledWith('notif:walk-done-guard:pre_walk_reminder');
    expect(cancelMock).toHaveBeenCalledWith('notif:walk-done-guard:overdue_reminder');
    expect(scheduleMock).not.toHaveBeenCalled();
  });
});

describe('notificationService — scheduleWalkNotifications stale-kind cleanup', () => {
  it('cancels the one kind whose computed fire time has already passed while still (re)scheduling the other', async () => {
    // walkTime 5 minutes ago: preFireAt (15 min before) is ~20 min ago (past,
    // skipped by the `fireDate.getTime() <= Date.now()` guard); overdueFireAt
    // (10 min after) is ~5 min from now (future, still scheduled) — so only
    // ONE of the two kinds ends up in `scheduledKinds`, leaving the other one
    // stale and reaching the Promise.all(staleKinds.map(...)) cleanup below.
    const walkTime = new Date(Date.now() - 5 * 60000);
    const walk = fakeWalk('walk-stale-kind', {
      date: localDateString(walkTime),
      scheduledTime: localTimeString(walkTime),
    });

    await scheduleWalkNotifications(walk, setting, 'עומר', 'רקסי');

    expect(scheduleMock).toHaveBeenCalledTimes(1);
    expect(scheduleMock.mock.calls[0][0].identifier).toBe('notif:walk-stale-kind:overdue_reminder');
    expect(cancelMock).toHaveBeenCalledWith('notif:walk-stale-kind:pre_walk_reminder');
  });
});

describe('notificationService — cancelOrphanedWalkNotifications resiliency', () => {
  it('does not throw, and still completes reconciliation, when the OS fails to enumerate scheduled notifications', async () => {
    getAllScheduledMock.mockRejectedValueOnce(new Error('OS enumeration failed'));

    await expect(
      reconcileWalkNotifications([fakeWalk('walk-enum-fail')], async () => setting, () => 'עומר', 'רקסי')
    ).resolves.toBeUndefined();
  });
});

describe('notificationService — reconcileWalkNotifications missing-setting/name guard', () => {
  it('cancels a pending walk whose responsible user has no notification setting at all', async () => {
    const walk = fakeWalk('walk-no-setting');
    await reconcileWalkNotifications([walk], async () => undefined, () => 'עומר', 'רקסי');

    expect(cancelMock).toHaveBeenCalledWith('notif:walk-no-setting:pre_walk_reminder');
    expect(cancelMock).toHaveBeenCalledWith('notif:walk-no-setting:overdue_reminder');
    expect(scheduleMock).not.toHaveBeenCalled();
  });

  it('cancels a pending walk whose responsible user has disabled reminders', async () => {
    const walk = fakeWalk('walk-disabled-setting');
    const disabledSetting: NotificationSetting = { ...setting, enabled: false };
    await reconcileWalkNotifications([walk], async () => disabledSetting, () => 'עומר', 'רקסי');

    expect(cancelMock).toHaveBeenCalledWith('notif:walk-disabled-setting:pre_walk_reminder');
    expect(scheduleMock).not.toHaveBeenCalled();
  });

  it('cancels a pending walk whose responsible user name cannot be resolved', async () => {
    const walk = fakeWalk('walk-no-username');
    await reconcileWalkNotifications([walk], async () => setting, () => undefined, 'רקסי');

    expect(cancelMock).toHaveBeenCalledWith('notif:walk-no-username:pre_walk_reminder');
    expect(scheduleMock).not.toHaveBeenCalled();
  });
});
