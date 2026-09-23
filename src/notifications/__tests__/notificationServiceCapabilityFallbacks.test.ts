/**
 * Dedicated file (deliberately with NO top-level static import of
 * `../notificationService` or `expo-notifications`) for
 * detectCapability()'s and getNotifications()'s own try/catch fallbacks:
 * fail OPEN toward "available" if expo-constants can't be loaded (never
 * silently disable reminders in a real build), and return `null` — never
 * throw — if expo-notifications itself can't be loaded. Every test in
 * notificationService.test.ts relies on both native modules loading
 * successfully via a shared, statically-imported `Notifications` singleton;
 * mixing that file's style with the jest.doMock + jest.resetModules() +
 * fresh require() pattern needed here caused real cross-test pollution
 * (later tests in that file silently started asserting against a different,
 * unasserted mock instance). This file follows
 * src/lib/__tests__/pushTokensNative.test.ts's established pattern for the
 * exact same reason that file uses it: every test requires the module under
 * test fresh, after its own jest.resetModules(), so there is no shared
 * singleton to accidentally evict.
 */

function mockWorkingNotifications() {
  jest.doMock('expo-notifications', () => ({
    setNotificationHandler: jest.fn(),
    getPermissionsAsync: jest.fn().mockResolvedValue({ granted: true }),
    requestPermissionsAsync: jest.fn().mockResolvedValue({ granted: true }),
    scheduleNotificationAsync: jest.fn().mockResolvedValue('mock-notification-id'),
    cancelScheduledNotificationAsync: jest.fn().mockResolvedValue(undefined),
    getAllScheduledNotificationsAsync: jest.fn().mockResolvedValue([]),
    setNotificationChannelAsync: jest.fn().mockResolvedValue(undefined),
    getLastNotificationResponseAsync: jest.fn().mockResolvedValue(null),
    clearLastNotificationResponseAsync: jest.fn().mockResolvedValue(undefined),
    addNotificationResponseReceivedListener: jest.fn().mockReturnValue({ remove: jest.fn() }),
    AndroidImportance: { HIGH: 4 },
    SchedulableTriggerInputTypes: { DATE: 'date' },
  }));
}

beforeEach(() => {
  jest.resetModules();
});

describe('notificationService — detectCapability() fails open when expo-constants cannot be loaded', () => {
  it('still schedules/cancels normally (treats the runtime as "available") rather than silently disabling reminders', async () => {
    mockWorkingNotifications();
    jest.doMock('expo-constants', () => {
      throw new Error('native module missing under this runtime');
    });
    const Notifications = require('expo-notifications');
    const { cancelWalkNotifications } = require('../notificationService');

    await cancelWalkNotifications('walk-constants-unavailable');

    expect(Notifications.cancelScheduledNotificationAsync).toHaveBeenCalledWith(
      'notif:walk-constants-unavailable:T-15'
    );
    expect(Notifications.cancelScheduledNotificationAsync).toHaveBeenCalledWith(
      'notif:walk-constants-unavailable:T+30'
    );
  });
});

describe('notificationService — getNotifications() fails safe when expo-notifications cannot be loaded', () => {
  it('resolves to a silent no-op (never throws, never schedules) rather than crashing', async () => {
    jest.doMock('expo-notifications', () => {
      throw new Error('native module missing under this runtime');
    });
    const { cancelWalkNotifications } = require('../notificationService');

    await expect(cancelWalkNotifications('walk-notifications-unavailable')).resolves.toBeUndefined();
    // Nothing to assert on expo-notifications itself here — require() threw
    // before any mock object could even be produced, which is the point.
  });
});

describe('notificationService — detectCapability() without an ESM .default wrapper', () => {
  it('reads executionEnvironment straight off the required module when it has no .default (CJS-shaped expo-constants)', async () => {
    mockWorkingNotifications();
    // No `.default` key at all here — unlike the ESM-interop shape every
    // other test in this project implicitly relies on — exercising the
    // `constantsImport?.default ?? constantsImport` fallback's right-hand
    // side (constantsModule.ts's own mapExecutionEnvironment() doc comment
    // notes this same CJS-vs-ESM ambiguity is exactly why it defends against
    // both).
    jest.doMock('expo-constants', () => ({
      executionEnvironment: 'bare',
    }));
    const Notifications = require('expo-notifications');
    const { cancelWalkNotifications } = require('../notificationService');

    await cancelWalkNotifications('walk-cjs-constants');

    expect(Notifications.cancelScheduledNotificationAsync).toHaveBeenCalledWith(
      'notif:walk-cjs-constants:T-15'
    );
  });
});

describe('notificationService — real Expo Go (storeClient) end-to-end: every native call site safely no-ops', () => {
  function mockExpoGoConstants() {
    jest.doMock('expo-constants', () => ({
      executionEnvironment: 'storeClient',
      expoGoConfig: { debuggerHost: '127.0.0.1:19000' },
    }));
  }

  function fakeWalk(id: string) {
    const future = new Date(Date.now() + 60 * 60000);
    return {
      id,
      familyId: 'family-1',
      dogId: 'dog-1',
      date: `${future.getFullYear()}-${String(future.getMonth() + 1).padStart(2, '0')}-${String(future.getDate()).padStart(2, '0')}`,
      scheduledTime: `${String(future.getHours()).padStart(2, '0')}:${String(future.getMinutes()).padStart(2, '0')}`,
      responsibleUserId: 'user-a',
      status: 'pending' as const,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
  }

  const setting = { userId: 'user-a', enabled: true };

  it('ensureAndroidNotificationChannel() no-ops on Android in Expo Go, without ever touching expo-notifications', async () => {
    mockExpoGoConstants();
    mockWorkingNotifications();
    const Notifications = require('expo-notifications');
    const { Platform } = require('react-native');
    Object.defineProperty(Platform, 'OS', { value: 'android', configurable: true, writable: true });
    const { ensureAndroidNotificationChannel } = require('../notificationService');

    await ensureAndroidNotificationChannel();

    expect(Notifications.setNotificationChannelAsync).not.toHaveBeenCalled();
  });

  it('requestNotificationPermissions() resolves false in Expo Go, without ever touching expo-notifications', async () => {
    mockExpoGoConstants();
    mockWorkingNotifications();
    const Notifications = require('expo-notifications');
    const { requestNotificationPermissions } = require('../notificationService');

    await expect(requestNotificationPermissions()).resolves.toBe(false);
    expect(Notifications.getPermissionsAsync).not.toHaveBeenCalled();
  });

  it('scheduleWalkNotifications() no-ops in Expo Go, without ever touching expo-notifications', async () => {
    mockExpoGoConstants();
    mockWorkingNotifications();
    const Notifications = require('expo-notifications');
    const { scheduleWalkNotifications } = require('../notificationService');

    await scheduleWalkNotifications(fakeWalk('walk-expo-go'), setting, 'עומר', 'רקסי');

    expect(Notifications.scheduleNotificationAsync).not.toHaveBeenCalled();
  });

  it('reconcileWalkNotifications() (via cancelOrphanedWalkNotifications) no-ops in Expo Go, without ever touching expo-notifications', async () => {
    mockExpoGoConstants();
    mockWorkingNotifications();
    const Notifications = require('expo-notifications');
    const { reconcileWalkNotifications } = require('../notificationService');

    await reconcileWalkNotifications([fakeWalk('walk-expo-go-2')], async () => setting, () => 'עומר', 'רקסי');

    expect(Notifications.getAllScheduledNotificationsAsync).not.toHaveBeenCalled();
    expect(Notifications.scheduleNotificationAsync).not.toHaveBeenCalled();
  });
});
