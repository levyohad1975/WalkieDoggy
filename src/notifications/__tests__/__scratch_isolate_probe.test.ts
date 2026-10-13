import * as Notifications from 'expo-notifications';

it('probe: isolateModules does not evict the outer expo-notifications singleton', () => {
  const before = Notifications.cancelScheduledNotificationAsync;

  jest.doMock('expo-constants', () => {
    throw new Error('x');
  });
  let freshNotifications: any;
  jest.isolateModules(() => {
    freshNotifications = require('expo-notifications');
  });
  jest.dontMock('expo-constants');

  const after = require('expo-notifications').cancelScheduledNotificationAsync;

  console.log('before === after', before === after);
  console.log('before === fresh', before === freshNotifications.cancelScheduledNotificationAsync);
});
