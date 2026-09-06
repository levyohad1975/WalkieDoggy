// Mock AsyncStorage with an in-memory implementation for tests.
jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock')
);

// expo-notifications touches native modules that don't exist under Jest;
// stub the pieces the app calls so notification-related code is testable.
jest.mock('expo-notifications', () => ({
  setNotificationHandler: jest.fn(),
  getPermissionsAsync: jest.fn().mockResolvedValue({ granted: true }),
  requestPermissionsAsync: jest.fn().mockResolvedValue({ granted: true }),
  scheduleNotificationAsync: jest.fn().mockResolvedValue('mock-notification-id'),
  cancelScheduledNotificationAsync: jest.fn().mockResolvedValue(undefined),
  // BUG 4 FIX: reconcileWalkNotifications() now enumerates what's actually
  // scheduled on the device to cancel orphaned reminders (e.g. for a walk
  // deleted on another device) — default to "nothing scheduled" so existing
  // tests that don't care about this keep working unchanged; tests that do
  // care override this per-test.
  getAllScheduledNotificationsAsync: jest.fn().mockResolvedValue([]),
  setNotificationChannelAsync: jest.fn().mockResolvedValue(undefined),
  AndroidImportance: { HIGH: 4 },
  SchedulableTriggerInputTypes: { DATE: 'date' },
}));

