import { Platform } from 'react-native';
describe('platform probe', () => {
  it('shows default OS and settability', () => {
    console.log('DEFAULT OS:', Platform.OS);
    (Platform as any).OS = 'android';
    console.log('AFTER SET OS:', Platform.OS);
  });
});
