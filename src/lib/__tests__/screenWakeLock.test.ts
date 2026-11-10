import {
  acquireScreenWakeLock,
  releaseScreenWakeLock,
  __resetScreenWakeLockForTests,
} from '../screenWakeLock';

/**
 * Field reports 2026-11-05 (Omer, and earlier Maor): the live walk route froze
 * minutes in because the walker's iPhone locked and suspended the GPS watch.
 * This wake lock keeps the screen awake while a walk is tracked. Best-effort
 * and web-only — these tests drive it with mocked browser globals.
 */

const flush = async () => {
  await Promise.resolve();
  await Promise.resolve();
};

function setGlobal(key: 'navigator' | 'document', value: unknown): void {
  try {
    Object.defineProperty(global, key, { value, configurable: true, writable: true });
  } catch {
    (global as unknown as Record<string, unknown>)[key] = value;
  }
}

describe('screenWakeLock', () => {
  const realNavigator = (global as unknown as Record<string, unknown>).navigator;
  const realDocument = (global as unknown as Record<string, unknown>).document;

  let request: jest.Mock;
  let release: jest.Mock;
  let sentinelListeners: Record<string, () => void>;
  let docListeners: Record<string, () => void>;
  let visibility: 'visible' | 'hidden';

  function installSupported(): void {
    sentinelListeners = {};
    docListeners = {};
    visibility = 'visible';
    release = jest.fn().mockResolvedValue(undefined);
    const sentinel = {
      released: false,
      release,
      addEventListener: (type: string, cb: () => void) => {
        sentinelListeners[type] = cb;
      },
    };
    request = jest.fn().mockResolvedValue(sentinel);
    setGlobal('navigator', { wakeLock: { request } });
    setGlobal('document', {
      get visibilityState() {
        return visibility;
      },
      addEventListener: (type: string, cb: () => void) => {
        docListeners[type] = cb;
      },
      removeEventListener: (type: string) => {
        delete docListeners[type];
      },
    });
  }

  afterEach(async () => {
    await releaseScreenWakeLock();
    __resetScreenWakeLockForTests();
    setGlobal('navigator', realNavigator);
    setGlobal('document', realDocument);
  });

  it('acquires a screen wake lock when supported and the page is visible', async () => {
    installSupported();
    acquireScreenWakeLock();
    await flush();
    expect(request).toHaveBeenCalledWith('screen');
  });

  it('releases the held lock on release', async () => {
    installSupported();
    acquireScreenWakeLock();
    await flush();
    await releaseScreenWakeLock();
    expect(release).toHaveBeenCalledTimes(1);
  });

  it('re-acquires after the browser auto-releases on page-hide, once visible again', async () => {
    installSupported();
    acquireScreenWakeLock();
    await flush();
    expect(request).toHaveBeenCalledTimes(1);
    // The browser drops the lock when the page is hidden.
    sentinelListeners.release?.();
    // Returning to the foreground re-requests it (still mid-walk).
    docListeners.visibilitychange?.();
    await flush();
    expect(request).toHaveBeenCalledTimes(2);
  });

  it('does not request a lock while the document is hidden', async () => {
    installSupported();
    visibility = 'hidden';
    acquireScreenWakeLock();
    await flush();
    expect(request).not.toHaveBeenCalled();
  });

  it('stops re-acquiring after release (visibility change is a no-op)', async () => {
    installSupported();
    acquireScreenWakeLock();
    await flush();
    await releaseScreenWakeLock();
    docListeners.visibilitychange?.();
    await flush();
    expect(request).toHaveBeenCalledTimes(1);
  });

  it('is a safe no-op when the Wake Lock API is unavailable', async () => {
    setGlobal('navigator', {});
    setGlobal('document', undefined);
    expect(() => acquireScreenWakeLock()).not.toThrow();
    await expect(releaseScreenWakeLock()).resolves.toBeUndefined();
  });
});
