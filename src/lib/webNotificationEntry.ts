import { Platform } from 'react-native';
import { publishReminderOpen, reminderOpenFromNotificationData } from '../notifications/reminderEntry';
import { publishRequestOpen, requestOpenFromNotificationData } from '../notifications/requestEntry';

/**
 * Mascot-notification-experiences round — the web (PWA) counterpart to
 * native's notification-response listener (notificationService.ts's
 * subscribeToWalkReminderResponses()). public/sw.js's own
 * `notificationclick` handler cannot itself call into app code or React
 * state; it either `postMessage`s the tapped notification's `data` to an
 * already-open client, or — when there is no open client (app fully
 * closed/killed) — opens a new window whose URL carries that same `data`
 * as a `notif` query-string parameter. This module is the single place
 * that consumes BOTH of those delivery paths and turns them into the
 * exact same publishReminderOpen()/publishRequestOpen() calls a native
 * notification tap already produces — reusing those modules' own
 * validation and (shared) duplicate-tap suppression rather than
 * duplicating either.
 *
 * Mirrors the established synchronous-read-then-replaceState idiom already
 * used for invite/join deep links (see FamilyOnboardingScreen.tsx's
 * initialInviteToken/initialJoinCode) for the cold-launch URL-param case.
 */
function dispatch(data: unknown): void {
  const reminderEvent = reminderOpenFromNotificationData(data);
  if (reminderEvent) {
    publishReminderOpen(reminderEvent);
    return;
  }
  const requestEvent = requestOpenFromNotificationData(data);
  if (requestEvent) {
    publishRequestOpen(requestEvent);
  }
}

/** Reads and consumes the cold-launch `notif` URL param, if present — call exactly once, as early as possible. Web only; a safe no-op everywhere else. */
export function consumeInitialWebNotificationParam(): void {
  if (Platform.OS !== 'web' || typeof window === 'undefined') return;
  try {
    const raw = new URLSearchParams(window.location.search).get('notif');
    if (!raw) return;
    const data = JSON.parse(decodeURIComponent(raw));
    dispatch(data);
  } catch {
    // Malformed/foreign query param — never let a bad URL break Home.
  } finally {
    if (window.history?.replaceState) {
      try {
        const url = new URL(window.location.href);
        url.searchParams.delete('notif');
        window.history.replaceState({}, '', `${url.pathname}${url.search}${url.hash}`);
      } catch {
        // best-effort URL cleanup only.
      }
    }
  }
}

/** Subscribes to the service worker's notification-click `postMessage` (app already open/backgrounded case). Web only; returns a no-op unsubscribe everywhere else. */
export function subscribeToWebNotificationClicks(): () => void {
  if (Platform.OS !== 'web' || typeof navigator === 'undefined' || !navigator.serviceWorker) {
    return () => undefined;
  }
  const handler = (event: MessageEvent) => {
    const message = event.data as { source?: unknown; data?: unknown } | undefined;
    if (message?.source !== 'walkie-notification-click') return;
    dispatch(message.data);
  };
  navigator.serviceWorker.addEventListener('message', handler);
  return () => navigator.serviceWorker.removeEventListener('message', handler);
}
