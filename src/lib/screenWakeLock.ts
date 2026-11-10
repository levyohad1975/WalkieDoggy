/**
 * Screen Wake Lock — keeps the walker's screen awake while a walk is actively
 * being GPS-tracked on THIS device, so the phone does not auto-lock mid-walk.
 *
 * Field reports 2026-11-05 (Omer, and earlier Maor): the live route "froze"
 * a few minutes into a walk. The cause was the walker's iPhone locking / the
 * PWA backgrounding, which suspends `watchPosition` — no fixes are sampled and
 * nothing uploads until the screen wakes again. Holding a screen wake lock
 * while the walk screen is open stops the auto-lock, so sampling stays live.
 *
 * Scope and guarantees:
 *  - Web-only and best-effort. The Screen Wake Lock API exists only in a
 *    browser; on native (Expo) `navigator.wakeLock`/`document` are absent and
 *    every function here is a no-op. It does NOT provide true background GPS
 *    (iOS suspends a web app the moment the user leaves it entirely) — that
 *    needs a native build. It only prevents the *automatic* screen lock while
 *    the walk screen is visible, which is what froze the live routes.
 *  - The browser auto-releases the lock whenever the page is hidden, so while
 *    a walk still wants the lock we re-acquire it on the next `visibilitychange`
 *    back to visible.
 *  - Every call is guarded and wrapped: the API rejects when the page is hidden
 *    or the battery is low, and a rejection must never disrupt the walk.
 */

type ScreenWakeLockSentinel = {
  released?: boolean;
  release: () => Promise<void>;
  addEventListener?: (type: 'release', listener: () => void) => void;
};

type WakeLockNavigator = Navigator & {
  wakeLock?: { request: (type: 'screen') => Promise<ScreenWakeLockSentinel> };
};

let sentinel: ScreenWakeLockSentinel | null = null;
// Whether a walk currently wants the screen kept awake. Drives re-acquisition
// after the browser auto-releases the lock on page-hide.
let wanted = false;
let visibilityListenerBound = false;

function isSupported(): boolean {
  return (
    typeof navigator !== 'undefined' &&
    typeof (navigator as WakeLockNavigator).wakeLock?.request === 'function' &&
    typeof document !== 'undefined'
  );
}

async function requestLock(): Promise<void> {
  if (!wanted || sentinel || !isSupported()) return;
  // The API rejects when the document is not visible; don't even try.
  if (document.visibilityState !== 'visible') return;
  try {
    const next = await (navigator as WakeLockNavigator).wakeLock!.request('screen');
    if (!wanted) {
      // A release landed while the request was in flight.
      void next.release().catch(() => undefined);
      return;
    }
    sentinel = next;
    next.addEventListener?.('release', () => {
      if (sentinel === next) sentinel = null;
    });
  } catch {
    // Not fatal — the walk continues; the screen may lock and GPS pause until
    // the walker wakes it. Leave `wanted` set so a later visibility change or
    // re-acquire can try again.
    sentinel = null;
  }
}

function handleVisibilityChange(): void {
  if (wanted && typeof document !== 'undefined' && document.visibilityState === 'visible' && !sentinel) {
    void requestLock();
  }
}

/**
 * Ask to keep the screen awake. Idempotent — safe to call on every GPS watch
 * (re)start. No-op off the web.
 */
export function acquireScreenWakeLock(): void {
  if (!isSupported()) return;
  wanted = true;
  if (!visibilityListenerBound) {
    document.addEventListener('visibilitychange', handleVisibilityChange);
    visibilityListenerBound = true;
  }
  void requestLock();
}

/**
 * Release the screen wake lock and stop re-acquiring it. Idempotent — safe to
 * call from every tracking stop/cancel path even when no lock is held.
 */
export async function releaseScreenWakeLock(): Promise<void> {
  wanted = false;
  if (visibilityListenerBound && typeof document !== 'undefined') {
    document.removeEventListener('visibilitychange', handleVisibilityChange);
    visibilityListenerBound = false;
  }
  const held = sentinel;
  sentinel = null;
  if (held && !held.released) {
    try {
      await held.release();
    } catch {
      // Already released or unavailable — nothing to do.
    }
  }
}

/** Test-only reset of module state. */
export function __resetScreenWakeLockForTests(): void {
  sentinel = null;
  wanted = false;
  visibilityListenerBound = false;
}
