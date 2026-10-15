import { Alert, Platform } from 'react-native';
import { confirmAction, showMessage } from '../dialogs';

/**
 * Root cause of the iPhone "cannot delete a calendar entry" P0:
 * react-native-web's Alert.alert is a silent no-op, so a delete gated behind
 * Alert.alert buttons never ran in Safari / the Home Screen PWA. These
 * helpers must show a real, blocking dialog on web and report the choice.
 */
describe('dialogs', () => {
  const originalOs = Platform.OS;
  const host = globalThis as typeof globalThis & { confirm?: unknown; alert?: unknown };
  const originalConfirm = host.confirm;
  const originalAlert = host.alert;

  function setOs(os: string) {
    Object.defineProperty(Platform, 'OS', { configurable: true, value: os });
  }

  afterEach(() => {
    setOs(originalOs);
    host.confirm = originalConfirm;
    host.alert = originalAlert;
    jest.restoreAllMocks();
  });

  describe('on web (iPhone Safari / PWA)', () => {
    beforeEach(() => setOs('web'));

    it('confirmAction shows the browser confirm with title and message and resolves true on OK', async () => {
      const confirm = jest.fn().mockReturnValue(true);
      host.confirm = confirm;
      const alertSpy = jest.spyOn(Alert, 'alert');
      await expect(confirmAction({ title: 'מחיקת משימה', message: 'למחוק?', confirmLabel: 'מחיקה' })).resolves.toBe(true);
      expect(confirm).toHaveBeenCalledTimes(1);
      expect(confirm).toHaveBeenCalledWith('מחיקת משימה\n\nלמחוק?');
      expect(alertSpy).not.toHaveBeenCalled();
    });

    it('confirmAction resolves false when the person cancels', async () => {
      host.confirm = jest.fn().mockReturnValue(false);
      await expect(confirmAction({ title: 'מחיקת משימה', message: 'למחוק?', confirmLabel: 'מחיקה' })).resolves.toBe(false);
    });

    it('confirmAction fails closed (false) when no browser dialog is available or it throws', async () => {
      host.confirm = undefined;
      await expect(confirmAction({ title: 't', message: 'm', confirmLabel: 'ok' })).resolves.toBe(false);
      host.confirm = jest.fn(() => { throw new Error('blocked'); });
      await expect(confirmAction({ title: 't', message: 'm', confirmLabel: 'ok' })).resolves.toBe(false);
    });

    it('showMessage uses the visible browser alert, never the no-op Alert.alert', () => {
      const alert = jest.fn();
      host.alert = alert;
      const alertSpy = jest.spyOn(Alert, 'alert');
      showMessage('לא הצלחנו למחוק', 'המשימה לא נמחקה');
      expect(alert).toHaveBeenCalledWith('לא הצלחנו למחוק\n\nהמשימה לא נמחקה');
      expect(alertSpy).not.toHaveBeenCalled();
    });
  });

  describe('on native', () => {
    beforeEach(() => setOs('ios'));

    function pressAlertButton(index: number) {
      const spy = Alert.alert as jest.Mock;
      const buttons = spy.mock.calls[0][2] as Array<{ text: string; style?: string; onPress?: () => void }>;
      buttons[index].onPress?.();
      return buttons;
    }

    it('confirmAction resolves true only from the destructive confirm button', async () => {
      jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
      const result = confirmAction({ title: 'מחיקת משימה', message: 'למחוק?', confirmLabel: 'מחיקה', destructive: true });
      const buttons = pressAlertButton(1);
      expect(buttons[0]).toMatchObject({ text: 'ביטול', style: 'cancel' });
      expect(buttons[1]).toMatchObject({ text: 'מחיקה', style: 'destructive' });
      await expect(result).resolves.toBe(true);
    });

    it('confirmAction resolves false from cancel', async () => {
      jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
      const result = confirmAction({ title: 'מחיקת משימה', message: 'למחוק?', confirmLabel: 'מחיקה' });
      pressAlertButton(0);
      await expect(result).resolves.toBe(false);
    });

    it('showMessage uses Alert.alert', () => {
      const spy = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
      showMessage('כותרת', 'גוף');
      expect(spy).toHaveBeenCalledWith('כותרת', 'גוף');
    });
  });
});
