describe('debug expo constants', () => {
  it('prints runtime shape', () => {
    const mod = require('expo-constants');
    const constants = mod?.default ?? mod;

    console.log('DEBUG executionEnvironment =', constants?.executionEnvironment);
    console.log('DEBUG expoGoConfig =', constants?.expoGoConfig);
    console.log('DEBUG appOwnership =', constants?.appOwnership);
  });
});
