import { Alert, Platform } from 'react-native';

/**
 * Web-safe confirmation/message dialogs.
 *
 * react-native-web implements `Alert.alert` as a silent no-op, so any action
 * gated behind `Alert.alert(..., [{ onPress }])` simply never runs in the
 * browser or the iPhone Home Screen PWA — the button looks tappable but
 * nothing happens. These helpers use the browser's own blocking dialogs on
 * web and the native Alert everywhere else, and always report the outcome.
 */

type WebDialogHost = {
  confirm?: (message?: string) => boolean;
  alert?: (message?: string) => void;
};

function webHost(): WebDialogHost {
  return globalThis as typeof globalThis & WebDialogHost;
}

function webText(title: string, message: string): string {
  return message ? `${title}\n\n${message}` : title;
}

export interface ConfirmOptions {
  title: string;
  message: string;
  confirmLabel: string;
  cancelLabel?: string;
  destructive?: boolean;
}

/** Resolves true only when the person explicitly confirms. Dismissing, cancelling, or a missing browser dialog all resolve false. */
export function confirmAction({ title, message, confirmLabel, cancelLabel = 'ביטול', destructive }: ConfirmOptions): Promise<boolean> {
  if (Platform.OS === 'web') {
    const confirm = webHost().confirm;
    if (typeof confirm !== 'function') return Promise.resolve(false);
    try {
      return Promise.resolve(confirm(webText(title, message)) === true);
    } catch {
      return Promise.resolve(false);
    }
  }
  return new Promise<boolean>((resolve) => {
    Alert.alert(
      title,
      message,
      [
        { text: cancelLabel, style: 'cancel', onPress: () => resolve(false) },
        { text: confirmLabel, style: destructive ? 'destructive' : 'default', onPress: () => resolve(true) },
      ],
      { cancelable: true, onDismiss: () => resolve(false) },
    );
  });
}

/** A visible message on every platform (Alert.alert alone is invisible on web). */
export function showMessage(title: string, message = ''): void {
  if (Platform.OS === 'web') {
    const alert = webHost().alert;
    if (typeof alert === 'function') {
      try {
        alert(webText(title, message));
      } catch {
        /* a blocked dialog must never crash the caller */
      }
    }
    return;
  }
  Alert.alert(title, message);
}
