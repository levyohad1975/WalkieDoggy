import { decideNotificationCapability } from '../notificationService';
import { mapExecutionEnvironment } from '../../lib/expoRuntime';

/**
 * P0 Android Expo Go 57 startup-crash fix — regression coverage for the
 * pure decision rule that guards every expo-notifications call in
 * notificationService.ts. The native-module plumbing around it
 * (getNotifications()'s lazy import + memoized handler registration) needs
 * a real Expo/native runtime and can't be exercised in this sandbox — see
 * that file's own doc comment — but this rule is exactly what stands
 * between "Expo Go on Android" and the crash described in the bug report,
 * so it is reviewable/testable as plain TypeScript here, mirroring
 * src/lib/pushTokens.test.ts's decidePushRegistration coverage for the
 * separate remote-push system.
 */
describe('decideNotificationCapability', () => {
  it('is unavailable in Expo Go (storeClient) — this is what prevents the Android SDK 53+ crash', () => {
    expect(decideNotificationCapability('storeClient')).toBe('unavailable');
  });

  it('is available in a bare/dev/standalone build', () => {
    expect(decideNotificationCapability('bareOrStandalone')).toBe('available');
  });

  it('fails OPEN (available) for an unrecognized environment rather than silently disabling reminders', () => {
    expect(decideNotificationCapability('unknown')).toBe('available');
  });
});

/**
 * Exercises the actual mapping this guard is fed from, with a mocked
 * Constants.executionEnvironment shape — the same shared detector
 * src/lib/pushTokens.ts uses for remote push registration (src/lib/
 * expoRuntime.ts), confirming notificationService.ts's local-reminder guard
 * and pushTokens.ts's remote-push guard agree on what "Expo Go" means given
 * identical input, per the task's requirement that both systems use the
 * same detection pattern.
 */
describe('mapExecutionEnvironment -> decideNotificationCapability (Expo Go vs dev build, end to end)', () => {
  it('a real Expo Go Constants shape resolves to unavailable', () => {
    const constants = {
      executionEnvironment: 'storeClient',
      ExecutionEnvironment: { StoreClient: 'storeClient' },
      expoGoConfig: {},
    };
    expect(decideNotificationCapability(mapExecutionEnvironment(constants))).toBe('unavailable');
  });

  it('a real dev-client Constants shape resolves to available', () => {
    const constants = {
      executionEnvironment: 'storeClient',
      ExecutionEnvironment: { StoreClient: 'storeClient' },
      expoGoConfig: null,
    };
    expect(decideNotificationCapability(mapExecutionEnvironment(constants))).toBe('available');
  });

  it('a standalone build Constants shape resolves to available', () => {
    const constants = { executionEnvironment: 'standalone', ExecutionEnvironment: { StoreClient: 'storeClient' } };
    expect(decideNotificationCapability(mapExecutionEnvironment(constants))).toBe('available');
  });

  it('a missing/undefined Constants module resolves to available (fail open)', () => {
    expect(decideNotificationCapability(mapExecutionEnvironment(undefined))).toBe('available');
  });
});

