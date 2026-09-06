/**
 * Shared, pure helper for distinguishing Expo Go from native/dev/standalone
 * builds.
 *
 * In current Expo SDKs, `ExecutionEnvironment.StoreClient` is not specific
 * to Expo Go: it can also describe a development build created with
 * expo-dev-client. `expoGoConfig`, on the other hand, is populated
 * specifically while running inside Expo Go.
 *
 * The existing return labels are kept for compatibility with callers:
 * - `storeClient` now means "confirmed Expo Go"
 * - `bareOrStandalone` means a confirmed non-Expo-Go native runtime
 * - `unknown` means we could not identify the runtime confidently
 */
export type ExpoExecutionEnvironment = 'storeClient' | 'bareOrStandalone' | 'unknown';

export function mapExecutionEnvironment(constantsModule: any): ExpoExecutionEnvironment {
  const value = constantsModule?.executionEnvironment;
  const storeClient = constantsModule?.ExecutionEnvironment?.StoreClient ?? 'storeClient';

  if (constantsModule?.expoGoConfig != null && value === storeClient) {
    return 'storeClient';
  }

  if (value === 'bare' || value === 'standalone' || value === storeClient) {
    return 'bareOrStandalone';
  }

  // Fail open: an unknown/mock environment must not silently disable
  // notifications.
  return 'unknown';
}

