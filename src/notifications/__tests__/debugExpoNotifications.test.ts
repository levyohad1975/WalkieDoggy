describe('debug expo notifications', () => {
  it('prints module shape', () => {
    const mod = require('expo-notifications');

    console.log('DEBUG keys =', Object.keys(mod));
    console.log('DEBUG AndroidImportance =', mod?.AndroidImportance);
    console.log('DEBUG default AndroidImportance =', mod?.default?.AndroidImportance);
    console.log('DEBUG setNotificationChannelAsync =', typeof mod?.setNotificationChannelAsync);
    console.log('DEBUG default setNotificationChannelAsync =', typeof mod?.default?.setNotificationChannelAsync);
  });
});
