/**
 * Mascot-notification-experiences round — a single notification tap can
 * legitimately reach the app's JS twice: on web, the service worker's
 * `notificationclick` handler both focuses an existing client (which may
 * race with that client's own cold-start URL-param read) and falls back to
 * opening a new window whose URL also carries the same payload; on native,
 * a cold-launch response can be replayed once by
 * `getLastNotificationResponseAsync()` and then observed again by the live
 * `addNotificationResponseReceivedListener` subscription. Without this
 * guard, the SAME tap could publish two identical open events — e.g.
 * navigating to Home twice, or showing the mascot prompt, dismissing it,
 * then showing it again a moment later.
 *
 * A single most-recent-key slot is sufficient: the only thing being
 * guarded against is the exact same logical event (same walk+stage, or
 * same request+event) arriving twice in quick succession from two
 * delivery paths for ONE real tap — never two different, legitimately
 * distinct taps happening to interleave within the window.
 */
const DEDUPE_WINDOW_MS = 4000;

let lastKey: string | null = null;
let lastAt = 0;

/** Returns true (and does NOT update the remembered key) if `key` was already seen within the dedupe window — the caller should drop this event. Otherwise remembers `key` and returns false. */
export function isDuplicateNotificationOpen(key: string, now: number = Date.now()): boolean {
  if (lastKey === key && now - lastAt < DEDUPE_WINDOW_MS) return true;
  lastKey = key;
  lastAt = now;
  return false;
}

/** Test-only hook — not used by production code paths. */
export function __resetNotificationOpenDedupForTests(): void {
  lastKey = null;
  lastAt = 0;
}
