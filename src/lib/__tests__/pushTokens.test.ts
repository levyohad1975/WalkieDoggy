import { decidePushRegistration, getExpoPushTokenIfKnown } from '../pushTokens';

/**
 * Runtime-completion correction: `registerPushToken()` itself needs a real
 * Expo/native runtime and can't be exercised in this sandbox (no
 * expo-notifications/expo-device/expo-constants native modules, no way to
 * simulate Expo Go vs. a dev build). `decidePushRegistration` is the pure
 * decision rule pulled out of it specifically so this three-way behavior
 * (Expo Go -> silent no-op; dev build without a projectId -> quiet warn;
 * dev build with a projectId -> register) is reviewable/testable as plain
 * TypeScript.
 */
describe('decidePushRegistration', () => {
  it('is a silent no-op in Expo Go regardless of projectId', () => {
    expect(decidePushRegistration({ executionEnvironment: 'storeClient', projectId: undefined })).toBe(
      'skip-silent'
    );
    expect(decidePushRegistration({ executionEnvironment: 'storeClient', projectId: 'some-real-project-id' })).toBe(
      'skip-silent'
    );
  });

  it('is a quiet warn-level no-op in a bare/dev/standalone build with no projectId configured yet', () => {
    expect(decidePushRegistration({ executionEnvironment: 'bareOrStandalone', projectId: undefined })).toBe(
      'skip-warn'
    );
    expect(decidePushRegistration({ executionEnvironment: 'bareOrStandalone', projectId: null })).toBe('skip-warn');
    expect(decidePushRegistration({ executionEnvironment: 'bareOrStandalone', projectId: '' })).toBe('skip-warn');
  });

  it('registers normally in a bare/dev/standalone build with a valid projectId', () => {
    expect(
      decidePushRegistration({ executionEnvironment: 'bareOrStandalone', projectId: 'abc-123-real-project' })
    ).toBe('register');
  });

  it('treats an unrecognized execution environment like a dev build (never silently swallowed as Expo Go)', () => {
    expect(decidePushRegistration({ executionEnvironment: 'unknown', projectId: undefined })).toBe('skip-warn');
    expect(decidePushRegistration({ executionEnvironment: 'unknown', projectId: 'abc-123' })).toBe('register');
  });
});

/**
 * Batch 2 review correction (device-specific channel selection):
 * getExpoPushTokenIfKnown() is what src/lib/remoteReminderChannel.ts reads
 * to learn THIS device's own Expo push token. registerPushToken() itself
 * needs a real native runtime (see the describe block above) and can't set
 * this in this sandbox, but the "nothing registered yet" default is real
 * behavior worth pinning: a fresh app session that hasn't completed
 * registration must report null, not some stale or guessed value, so that
 * remoteReminderChannel.ts correctly treats this device as having no known
 * remote channel until registration actually completes.
 */
describe('getExpoPushTokenIfKnown', () => {
  it('is null before registerPushToken() has ever obtained a token this session', () => {
    expect(getExpoPushTokenIfKnown()).toBeNull();
  });
});
