import fs from 'fs';

/**
 * PRD §25's "notifications disabled" state, native side. RemindersModal
 * previously only ever surfaced permission status for Web (denied/
 * unsupported Web Push messaging) — a native device with OS notification
 * permission denied had nothing telling the person why local reminders
 * never fire. Source-scan convention: this repo has no render-test
 * harness for modals.
 */
describe('RemindersModal native notification-permission state (structural)', () => {
  const source = fs.readFileSync(require.resolve('../RemindersModal'), 'utf8').replace(/\r\n/g, '\n');

  it('imports the read-only native permission-status check and the request function', () => {
    expect(source).toMatch(
      /import \{\s*\n\s*getNativeNotificationPermissionStatus,\s*\n\s*requestNotificationPermissions,\s*\n\s*type NativeNotificationPermissionStatus,\s*\n\} from '\.\.\/notifications\/notificationService';/
    );
  });

  it('checks status only while visible, only on native (never on web, where Web Push has its own separate section)', () => {
    expect(source).toContain("if (!visible || Platform.OS === 'web') return;");
    expect(source).toContain('void getNativeNotificationPermissionStatus().then(setNativePermissionStatus);');
  });

  it('fail-safe defaults to "granted" so nothing flashes a denied/undetermined message before the real async status resolves', () => {
    expect(source).toContain(
      "const [nativePermissionStatus, setNativePermissionStatus] = useState<NativeNotificationPermissionStatus>('granted');"
    );
  });

  it('a denied status offers a Settings deep-link; an undetermined one offers to request permission directly — never the same action for both', () => {
    const idx = source.indexOf("nativePermissionStatus !== 'granted' && nativePermissionStatus !== 'unavailable'");
    expect(idx).toBeGreaterThan(-1);
    const block = source.slice(idx, idx + 900);
    expect(block).toContain("nativePermissionStatus === 'denied'");
    expect(block).toContain('Linking.openSettings()');
    expect(block).toContain('handleRequestNativePermission()');
  });

  it('never shows this section for "unavailable" (Expo Go / no native module) or once already granted', () => {
    expect(source).toMatch(
      /\{Platform\.OS !== 'web' && nativePermissionStatus !== 'granted' && nativePermissionStatus !== 'unavailable' && \(/
    );
  });
});
