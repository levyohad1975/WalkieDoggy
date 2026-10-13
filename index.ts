import { I18nManager } from 'react-native';

// Force full RTL layout for Hebrew, regardless of device locale.
// Native RTL only takes effect after a reload, which is normal on first
// launch — see README "RTL notes".
if (!I18nManager.isRTL) {
  I18nManager.allowRTL(true);
  I18nManager.forceRTL(true);
}

import { registerRootComponent } from 'expo';
import App from './App';

registerRootComponent(App);
